import { EventEmitter } from "node:events";
import Redis from "ioredis";
import { RaftEvent, RaftCommandType } from "../types";
import type {
  VoteResponse,
  VoteRequest,
  TimeoutNowRequest,
  StateMachine,
  RaftMetrics,
  RaftConfiguration,
  PreVoteResponse,
  PreVoteRequest,
  PeerInfo,
  LogEntry,
  InstallSnapshotResponse,
  InstallSnapshotRequest,
  ConfigurationChangePayload,
  AppendEntriesResponse,
  AppendEntriesRequest,
} from "../types";
import { RaftState, RaftEventType } from "../constants";
import {
  RaftValidationException,
  RaftStorageException,
  RaftReplicationException,
  RaftException,
} from "../exceptions";
import { RetryStrategy } from "../utils";
import { RaftLogger, RaftEventBus, PeerDiscoveryService } from "../services";
import { VoteWeightCalculator, RaftMetricsCollector } from "../monitoring";
import { RaftNetwork } from "../network";
import { RaftLog } from "./raft-log";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export class RaftNode<TCommand = unknown> extends EventEmitter {
  private readonly config: RaftConfiguration;
  private readonly storage: Redis;
  private readonly log: RaftLog<TCommand>;
  private readonly network: RaftNetwork;
  private readonly metrics: RaftMetricsCollector;
  private readonly weightCalculator: VoteWeightCalculator;
  private readonly eventBus: RaftEventBus;
  private readonly logger: RaftLogger;
  private readonly retry: RetryStrategy;
  private readonly peerDiscovery: PeerDiscoveryService;
  private readonly stateMachine: StateMachine<TCommand>;

  // Raft state
  private state: RaftState = RaftState.FOLLOWER;
  private currentTerm: number = 0;
  private votedFor: string | null = null;
  private commitIndex: number = 0;
  private lastApplied: number = 0;

  // Leader state
  private nextIndex: Map<string, number> = new Map();
  private matchIndex: Map<string, number> = new Map();

  // Timers
  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;

  // Snapshot metadata
  private latestSnapshotMeta: {
    lastIncludedIndex: number;
    lastIncludedTerm: number;
    filePath: string;
  } | null = null;

  // Cluster Configuration State
  // Represents the currently active configuration. Can be C_old (simple array), C_joint (oldPeers/newPeers), or C_new (simple array).
  private activeConfiguration: { oldPeers?: string[]; newPeers: string[] };

  constructor(config: RaftConfiguration, stateMachine: StateMachine<TCommand>) {
    super();
    this.config = config;
    this.stateMachine = stateMachine;
    this.logger = new RaftLogger(config.logging);
    this.retry = new RetryStrategy(config.retry);
    this.metrics = new RaftMetricsCollector(config.metrics);
    this.eventBus = new RaftEventBus();

    const redisOptions: {
      host: string;
      port: number;
      db: number;
      password?: string;
    } = {
      host: config.redis.host,
      port: config.redis.port,
      db: config.redis.db || 0,
    };

    if (config.redis.password) {
      redisOptions.password = config.redis.password;
    }

    this.storage = new Redis(redisOptions);

    this.log = new RaftLog<TCommand>(
      this.storage,
      config.nodeId,
      this.logger,
      config,
    );
    this.peerDiscovery = new PeerDiscoveryService(
      this.storage,
      config,
      this.logger,
    );
    // Initialize activeConfiguration based on initial peers from config or discovery.
    // For now, let's assume PeerDiscoveryService provides the initial list.
    // This will be overridden by any configuration log entries during recovery or later changes.
    // At the very start, before peerDiscovery is fully active or log is processed,
    // config.peers might be the source if provided.
    // A more robust init might happen in start() after peerDiscovery.start()
    this.activeConfiguration = { newPeers: config.peers || [] };

    this.network = new RaftNetwork(
      config,
      this.retry,
      this.logger,
      this.peerDiscovery,
      this.metrics,
    );
    this.weightCalculator = new VoteWeightCalculator(
      config.voting,
      this.metrics,
      this.peerDiscovery,
    );

    this.initializeEventHandlers();
  }

  public async start(): Promise<void> {
    try {
      await this.loadPersistedState(); // Loads term, votedFor, commitIndex, lastApplied, and activeConfiguration

      // Initialize WAL if enabled
      await this.log.initializeWALEngine();

      await this.log.loadFromStorage();
      await this.loadLatestSnapshotFromDisk(); // Load snapshot after log, before other services

      await this.peerDiscovery.start();

      // If activeConfiguration wasn't loaded from persisted state (e.g. fresh start),
      // initialize it based on discovered peers.
      // This ensures that even on a fresh start, the node knows its initial peers for consensus.
      if (
        this.activeConfiguration.newPeers.length === 0 &&
        (!this.activeConfiguration.oldPeers ||
          this.activeConfiguration.oldPeers.length === 0)
      ) {
        const discoveredPeers = this.peerDiscovery.getPeers();
        // Also include self in the initial configuration if not already via discovery
        const initialPeers = Array.from(
          new Set([...discoveredPeers, this.config.nodeId]),
        );
        this.activeConfiguration = { newPeers: initialPeers };
        this.logger.info(
          "Initialized activeConfiguration with discovered peers",
          { peers: initialPeers },
        );
      }

      this.network.initializeCircuitBreakers();

      // Initialize metrics immediately
      await this.updateMetrics();

      this.startElectionTimer();
      this.startMetricsCollection();

      this.logger.info("Raft node started", {
        nodeId: this.config.nodeId,
        clusterId: this.config.clusterId,
        state: this.state,
        term: this.currentTerm,
      });

      this.publishEvent(RaftEventType.STATE_CHANGE, {
        state: this.state,
        term: this.currentTerm,
      });
    } catch (error) {
      this.logger.fatal("Failed to start Raft node", {
        error,
        nodeId: this.config.nodeId,
      });
      throw new RaftException(`Failed to start node: ${error}`);
    }
  }

  public async stop(): Promise<void> {
    this.clearTimers();

    try {
      await this.peerDiscovery.stop();
    } catch (error) {
      this.logger.warn("Error stopping peer discovery", { error });
    }

    try {
      // Close WAL if enabled
      await this.log.closeWAL();
    } catch (error) {
      this.logger.warn("Error closing WAL", { error });
    }

    try {
      if (this.storage.status === "ready") {
        await this.storage.quit();
      }
    } catch (error) {
      this.logger.warn("Error closing Redis connection", { error });
    }

    this.logger.info("Raft node stopped", { nodeId: this.config.nodeId });
  }

  // This is a simplified appendLog for application data.
  // For config changes, changeClusterConfiguration will call a more specific log append.
  public async appendLog(
    applicationCommandPayload: TCommand,
  ): Promise<boolean> {
    if (this.state !== RaftState.LEADER) {
      throw new RaftValidationException("Only leader can append logs");
    }

    try {
      // For regular app commands, commandType is APPLICATION
      const index = await this.log.appendEntry(
        this.currentTerm,
        RaftCommandType.APPLICATION,
        applicationCommandPayload,
      );
      // TODO: this.lastApplied needs to be updated when entries are actually applied after commitment.
      // For now, this is just appending. The commit logic will handle majority checks.

      this.publishEvent(RaftEventType.LOG_REPLICATED, {
        // This event might be premature here
        index,
        commandPayload: applicationCommandPayload,
        term: this.currentTerm,
      });

      // Trigger replication to followers
      await this.replicateLogToFollowers();

      // After successfully appending and replicating, check for snapshotting
      // This might need to be tied to the actual commitment and application of the log entry.
      await this.maybeCreateSnapshot();

      return true;
    } catch (error) {
      this.logger.error("Failed to append application log", {
        error,
        nodeId: this.config.nodeId,
      });
      throw new RaftReplicationException(
        `Failed to append application log: ${error}`,
      );
    }
  }

  public getState(): RaftState {
    return this.state;
  }

  public getCurrentTerm(): number {
    return this.currentTerm;
  }

  public getNodeId(): string {
    return this.config.nodeId;
  }

  public getLog(): RaftLog {
    return this.log;
  }

  public getCommitIndex(): number {
    return this.commitIndex;
  }

  public getLastApplied(): number {
    return this.lastApplied;
  }

  public getMetrics(): RaftMetrics | undefined {
    return this.metrics.getMetrics(this.config.nodeId);
  }

  public async getPrometheusMetrics(): Promise<string> {
    return await this.metrics.getPrometheusMetrics();
  }

  public getActiveConfiguration(): { oldPeers?: string[]; newPeers: string[] } {
    return this.activeConfiguration;
  }

  public getPeers(): string[] {
    // Returns the list of voting members based on the current phase of configuration change.
    if (
      this.activeConfiguration.oldPeers &&
      this.activeConfiguration.oldPeers.length > 0
    ) {
      // Joint consensus: C_old,new. Voters are union of old and new.
      return Array.from(
        new Set([
          ...this.activeConfiguration.oldPeers,
          ...this.activeConfiguration.newPeers,
        ]),
      );
    }
    // Simple configuration: C_old or C_new.
    return [...this.activeConfiguration.newPeers];
  }

  public getConfiguration(): RaftConfiguration {
    return this.config;
  }

  public getLogger(): RaftLogger {
    return this.logger;
  }

  public getMetricsCollector(): RaftMetricsCollector {
    return this.metrics;
  }

  /**
   * Returns the set of peers that constitute the C_old configuration during joint consensus,
   * or the current set of peers if not in joint consensus.
   */
  private getOldConfigPeers(): string[] {
    if (
      this.activeConfiguration.oldPeers &&
      this.activeConfiguration.oldPeers.length > 0
    ) {
      return this.activeConfiguration.oldPeers;
    }
    return this.activeConfiguration.newPeers; // In C_new or initial C_old state
  }

  /**
   * Returns the set of peers that constitute the C_new configuration (either target of joint consensus or current).
   */
  private getNewConfigPeers(): string[] {
    return this.activeConfiguration.newPeers;
  }

  public getPeerInfo(nodeId: string): PeerInfo | undefined {
    return this.peerDiscovery.getPeerInfo(nodeId);
  }

  private initializeEventHandlers(): void {
    this.eventBus.on(RaftEventType.STATE_CHANGE, (event: RaftEvent) => {
      this.emit("stateChange", event.data);
    });

    this.eventBus.on(RaftEventType.LEADER_ELECTED, (event: RaftEvent) => {
      this.emit("leaderElected", event.data);
    });

    this.peerDiscovery.on(
      RaftEventType.PEER_DISCOVERED,
      (peerInfo: PeerInfo) => {
        this.logger.info("New peer discovered", { peerId: peerInfo.nodeId });
        this.network.updateCircuitBreakers();
      },
    );

    this.peerDiscovery.on(RaftEventType.PEER_LOST, (peerInfo: PeerInfo) => {
      this.logger.info("Peer lost", { peerId: peerInfo.nodeId });
      this.network.updateCircuitBreakers();
    });
  }

  private publishEvent(
    type: RaftEventType,
    data: Record<string, unknown> = {},
  ): void {
    const event = new RaftEvent(type, this.config.nodeId, data);
    this.eventBus.publish(event);
  }

  private startElectionTimer(): void {
    this.clearElectionTimer();
    const timeout = this.getRandomElectionTimeout();

    this.electionTimer = setTimeout(() => {
      void this.startElection();
    }, timeout);
  }

  private startHeartbeatTimer(): void {
    this.clearHeartbeatTimer();

    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeats();
    }, this.config.heartbeatInterval);
  }

  private startMetricsCollection(): void {
    if (this.config.metrics.enableInternal) {
      this.metricsTimer = setInterval(() => {
        void this.updateMetrics();
      }, this.config.metrics.collectionInterval);
    }
  }

  private clearTimers(): void {
    this.clearElectionTimer();
    this.clearHeartbeatTimer();
    this.clearMetricsTimer();
  }

  private clearElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearMetricsTimer(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  private getRandomElectionTimeout(): number {
    const [min, max] = this.config.electionTimeout;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private async startElection(
    triggeredByTimeoutNow: boolean = false,
  ): Promise<void> {
    if (!triggeredByTimeoutNow) {
      this.logger.info("Election timer elapsed, starting Pre-Vote phase.", {
        nodeId: this.config.nodeId,
        currentTerm: this.currentTerm,
      });
      // Pre-Vote Phase logic (already implemented)
      const prospectiveTermPreVote = this.currentTerm + 1;
      const preVoteRequest: PreVoteRequest = {
        term: prospectiveTermPreVote,
        candidateId: this.config.nodeId,
        lastLogIndex: this.log.getLastIndex(),
        lastLogTerm: this.log.getLastTerm(),
      };

      const otherPeers = this.getPeers().filter(
        (p) => p !== this.config.nodeId,
      );
      if (
        otherPeers.length === 0 &&
        this.getPeers().includes(this.config.nodeId) &&
        this.getPeers().length === 1
      ) {
        this.logger.info(
          "Single node cluster, proceeding directly to election (no Pre-Vote needed).",
          { nodeId: this.config.nodeId },
        );
      } else if (otherPeers.length > 0) {
        const preVotePromises = otherPeers.map((peerId) =>
          this.network
            .sendPreVoteRequest(peerId, preVoteRequest)
            .catch((err) => {
              this.logger.warn("PreVoteRequest failed to send or errored", {
                peerId,
                error: err,
              });
              return { term: this.currentTerm, voteGranted: false };
            }),
        );
        const preVoteResponses = await Promise.all(preVotePromises);
        let grantedPreVotes = this.getPeers().includes(this.config.nodeId)
          ? 1
          : 0;

        for (const response of preVoteResponses) {
          if (response.voteGranted) grantedPreVotes++;
          if (response.term > this.currentTerm) {
            this.logger.info(
              "Discovered higher term during Pre-Vote. Transitioning to follower.",
              { peerTerm: response.term, myTerm: this.currentTerm },
            );
            await this.becomeFollower(response.term);
            return;
          }
        }

        let preVoteMajorityAchieved = false;
        if (
          this.activeConfiguration.oldPeers &&
          this.activeConfiguration.oldPeers.length > 0
        ) {
          const oldConfigPeers = this.getOldConfigPeers();
          const newConfigPeers = this.getNewConfigPeers();
          let preVotesFromOld = oldConfigPeers.includes(this.config.nodeId)
            ? 1
            : 0;
          let preVotesFromNew = newConfigPeers.includes(this.config.nodeId)
            ? 1
            : 0;

          preVoteResponses.forEach((response, index) => {
            if (response.voteGranted) {
              const peerId = otherPeers[index];
              if (oldConfigPeers.includes(peerId!)) preVotesFromOld++;
              if (newConfigPeers.includes(peerId!)) preVotesFromNew++;
            }
          });
          preVoteMajorityAchieved =
            preVotesFromOld >= Math.floor(oldConfigPeers.length / 2) + 1 &&
            preVotesFromNew >= Math.floor(newConfigPeers.length / 2) + 1;
          this.logger.info("Pre-Vote counts (Joint Consensus):", {
            preVotesFromOld,
            oldConfigSize: oldConfigPeers.length,
            preVotesFromNew,
            newConfigSize: newConfigPeers.length,
            achieved: preVoteMajorityAchieved,
          });
        } else {
          const currentConfigPeers = this.getNewConfigPeers();
          const requiredPreVotes =
            Math.floor(currentConfigPeers.length / 2) + 1;
          preVoteMajorityAchieved = grantedPreVotes >= requiredPreVotes;
          this.logger.info("Pre-Vote counts (Simple Consensus):", {
            grantedPreVotes,
            required: requiredPreVotes,
            configSize: currentConfigPeers.length,
            achieved: preVoteMajorityAchieved,
          });
        }

        if (!preVoteMajorityAchieved) {
          this.logger.info(
            "Pre-Vote majority not achieved. Remaining Follower and resetting election timer.",
            { nodeId: this.config.nodeId },
          );
          this.startElectionTimer();
          return;
        }
        this.logger.info(
          "Pre-Vote majority achieved. Proceeding to actual election.",
          { nodeId: this.config.nodeId },
        );
      }
    } else {
      this.logger.info(
        "Election triggered by TimeoutNow, bypassing Pre-Vote.",
        { nodeId: this.config.nodeId },
      );
    }

    // Actual Election Phase
    const prospectiveTerm = this.currentTerm + 1;
    const preVoteRequest: PreVoteRequest = {
      term: prospectiveTerm,
      candidateId: this.config.nodeId,
      lastLogIndex: this.log.getLastIndex(),
      lastLogTerm: this.log.getLastTerm(),
    };

    // Send PreVoteRequests to all *other* peers in the current configuration
    const otherPeers = this.getPeers().filter((p) => p !== this.config.nodeId);
    if (
      otherPeers.length === 0 &&
      this.getPeers().includes(this.config.nodeId) &&
      this.getPeers().length === 1
    ) {
      this.logger.info(
        "Single node cluster, proceeding directly to election (no Pre-Vote needed).",
        { nodeId: this.config.nodeId },
      );
      // Fall through to actual election phase for single node cluster
    } else if (otherPeers.length > 0) {
      const preVotePromises = otherPeers.map((peerId) =>
        this.network.sendPreVoteRequest(peerId, preVoteRequest).catch((err) => {
          this.logger.warn("PreVoteRequest failed to send or errored", {
            peerId,
            error: err,
          });
          return { term: this.currentTerm, voteGranted: false }; // Treat errors as non-votes
        }),
      );
      const preVoteResponses = await Promise.all(preVotePromises);

      let grantedPreVotes = 0;
      // Self-vote is implicitly granted for pre-vote counting if node is part of config
      if (this.getPeers().includes(this.config.nodeId)) {
        grantedPreVotes = 1;
      }

      for (const response of preVoteResponses) {
        if (response.voteGranted) {
          grantedPreVotes++;
        }
        if (response.term > this.currentTerm) {
          // A peer is in a higher term. We should not proceed with election.
          // Become follower with that term.
          this.logger.info(
            "Discovered higher term during Pre-Vote. Transitioning to follower.",
            { peerTerm: response.term, myTerm: this.currentTerm },
          );
          await this.becomeFollower(response.term); // This will also reset the election timer.
          return;
        }
      }

      // Check for majority based on activeConfiguration (joint or simple)
      let preVoteMajorityAchieved = false;
      if (
        this.activeConfiguration.oldPeers &&
        this.activeConfiguration.oldPeers.length > 0
      ) {
        // Joint Consensus
        const oldConfigPeers = this.getOldConfigPeers();
        const newConfigPeers = this.getNewConfigPeers();
        let preVotesFromOld =
          this.config.nodeId && oldConfigPeers.includes(this.config.nodeId)
            ? 1
            : 0;
        let preVotesFromNew =
          this.config.nodeId && newConfigPeers.includes(this.config.nodeId)
            ? 1
            : 0;

        preVoteResponses.forEach((response, index) => {
          if (response.voteGranted) {
            const peerId = otherPeers[index];
            if (oldConfigPeers.includes(peerId!)) preVotesFromOld++;
            if (newConfigPeers.includes(peerId!)) preVotesFromNew++;
          }
        });
        preVoteMajorityAchieved =
          preVotesFromOld >= Math.floor(oldConfigPeers.length / 2) + 1 &&
          preVotesFromNew >= Math.floor(newConfigPeers.length / 2) + 1;
        this.logger.info("Pre-Vote counts (Joint Consensus):", {
          preVotesFromOld,
          oldConfigSize: oldConfigPeers.length,
          preVotesFromNew,
          newConfigSize: newConfigPeers.length,
          achieved: preVoteMajorityAchieved,
        });
      } else {
        // Simple Consensus
        const currentConfigPeers = this.getNewConfigPeers();
        const requiredPreVotes = Math.floor(currentConfigPeers.length / 2) + 1;
        preVoteMajorityAchieved = grantedPreVotes >= requiredPreVotes;
        this.logger.info("Pre-Vote counts (Simple Consensus):", {
          grantedPreVotes,
          required: requiredPreVotes,
          configSize: currentConfigPeers.length,
          achieved: preVoteMajorityAchieved,
        });
      }

      if (!preVoteMajorityAchieved) {
        this.logger.info(
          "Pre-Vote majority not achieved. Remaining Follower and resetting election timer.",
          { nodeId: this.config.nodeId },
        );
        this.startElectionTimer(); // Reset timer and remain follower
        return;
      }
      this.logger.info(
        "Pre-Vote majority achieved. Proceeding to actual election.",
        { nodeId: this.config.nodeId },
      );
    }

    try {
      this.state = RaftState.CANDIDATE;
      // If triggered by TimeoutNow, term might have already been incremented by handler or by discovering higher term.
      // If not, and pre-vote was skipped or passed, increment currentTerm.
      // The `prospectiveTerm` for pre-vote was `this.currentTerm + 1`.
      // If pre-vote was skipped (single node or TimeoutNow), we must increment here.
      // If pre-vote passed, `this.currentTerm` is still the old term.
      if (!triggeredByTimeoutNow) {
        // If pre-vote path was taken or single node
        this.currentTerm = this.currentTerm + 1;
      } else {
        // For TimeoutNow, if request.term was > currentTerm, currentTerm was updated.
        // If request.term == currentTerm, we need to increment it here.
        // startElection is called by handleTimeoutNowRequest *after* term alignment or if term was already aligned.
        // The handler for TimeoutNow will call startElection. It should ensure term is correct.
        // Let's assume handleTimeoutNowRequest handles term increment appropriately before calling startElection(true)
        // Or, more simply, if triggered by TimeoutNow, the handler should set the term.
        // For now, let's ensure it increments if it's still the same as before this flow started.
        // A specific check: if called by TimeoutNow, the term IS this.currentTerm +1, or already set higher.
        // The main thing is that `this.currentTerm` for VoteRequest should be the new, higher term.
        // The handler `handleTimeoutNowRequest` will call `becomeFollower(request.term)` if `request.term > this.currentTerm`.
        // Then it will call `startElection(true, request.term)`. So `startElection` needs to accept the target term.
        // This is getting complex. Simpler: `handleTimeoutNowRequest` ensures `this.currentTerm` is set to `request.term`
        // (if `request.term > this.currentTerm`) or `this.currentTerm + 1` (if `request.term == this.currentTerm`)
        // *before* calling `startElection(true)`.
        // So, `startElection` when `triggeredByTimeoutNow` can assume `this.currentTerm` is already the prospective term.
        // No, the standard is: candidate increments its term.
        // If triggeredByTimeoutNow, the term should be incremented.
        // If this.currentTerm was already updated by a TimeoutNow request with a higher term, that's fine.
        // If TimeoutNow request had same term, we MUST increment.
        // The `prospectiveTerm` variable isn't available here.
        // This means `handleTimeoutNowRequest` MUST set `this.currentTerm` to the term it will campaign in.
      }
      // The logic from pre-vote already set `this.currentTerm = prospectiveTerm` if pre-vote passed.
      // If pre-vote was skipped for single node, `prospectiveTerm` is `this.currentTerm + 1`.
      // If triggeredByTimeoutNow, this path is skipped.
      // The term increment should happen reliably *once* before sending VoteRequests.
      // Let's adjust: the pre-vote path sets currentTerm. If triggered, the handler sets it.
      // The original code did this.currentTerm = prospectiveTerm (which was currentTerm+1)
      // This means if `triggeredByTimeoutNow` is true, the caller (handleTimeoutNowRequest) is responsible
      // for setting the correct `this.currentTerm` for the campaign.

      this.votedFor = this.config.nodeId;
      await this.persistState(); // Persist new term and votedFor
      await this.peerDiscovery.updatePeerState(
        this.config.nodeId,
        this.state,
        this.currentTerm,
      );
      this.startElectionTimer(); // Reset election timer for the actual election phase

      this.logger.info("Starting actual election", {
        term: this.currentTerm,
        nodeId: this.config.nodeId,
      });

      this.metrics.incrementCounter("raft_elections_total", {
        node_id: this.config.nodeId,
        cluster_id: this.config.clusterId,
      });

      this.publishEvent(RaftEventType.STATE_CHANGE, {
        state: this.state,
        term: this.currentTerm,
      });

      const votes = await this.requestVotes();

      if (
        this.activeConfiguration.oldPeers &&
        this.activeConfiguration.oldPeers.length > 0
      ) {
        // Joint Consensus: C_old,new
        // Candidate needs to win majority in C_old AND C_new
        const oldConfigPeers = this.getOldConfigPeers();
        const newConfigPeers = this.getNewConfigPeers();

        // Important: The VoteWeightCalculator needs to be aware of these specific peer lists
        // or we need a way to filter/calculate weights based on these lists.
        // For unweighted votes (defaultWeight = 1, enableWeighting = false), it's simpler:
        let votesFromOld = 0;
        let votesFromNew = 0;
        if (this.votedFor === this.config.nodeId) {
          // Self-vote
          if (oldConfigPeers.includes(this.config.nodeId)) votesFromOld++;
          if (newConfigPeers.includes(this.config.nodeId)) votesFromNew++;
        }

        for (const [voterId, voteResponse] of votes.entries()) {
          if (voteResponse.voteGranted) {
            if (oldConfigPeers.includes(voterId)) votesFromOld++;
            if (newConfigPeers.includes(voterId)) votesFromNew++;
          }
        }

        const oldMajorityAchieved =
          votesFromOld >= Math.floor(oldConfigPeers.length / 2) + 1;
        const newMajorityAchieved =
          votesFromNew >= Math.floor(newConfigPeers.length / 2) + 1;

        this.logger.info("Election vote counts in joint consensus:", {
          votesFromOld,
          oldConfigSize: oldConfigPeers.length,
          oldMajorityAchieved,
          votesFromNew,
          newConfigSize: newConfigPeers.length,
          newMajorityAchieved,
        });

        if (oldMajorityAchieved && newMajorityAchieved) {
          await this.becomeLeader();
        } else {
          void this.becomeFollower();
        }
      } else {
        // Simple Consensus: C_old or C_new
        const currentPeers = this.getNewConfigPeers(); // This is the single active configuration

        // Use weighted voting calculations
        const totalWeight = this.calculateTotalWeight(votes);
        const receivedWeight = this.calculateReceivedWeight(votes);
        const majorityWeight = Math.floor(totalWeight / 2) + 1;

        // Fallback to simple vote counting if weights are not being used
        let receivedVotes = 0;
        if (this.votedFor === this.config.nodeId) receivedVotes++; // Self-vote
        for (const voteResponse of votes.values()) {
          if (voteResponse.voteGranted) receivedVotes++;
        }
        const majorityCount = Math.floor(currentPeers.length / 2) + 1;
        this.logger.info("Election vote counts in simple consensus:", {
          receivedVotes,
          currentConfigSize: currentPeers.length,
          majorityCount,
          receivedWeight,
          totalWeight,
          majorityWeight,
        });

        // Use weighted voting if weights are meaningful, otherwise fall back to simple counting
        const useWeightedVoting = totalWeight > currentPeers.length;
        if (
          useWeightedVoting
            ? receivedWeight >= majorityWeight
            : receivedVotes >= majorityCount
        ) {
          await this.becomeLeader();
        } else {
          void this.becomeFollower();
        }
      }
    } catch (error) {
      this.logger.error("Election failed", {
        error,
        nodeId: this.config.nodeId,
      });
      void this.becomeFollower();
    }
  }

  private async requestVotes(): Promise<Map<string, VoteResponse>> {
    const voteRequest: VoteRequest = {
      term: this.currentTerm,
      candidateId: this.config.nodeId,
      lastLogIndex: this.log.getLastIndex(),
      lastLogTerm: this.log.getLastTerm(),
      weight: this.weightCalculator.calculateWeight(this.config.nodeId),
    };

    const votes = new Map<string, VoteResponse>();
    const peers = this.peerDiscovery.getPeers();

    const votePromises = peers.map(async (peerId) => {
      try {
        const response = await this.network.sendVoteRequest(
          peerId,
          voteRequest,
        );
        votes.set(peerId, response);

        this.metrics.incrementCounter("raft_votes_total", {
          node_id: this.config.nodeId,
          cluster_id: this.config.clusterId,
          result: response.voteGranted ? "granted" : "denied",
        });

        this.publishEvent(
          response.voteGranted
            ? RaftEventType.VOTE_GRANTED
            : RaftEventType.VOTE_DENIED,
          {
            voter: peerId,
            term: response.term,
            weight: response.voterWeight,
          },
        );
      } catch (error) {
        this.logger.warn("Failed to get vote from peer", { peerId, error });
      }
    });

    await Promise.allSettled(votePromises);
    return votes;
  }

  private calculateTotalWeight(votes: Map<string, VoteResponse>): number {
    let totalWeight = this.weightCalculator.calculateWeight(this.config.nodeId); // Self vote

    for (const response of votes.values()) {
      totalWeight += response.voterWeight;
    }

    return totalWeight;
  }

  private calculateReceivedWeight(votes: Map<string, VoteResponse>): number {
    let receivedWeight = this.weightCalculator.calculateWeight(
      this.config.nodeId,
    ); // Self vote

    for (const response of votes.values()) {
      if (response.voteGranted) {
        receivedWeight += response.voterWeight;
      }
    }

    return receivedWeight;
  }

  private async becomeLeader(): Promise<void> {
    this.state = RaftState.LEADER;
    this.clearElectionTimer();
    this.startHeartbeatTimer();

    // Initialize leader state
    const peers = this.peerDiscovery.getPeers();
    for (const peerId of peers) {
      this.nextIndex.set(peerId, this.log.getLength());
      this.matchIndex.set(peerId, 0);
    }

    await this.peerDiscovery.updatePeerState(
      this.config.nodeId,
      this.state,
      this.currentTerm,
    );

    this.logger.info("Became leader", {
      term: this.currentTerm,
      nodeId: this.config.nodeId,
    });

    this.publishEvent(RaftEventType.LEADER_ELECTED, {
      term: this.currentTerm,
      leaderId: this.config.nodeId,
    });

    this.publishEvent(RaftEventType.STATE_CHANGE, {
      state: this.state,
      term: this.currentTerm,
    });

    // Send initial heartbeat
    await this.sendHeartbeats();
  }

  private async becomeFollower(term?: number): Promise<void> {
    this.state = RaftState.FOLLOWER;

    if (term && term > this.currentTerm) {
      this.currentTerm = term;
      this.votedFor = null;
    }

    this.clearHeartbeatTimer();
    this.startElectionTimer();

    await this.peerDiscovery.updatePeerState(
      this.config.nodeId,
      this.state,
      this.currentTerm,
    );

    this.logger.info("Became follower", {
      term: this.currentTerm,
      nodeId: this.config.nodeId,
    });

    this.publishEvent(RaftEventType.STATE_CHANGE, {
      state: this.state,
      term: this.currentTerm,
    });
  }

  private async sendHeartbeats(): Promise<void> {
    if (this.state !== RaftState.LEADER) {
      return;
    }

    const peers = this.peerDiscovery.getPeers();
    const heartbeatPromises = peers.map(async (peerId) => {
      try {
        const nextIndex = this.nextIndex.get(peerId) || 0;
        const prevLogIndex = nextIndex - 1;
        const prevLogTerm =
          prevLogIndex >= 0 ? this.log.getEntry(prevLogIndex)?.term || 0 : 0;

        const request: AppendEntriesRequest = {
          term: this.currentTerm,
          leaderId: this.config.nodeId,
          prevLogIndex,
          prevLogTerm,
          entries: [], // Heartbeat has no entries
          leaderCommit: this.commitIndex,
        };

        const response = await this.network.sendAppendEntries(peerId, request);

        if (response.term > this.currentTerm) {
          await this.becomeFollower(response.term);
          return;
        }

        this.metrics.incrementCounter("raft_heartbeats_total", {
          node_id: this.config.nodeId,
          cluster_id: this.config.clusterId,
        });

        this.publishEvent(RaftEventType.HEARTBEAT_RECEIVED, {
          from: peerId,
          success: response.success,
        });
      } catch (error) {
        this.logger.warn("Failed to send heartbeat", { peerId, error });
      }
    });

    await Promise.allSettled(heartbeatPromises);
  }

  private async replicateLogToFollowers(): Promise<void> {
    if (this.state !== RaftState.LEADER) {
      return;
    }

    const peers = this.peerDiscovery.getPeers();
    for (const peerId of peers) {
      await this.replicateLogToPeer(peerId);
    }
  }

  private async replicateLogToPeer(peerId: string): Promise<void> {
    const nextIndex = this.nextIndex.get(peerId) || 0;

    // If nextIndex is before the log's first index, follower needs a snapshot
    // This method getFirstIndex() needs to be added to RaftLog
    if (nextIndex < this.log.getFirstIndex()) {
      this.logger.info(
        `Peer ${peerId} is too far behind (nextIndex: ${nextIndex}, firstLogIndex: ${this.log.getFirstIndex()}). Sending snapshot.`,
        { nodeId: this.config.nodeId },
      );
      await this.sendSnapshotToPeer(peerId);
      return;
    }

    const prevLogIndex = nextIndex - 1;
    const prevLogTerm =
      prevLogIndex >= 0 ? this.log.getEntry(prevLogIndex)?.term || 0 : 0;

    const entries = this.log.getEntries(nextIndex);

    const request: AppendEntriesRequest = {
      term: this.currentTerm,
      leaderId: this.config.nodeId,
      prevLogIndex,
      prevLogTerm,
      entries,
      leaderCommit: this.commitIndex,
    };

    try {
      const response = await this.network.sendAppendEntries(peerId, request);

      if (response.term > this.currentTerm) {
        await this.becomeFollower(response.term);
        return;
      }

      if (response.success) {
        this.nextIndex.set(peerId, response.lastLogIndex + 1);
        this.matchIndex.set(peerId, response.lastLogIndex);

        // Leader advances its own commit index based on matchIndex from all (relevant) followers
        await this.advanceCommitIndex();
      } else {
        // If AppendEntries fails because of log inconsistency, decrement nextIndex for that follower and retry.
        // This is standard Raft log catch-up.
        if (response.term === this.currentTerm) {
          // Only decrement if it's a log mismatch, not a term issue
          const currentNext = this.nextIndex.get(peerId) || 0;
          this.nextIndex.set(peerId, Math.max(0, currentNext - 1));
        }
        // If it falls behind the first log index, the next attempt (e.g. next heartbeat) will send a snapshot.
        // If it falls behind the first log index, the next attempt will send a snapshot.
        const currentNext = this.nextIndex.get(peerId) || 0;
        this.nextIndex.set(peerId, Math.max(0, currentNext - 1));
        // No immediate retry here, will be picked up by next heartbeat or replication cycle.
        // If we wanted to immediately retry: await this.replicateLogToPeer(peerId);
        this.logger.info(
          `Log replication failed for peer ${peerId}, nextIndex decremented to ${this.nextIndex.get(peerId)}. Will retry or send snapshot.`,
          { nodeId: this.config.nodeId },
        );
      }
    } catch (error) {
      this.logger.warn("Failed to replicate log to peer", { peerId, error });
    }
  }

  private async loadPersistedState(): Promise<void> {
    try {
      const stateKey = `${this.config.nodeId}:state`;
      const stateData = await this.storage.get(stateKey);

      if (stateData) {
        const state = JSON.parse(stateData);
        this.currentTerm = state.currentTerm || 0;
        this.votedFor = state.votedFor || null;
        this.commitIndex = state.commitIndex || 0;
        this.lastApplied = state.lastApplied || 0;
        if (state.activeConfiguration) {
          this.activeConfiguration = state.activeConfiguration;
          this.logger.info("Loaded activeConfiguration from persisted state", {
            config: this.activeConfiguration,
          });
        } else {
          // Initialize if not found in persisted state (e.g. older version or fresh start)
          this.activeConfiguration = { newPeers: this.config.peers || [] };
          if (this.activeConfiguration.newPeers.length === 0) {
            // If config.peers is also empty, this will be populated by peerDiscovery later in start()
            this.logger.info(
              "No activeConfiguration in persisted state, initialized to empty/config peers.",
              { peers: this.config.peers },
            );
          }
        }
      } else {
        // Default initialization if no state is persisted (e.g. very first start)
        this.activeConfiguration = { newPeers: this.config.peers || [] };
        this.logger.info(
          "No persisted state found, initialized activeConfiguration based on config.peers.",
          { peers: this.config.peers },
        );
      }
    } catch (error) {
      this.logger.warn("Failed to load persisted state", {
        error,
        nodeId: this.config.nodeId,
      });
      // Ensure clean state on error
      this.currentTerm = 0;
      this.votedFor = null;
      this.commitIndex = 0;
      this.lastApplied = 0;
    }
  }

  private async persistState(): Promise<void> {
    try {
      const stateKey = `${this.config.nodeId}:state`;
      const state = {
        currentTerm: this.currentTerm,
        votedFor: this.votedFor,
        commitIndex: this.commitIndex,
        lastApplied: this.lastApplied,
        activeConfiguration: this.activeConfiguration, // Persist current/joint config
      };

      await this.storage.set(stateKey, JSON.stringify(state));

      // Also persist to WAL if enabled
      await this.log.persistMetadata(
        this.currentTerm,
        this.votedFor,
        this.commitIndex,
      );
    } catch (error) {
      this.logger.error("Failed to persist state", {
        error,
        nodeId: this.config.nodeId,
      });
      throw new RaftStorageException(`Failed to persist state: ${error}`);
    }
  }

  private async updateMetrics(): Promise<void> {
    const systemMetrics = this.peerDiscovery.getCurrentMetrics();

    const metrics: Partial<RaftMetrics> = {
      currentTerm: this.currentTerm,
      state: this.state,
      votedFor: this.votedFor,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      logLength: this.log.getLength(),
      peerCount: this.peerDiscovery.getPeers().length,
      systemMetrics,
    };

    this.metrics.updateMetrics(
      this.config.nodeId,
      this.config.clusterId,
      metrics,
    );

    this.publishEvent(RaftEventType.METRICS_UPDATED, metrics);
  }

  private async maybeCreateSnapshot(): Promise<void> {
    if (this.log.getLength() > this.config.snapshotThreshold!) {
      await this.createSnapshot();
    }
  }

  private async createSnapshot(): Promise<void> {
    const lastIncludedIndex = this.log.getLastIndex();
    const lastIncludedTerm = this.log.getLastTerm();

    try {
      const snapshotData = await this.stateMachine.getSnapshotData();
      const snapshotDir = this.config.persistence.dataDir;
      const snapshotFileName = `snapshot-${lastIncludedTerm}-${lastIncludedIndex}.snap`;
      const snapshotFilePath = path.join(snapshotDir, snapshotFileName);

      // Store the path of the *previous* snapshot before updating latestSnapshotMeta
      const previousSnapshotFilePath = this.latestSnapshotMeta
        ? this.latestSnapshotMeta.filePath
        : null;

      await fs.mkdir(snapshotDir, { recursive: true });
      await fs.writeFile(snapshotFilePath, snapshotData);

      this.latestSnapshotMeta = {
        lastIncludedIndex,
        lastIncludedTerm,
        filePath: snapshotFilePath,
      };

      this.logger.info("Snapshot saved to disk", {
        filePath: snapshotFilePath,
        lastIncludedIndex,
        lastIncludedTerm,
        size: snapshotData.length,
      });

      // The RaftLog's createSnapshot is for WAL integration.
      // Pass metadata (like filePath) instead of the full snapshotData.
      await this.log.createSnapshot(
        lastIncludedIndex,
        lastIncludedTerm,
        snapshotFilePath,
      );

      // Clean up the immediately preceding snapshot file created by this node
      if (
        previousSnapshotFilePath &&
        previousSnapshotFilePath !== snapshotFilePath
      ) {
        try {
          await fs.unlink(previousSnapshotFilePath);
          this.logger.info("Successfully deleted previous snapshot file", {
            deletedPath: previousSnapshotFilePath,
          });
        } catch (unlinkError) {
          this.logger.warn("Failed to delete previous snapshot file", {
            path: previousSnapshotFilePath,
            error: unlinkError,
          });
        }
      }

      // This truncation in RaftLog might also clean up older snapshots on disk based on its own logic
      // (e.g. snapshots older than the log's new first index)
      await this.log.truncateBeforeIndex(lastIncludedIndex + 1);

      this.logger.info(
        "Snapshot created, log truncated, and snapshot meta updated",
        {
          lastIncludedIndex,
          lastIncludedTerm,
          nodeId: this.config.nodeId,
        },
      );
    } catch (error) {
      this.logger.error("Failed to create and save snapshot", {
        error,
        nodeId: this.config.nodeId,
        lastIncludedIndex,
        lastIncludedTerm,
      });
    }
  }

  private async sendSnapshotToPeer(peerId: string): Promise<void> {
    this.logger.info("Preparing to send snapshot to peer", {
      peerId,
      nodeId: this.config.nodeId,
    });

    if (!this.latestSnapshotMeta) {
      this.logger.error(
        "No snapshot metadata available to send to peer. This may indicate an issue with snapshot creation.",
        {
          peerId,
          nodeId: this.config.nodeId,
        },
      );
      // Attempt to create a snapshot now if one is missing and conditions allow
      // This is a fallback, ideally snapshots are created proactively.
      if (this.state === RaftState.LEADER) {
        this.logger.info(
          "Attempting to create a snapshot on-demand before sending to peer.",
          { peerId },
        );
        await this.createSnapshot();
        if (!this.latestSnapshotMeta) {
          this.logger.error(
            "On-demand snapshot creation failed. Cannot send snapshot.",
            { peerId },
          );
          return;
        }
      } else {
        this.logger.warn("Not a leader, cannot create snapshot on-demand.", {
          peerId,
        });
        return;
      }
    }

    const { lastIncludedIndex, lastIncludedTerm, filePath } =
      this.latestSnapshotMeta;

    try {
      const snapshotData = await fs.readFile(filePath);
      this.logger.info(
        `Read snapshot data from ${filePath} for peer ${peerId}`,
        { size: snapshotData.length },
      );

      const request: InstallSnapshotRequest = {
        term: this.currentTerm,
        leaderId: this.config.nodeId,
        lastIncludedIndex,
        lastIncludedTerm,
        offset: 0,
        data: snapshotData,
        done: true,
      };

      this.logger.info("Sending InstallSnapshot request to peer", {
        peerId,
        lastIncludedIndex,
        lastIncludedTerm,
        dataSize: snapshotData.length,
      });
      const response = await this.network.sendInstallSnapshot(peerId, request);

      if (response.term > this.currentTerm) {
        await this.becomeFollower(response.term);
        return;
      }

      // If successful, update nextIndex and matchIndex for the follower
      this.nextIndex.set(peerId, lastIncludedIndex + 1);
      this.matchIndex.set(peerId, lastIncludedIndex);

      this.logger.info("Successfully sent snapshot to peer", {
        peerId,
        lastIncludedIndex,
        nodeId: this.config.nodeId,
      });
    } catch (error) {
      this.logger.error("Failed to send snapshot to peer", {
        error,
        peerId,
        nodeId: this.config.nodeId,
      });
    }
  }

  public async handleInstallSnapshot(
    request: InstallSnapshotRequest,
  ): Promise<InstallSnapshotResponse> {
    this.logger.info("Received InstallSnapshot request", {
      nodeId: this.config.nodeId,
      term: this.currentTerm,
      requestTerm: request.term,
      leaderId: request.leaderId,
      lastIncludedIndex: request.lastIncludedIndex,
    });

    if (request.term < this.currentTerm) {
      this.logger.warn("InstallSnapshot request from older term, rejecting", {
        requestTerm: request.term,
        currentTerm: this.currentTerm,
      });
      return { term: this.currentTerm };
    }

    if (request.term > this.currentTerm) {
      this.logger.info(
        "Higher term received in InstallSnapshot, becoming follower",
        {
          newTerm: request.term,
        },
      );
      this.currentTerm = request.term;
      this.votedFor = null; // Clear votedFor when term changes
      await this.persistState(); // Persist new term and cleared votedFor
      void this.becomeFollower(request.term); // Ensure state transition and timer reset
    } else {
      // If terms are the same, ensure we are a follower. A leader should not normally receive InstallSnapshot.
      if (this.state !== RaftState.FOLLOWER) {
        this.logger.info(
          "Received InstallSnapshot request while not follower, transitioning to follower",
          { state: this.state },
        );
        void this.becomeFollower(request.term);
      }
    }

    // Reset election timer as we've received a valid communication from the leader
    this.startElectionTimer();

    // Placeholder: Save snapshot chunk request.data
    // For now, we assume done=true and data is the full snapshot if not chunking
    this.logger.info("Snapshot data received", {
      offset: request.offset,
      done: request.done,
      dataSize: request.data.length,
      leaderId: request.leaderId,
    });

    if (request.done) {
      try {
        const snapshotDir = this.config.persistence.dataDir;
        const snapshotFileName = `snapshot-${request.lastIncludedTerm}-${request.lastIncludedIndex}.snap`;
        const snapshotFilePath = path.join(snapshotDir, snapshotFileName);

        await fs.mkdir(snapshotDir, { recursive: true });
        await fs.writeFile(snapshotFilePath, request.data);

        this.latestSnapshotMeta = {
          lastIncludedIndex: request.lastIncludedIndex,
          lastIncludedTerm: request.lastIncludedTerm,
          filePath: snapshotFilePath,
        };
        this.logger.info("Snapshot saved to disk from leader", {
          filePath: snapshotFilePath,
        });

        await this.stateMachine.applySnapshot(request.data);
        this.logger.info("Applied snapshot to state machine", {
          lastIncludedIndex: request.lastIncludedIndex,
        });

        this.commitIndex = request.lastIncludedIndex;
        this.lastApplied = request.lastIncludedIndex;

        // This call might also clean up older on-disk snapshots
        await this.log.truncateEntriesAfter(
          request.lastIncludedIndex,
          request.lastIncludedTerm,
        );

        await this.persistState();

        this.logger.info(
          "Successfully installed snapshot, updated state, and persisted",
          {
            lastIncludedIndex: request.lastIncludedIndex,
            lastIncludedTerm: request.lastIncludedTerm,
            nodeId: this.config.nodeId,
          },
        );
      } catch (error) {
        this.logger.error("Failed to save snapshot or apply to state machine", {
          error,
          nodeId: this.config.nodeId,
          lastIncludedIndex: request.lastIncludedIndex,
        });
      }
    }

    return { term: this.currentTerm };
  }

  private async loadLatestSnapshotFromDisk(): Promise<void> {
    const snapshotDir = this.config.persistence.dataDir;
    this.logger.info("Scanning for snapshots on disk", {
      directory: snapshotDir,
    });

    try {
      await fs.mkdir(snapshotDir, { recursive: true }); // Ensure directory exists
      const files = await fs.readdir(snapshotDir);
      const snapshotFiles = files.filter((file) =>
        file.match(/^snapshot-\d+-\d+\.snap$/),
      );

      if (snapshotFiles.length === 0) {
        this.logger.info("No snapshots found on disk.", {
          directory: snapshotDir,
        });
        return;
      }

      let latestSnapshotFile: string | null = null;
      let maxLastIncludedIndex = -1;
      let maxLastIncludedTerm = -1;

      for (const file of snapshotFiles) {
        const parts = file.replace(".snap", "").split("-");
        if (parts.length === 3) {
          const term = parseInt(parts[1]!, 10);
          const index = parseInt(parts[2]!, 10);

          if (index > maxLastIncludedIndex) {
            maxLastIncludedIndex = index;
            maxLastIncludedTerm = term;
            latestSnapshotFile = file;
          } else if (index === maxLastIncludedIndex) {
            if (term > maxLastIncludedTerm) {
              maxLastIncludedTerm = term;
              latestSnapshotFile = file;
            }
          }
        }
      }

      if (latestSnapshotFile) {
        const filePath = path.join(snapshotDir, latestSnapshotFile);
        this.logger.info("Found latest snapshot file", { filePath });
        const snapshotData = await fs.readFile(filePath);

        await this.stateMachine.applySnapshot(snapshotData);
        this.logger.info("Applied snapshot from disk to state machine", {
          lastIncludedIndex: maxLastIncludedIndex,
          lastIncludedTerm: maxLastIncludedTerm,
        });

        this.commitIndex = maxLastIncludedIndex;
        this.lastApplied = maxLastIncludedIndex;
        this.latestSnapshotMeta = {
          lastIncludedIndex: maxLastIncludedIndex,
          lastIncludedTerm: maxLastIncludedTerm,
          filePath,
        };

        // Update RaftLog's understanding of the first index
        // This method (setFirstIndex) needs to be added to RaftLog
        this.log.setFirstIndex(maxLastIncludedIndex + 1);

        await this.persistState(); // Persist updated commitIndex and lastApplied

        this.logger.info(
          "Successfully loaded snapshot from disk and updated node state.",
          {
            lastIncludedIndex: maxLastIncludedIndex,
            lastIncludedTerm: maxLastIncludedTerm,
          },
        );
      } else {
        this.logger.info("No valid snapshot files found after parsing.", {
          directory: snapshotDir,
        });
      }
    } catch (error) {
      this.logger.error("Failed to load snapshot from disk", {
        error,
        directory: snapshotDir,
      });
      // If loading snapshot fails, proceed without it, Raft will recover via log or from leader.
    }
  }

  private async applyCommittedEntries(): Promise<void> {
    let appliedSomething = false;
    while (this.lastApplied < this.commitIndex) {
      const entryToApplyIndex = this.lastApplied + 1;
      const entry = this.log.getEntry(entryToApplyIndex);

      if (!entry) {
        this.logger.error(
          "Entry not found in log for applying, though commitIndex was advanced.",
          {
            lastApplied: this.lastApplied,
            commitIndex: this.commitIndex,
            missingIndex: entryToApplyIndex,
          },
        );
        // This indicates a serious issue, potentially a bug in log management or commitIndex advancement.
        break;
      }

      this.logger.debug("Applying entry to state machine / config", {
        index: entry.index,
        type: entry.commandType,
      });
      if (entry.commandType === RaftCommandType.CHANGE_CONFIG) {
        // applyConfigurationChange calls persistState internally
        this.applyConfigurationChange(
          entry.commandPayload as ConfigurationChangePayload,
        );
      } else if (entry.commandType === RaftCommandType.APPLICATION) {
        await this.stateMachine.apply(entry.commandPayload as TCommand);
      }

      this.lastApplied = entry.index;
      appliedSomething = true;
    }

    if (appliedSomething) {
      // Persist state after applying a batch of entries, especially if lastApplied changed.
      // If applyConfigurationChange was called, it would have already persisted.
      // This ensures lastApplied is persisted even if only application entries were applied.
      // To avoid redundant persists if only a config change happened, check if persist was already done.
      // However, persistState is idempotent, so an extra call is usually safe but might be inefficient.
      // For now, a single persist at the end if anything was applied is reasonable.
      await this.persistState();
    }

    // Old placeholder logic, removed in favor of the loop above.
    /*
    // A real implementation would iterate from this.lastApplied up to this.commitIndex.
    // For each entry, check its type.

    // Example of applying a single hypothetical entry at this.lastApplied + 1:
    const entryToApplyIndex = this.lastApplied + 1;
    if (entryToApplyIndex <= this.commitIndex) {
      const entry = this.log.getEntry(entryToApplyIndex);
      if (entry) {
        if (entry.commandType === RaftCommandType.CHANGE_CONFIG) {
          this.applyConfigurationChange(entry.commandPayload as ConfigurationChangePayload);
        } else if (entry.commandType === RaftCommandType.APPLICATION) {
          // Apply application command to stateMachine
          // await this.stateMachine.apply(entry.commandPayload); // This would be the actual application
        }
        this.lastApplied = entry.index;
        // Persist state after applying, especially if lastApplied changed or config changed.
        // await this.persistState(); // May not persist after every single entry for performance.
      }
    }
    // After applying all up to commitIndex, persistState if lastApplied changed.
    if (this.lastApplied > 0) { // A condition to persist if anything changed
        // await this.persistState();
    }*/
  }

  private applyConfigurationChange(payload: ConfigurationChangePayload): void {
    this.logger.info("Applying new cluster configuration", {
      payload,
      oldConfig: this.activeConfiguration,
    });

    if (payload.oldPeers && payload.oldPeers.length > 0) {
      // This is a joint configuration C_old,new
      this.activeConfiguration = {
        oldPeers: [...payload.oldPeers],
        newPeers: [...payload.newPeers],
      };
      this.logger.info("Transitioned to JOINT configuration C_old,new", {
        activeConfig: this.activeConfiguration,
      });
    } else {
      // This is a final new configuration C_new
      this.activeConfiguration = {
        newPeers: [...payload.newPeers],
        // oldPeers is implicitly undefined/empty, signifying not in joint consensus
      };
      this.logger.info("Transitioned to NEW configuration C_new", {
        activeConfig: this.activeConfiguration,
      });
    }
    // Persisting state after config change is crucial.
    // Consider if persistState should be called here or by the caller of applyCommittedEntries.
    // For safety, let's assume it's important to persist immediately after this internal state change.
    void this.persistState();
  }

  public async changeClusterConfiguration(newPeerIds: string[]): Promise<void> {
    if (this.state !== RaftState.LEADER) {
      throw new RaftValidationException(
        "Cluster configuration changes can only be initiated by the leader.",
      );
    }

    if (
      !this.activeConfiguration.newPeers ||
      this.activeConfiguration.oldPeers
    ) {
      // oldPeers being set means we are already in a joint configuration.
      throw new RaftValidationException(
        "Cannot initiate a new configuration change while already in a joint configuration state.",
      );
    }

    this.logger.info(
      "Initiating cluster configuration change (Phase 1: Proposing Joint Configuration)",
      {
        currentNodeId: this.config.nodeId,
        currentPeers: this.activeConfiguration.newPeers,
        targetNewPeers: newPeerIds,
      },
    );

    const cOld = this.activeConfiguration.newPeers;
    const cNew = Array.from(new Set([...newPeerIds, this.config.nodeId])); // Ensure leader is part of C_new

    const jointConfigPayload: ConfigurationChangePayload = {
      oldPeers: cOld,
      newPeers: cNew,
    };

    try {
      const jointConfigLogIndex = await this.log.appendEntry(
        this.currentTerm,
        RaftCommandType.CHANGE_CONFIG,
        jointConfigPayload,
      );
      this.logger.info(
        "Appended C_old,new (joint) configuration entry to log",
        { index: jointConfigLogIndex, payload: jointConfigPayload },
      );

      // Replicate this entry.
      // The leader itself "stores" the entry by appending it.
      this.matchIndex.set(this.config.nodeId, jointConfigLogIndex);
      this.nextIndex.set(this.config.nodeId, jointConfigLogIndex + 1);

      await this.replicateLogToFollowers(); // Replicate the new C_joint entry

      // Wait for C_joint to be committed.
      // This requires majorities in C_old AND C_new.
      // This is a more robust wait: leader waits for the entry to be committed (which implies it's also applied by the leader)
      await this.waitForLogEntryCommitment(jointConfigLogIndex, 30000); // Wait for 30 seconds max for C_joint
      this.logger.info(
        "C_old,new (joint) configuration committed and applied by leader.",
        { index: jointConfigLogIndex, activeConfig: this.activeConfiguration },
      );

      // Phase 2: Propose C_new (final configuration)
      // Ensure we are still leader and the active config is indeed the joint one.
      if (this.state !== RaftState.LEADER) {
        this.logger.warn(
          "Lost leadership before proposing C_new. Aborting configuration change.",
          { originalTargetPeers: newPeerIds },
        );
        throw new RaftException("Lost leadership during configuration change.");
      }

      if (
        !this.activeConfiguration.oldPeers ||
        !(this.activeConfiguration.oldPeers as Array<string>).every(
          (p: string) => cOld.includes(p),
        ) ||
        !this.activeConfiguration.newPeers.every((p) => cNew.includes(p))
      ) {
        this.logger.error(
          "Internal state error: Active configuration is not the expected joint configuration.",
          {
            expectedJoint: jointConfigPayload,
            actualActive: this.activeConfiguration,
          },
        );
        throw new RaftException(
          "Configuration state error during joint consensus.",
        );
      }

      this.logger.info(
        "Initiating cluster configuration change (Phase 2: Proposing Final C_new Configuration)",
        { newPeers: cNew },
      );
      const newConfigPayload: ConfigurationChangePayload = {
        newPeers: cNew, // cNew was the newPeers list from the joint config
      };

      const newConfigLogIndex = await this.log.appendEntry(
        this.currentTerm,
        RaftCommandType.CHANGE_CONFIG,
        newConfigPayload,
      );
      this.logger.info("Appended C_new (final) configuration entry to log", {
        index: newConfigLogIndex,
        payload: newConfigPayload,
      });

      this.matchIndex.set(this.config.nodeId, newConfigLogIndex);
      this.nextIndex.set(this.config.nodeId, newConfigLogIndex + 1);

      await this.replicateLogToFollowers(); // Replicate the C_new entry

      // Wait for C_new to be committed. Commitment still uses joint consensus rules (C_old,new)
      // because C_joint is active until C_new is committed *and applied*.
      await this.waitForLogEntryCommitment(newConfigLogIndex, 30000); // Wait for 30 seconds max for C_new
      this.logger.info(
        "C_new (final) configuration committed and applied by leader.",
        { index: newConfigLogIndex, activeConfig: this.activeConfiguration },
      );

      // Once C_new is committed and applied by the leader, its activeConfiguration will transition to simple C_new.
      // Followers will do the same when they apply C_new.
      this.logger.info(
        "Cluster configuration change to C_new completed successfully on leader.",
        { finalConfiguration: this.activeConfiguration.newPeers },
      );
    } catch (error) {
      this.logger.error("Failed cluster configuration change process", {
        error,
      });
      // Consider how to handle partial failure (e.g., C_joint committed but C_new failed).
      // Raft protocol suggests C_joint remains active. Retrying C_new might be an option.
      throw error;
    }
  }

  // Robust wait for a specific log entry to be committed.
  private async waitForLogEntryCommitment(
    logIndex: number,
    timeoutMs: number,
  ): Promise<void> {
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      const checkCommit = () => {
        if (this.commitIndex >= logIndex) {
          // Once committed, the leader should also apply it, which updates activeConfiguration.
          // We might need a slight delay or check for application if the next step depends on activeConfiguration being updated.
          // For now, resolving on commitIndex is the primary goal.
          resolve();
        } else if (this.state !== RaftState.LEADER) {
          reject(
            new RaftException(
              "Lost leadership or changed state while waiting for log entry commitment.",
            ),
          );
        } else if (Date.now() - startTime > timeoutMs) {
          reject(
            new RaftException(
              `Timeout waiting for log entry ${logIndex} to be committed.`,
            ),
          );
        } else {
          setTimeout(checkCommit, 50 + Math.random() * 50); // Check every 50-100ms
        }
      };
      checkCommit();
    });
  }

  private async advanceCommitIndex(): Promise<void> {
    if (this.state !== RaftState.LEADER) {
      return;
    }

    let newCommitIndex = this.commitIndex;

    // Iterate from commitIndex + 1 up to the last log index known to the leader (its own log)
    for (let N = this.commitIndex + 1; N <= this.log.getLastIndex(); N++) {
      const entry = this.log.getEntry(N);
      if (entry && entry.term === this.currentTerm) {
        let cOldMajority = false;
        let cNewMajority = false;

        if (
          this.activeConfiguration.oldPeers &&
          this.activeConfiguration.oldPeers.length > 0
        ) {
          // Joint Consensus C_old,new
          const oldPeersInConfig = this.getOldConfigPeers(); // Use helper
          const newPeersInConfig = this.getNewConfigPeers(); // Use helper

          const oldPeersAckCount = oldPeersInConfig.filter(
            (peerId) => (this.matchIndex.get(peerId) || 0) >= N,
          ).length;
          const newPeersAckCount = newPeersInConfig.filter(
            (peerId) => (this.matchIndex.get(peerId) || 0) >= N,
          ).length;

          const oldMajoritySize = Math.floor(oldPeersInConfig.length / 2) + 1;
          const newMajoritySize = Math.floor(newPeersInConfig.length / 2) + 1;

          cOldMajority = oldPeersAckCount >= oldMajoritySize;
          cNewMajority = newPeersAckCount >= newMajoritySize;

          if (cOldMajority && cNewMajority) {
            newCommitIndex = N;
          } else {
            break;
          }
        } else {
          // Simple Consensus C_old or C_new
          const currentPeersInConfig = this.getNewConfigPeers();
          const ackCount = currentPeersInConfig.filter(
            (peerId) => (this.matchIndex.get(peerId) || 0) >= N,
          ).length;
          const majoritySize = Math.floor(currentPeersInConfig.length / 2) + 1;

          if (ackCount >= majoritySize) {
            newCommitIndex = N;
          } else {
            break;
          }
        }
      } else if (entry && entry.term < this.currentTerm) {
        // Per Raft: Leader cannot determine commitment of log entries from previous terms using replica counting alone.
        // These entries are implicitly committed once an entry from the current term is committed.
        // So, if we successfully committed an entry from currentTerm (newCommitIndex > this.commitIndex),
        // any preceding entries from older terms up to newCommitIndex are also considered committed.
        // The loop structure handles this naturally: if newCommitIndex advances, it covers these.
      } else if (!entry) {
        this.logger.warn(
          "advanceCommitIndex: Log entry not found during commit check. This should not happen.",
          { index: N },
        );
        break;
      }
      // If entry.term > this.currentTerm, this is an invalid state for a leader. Stop.
      else if (entry.term > this.currentTerm) {
        this.logger.error(
          "advanceCommitIndex: Leader encountered log entry from a future term. Stepping down.",
          { entryTerm: entry.term, currentTerm: this.currentTerm },
        );
        void this.becomeFollower(entry.term); // Step down
        return;
      }
    }

    if (newCommitIndex > this.commitIndex) {
      this.logger.info(
        `Commit index will be advanced from ${this.commitIndex} to ${newCommitIndex}`,
        { nodeId: this.config.nodeId },
      );
      this.commitIndex = newCommitIndex;
      await this.applyCommittedEntries(); // Apply newly committed entries on the leader
      // Persist state after applying, as lastApplied and potentially activeConfiguration changed.
      // await this.persistState(); // persistState is called within applyCommittedEntries if needed or at the end of apply loop
    }
  }

  public async transferLeadership(targetPeerId: string): Promise<void> {
    this.logger.info(`Attempting to transfer leadership to ${targetPeerId}`, {
      nodeId: this.config.nodeId,
    });
    if (this.state !== RaftState.LEADER) {
      throw new RaftValidationException(
        "Leadership transfer can only be initiated by the leader.",
      );
    }

    const currentPeers = this.getPeers(); // Considers joint consensus
    if (!currentPeers.includes(targetPeerId)) {
      throw new RaftValidationException(
        `Target peer ${targetPeerId} is not part of the current active configuration.`,
      );
    }
    if (targetPeerId === this.config.nodeId) {
      // As per test case design, throwing an error for self-transfer for consistency.
      throw new RaftValidationException("Cannot transfer leadership to self.");
    }

    const targetMatchIndex = this.matchIndex.get(targetPeerId) || 0;
    const lastLogIdx = this.log.getLastIndex();

    if (targetMatchIndex !== lastLogIdx) {
      this.logger.warn(`Target peer ${targetPeerId} is not fully up-to-date.`, {
        matchIndex: targetMatchIndex,
        lastLogIndex: lastLogIdx,
      });
      // For now, we proceed, but a more robust implementation might try to replicate missing entries first or fail.
      // Raft standard is that TimeoutNow should be sent regardless of log state, target campaigns if it can.
    }

    // Optional: Stop accepting new client commands here (e.g., set a flag)

    const timeoutNowRequest: TimeoutNowRequest = {
      term: this.currentTerm,
      leaderId: this.config.nodeId,
    };

    try {
      this.logger.info(`Sending TimeoutNowRequest to ${targetPeerId}`, {
        request: timeoutNowRequest,
      });
      await this.network.sendTimeoutNowRequest(targetPeerId, timeoutNowRequest);

      // After successfully sending, the current leader should facilitate the target winning.
      // Resetting its own election timer is a way to yield.
      this.logger.info(
        `TimeoutNowRequest sent to ${targetPeerId}. Resetting own election timer.`,
        { nodeId: this.config.nodeId },
      );
      this.startElectionTimer();
      // Optionally, could also transition to Follower here, but Raft paper suggests TimeoutNow is enough.
      // If it remains leader and target fails, it continues. If target succeeds, this node will become follower upon discovering higher term.
    } catch (error) {
      this.logger.error(`Failed to send TimeoutNowRequest to ${targetPeerId}`, {
        error,
      });
      // If sending fails, the leader continues its term.
      throw new RaftReplicationException(
        `Failed to send TimeoutNowRequest: ${error}`,
      );
    }
  }

  public async handleTimeoutNowRequest(
    request: TimeoutNowRequest,
  ): Promise<void> {
    this.logger.info("Received TimeoutNowRequest", {
      nodeId: this.config.nodeId,
      from: request.leaderId,
      requestTerm: request.term,
    });

    if (request.term < this.currentTerm) {
      this.logger.warn("Ignoring TimeoutNowRequest from an old term", {
        requestTerm: request.term,
        currentTerm: this.currentTerm,
      });
      return; // Do not send a response, as per Raft paper for RPCs with stale terms.
    }

    if (request.term > this.currentTerm) {
      this.logger.info(
        "Received TimeoutNowRequest from a higher term leader. Becoming follower.",
        { newTerm: request.term },
      );
      await this.becomeFollower(request.term);
      // Even if we become follower, if we are the target, we should still try to start an election for request.term + 1
      // However, the typical leadership transfer implies the target is in the same term or currentTerm+1.
      // If leader has much higher term, we just follow.
      // The standard TimeoutNow implies the target should start an election for *its* next term.
    }

    // At this point, request.term >= this.currentTerm.
    // If request.term > this.currentTerm, we've updated our term and become follower.
    // The leader is asking us to start an election *now*.

    this.logger.info(
      `Proceeding to start an election immediately due to TimeoutNowRequest from ${request.leaderId}.`,
      { currentTerm: this.currentTerm },
    );

    // We must campaign for a term higher than the term in the TimeoutNowRequest,
    // or higher than our currentTerm if it was already higher.
    // The `startElection` method will handle incrementing the term to `this.currentTerm + 1`.
    // If `request.term` was higher, `becomeFollower` would have updated `this.currentTerm`.
    // So `this.currentTerm + 1` should be the correct campaign term.
    // No, `startElection` expects to be called when the election timer fires for currentTerm.
    // If triggered by TimeoutNow, it needs to campaign for at least `request.term` if it's leader, or `request.term + 1`.
    // The candidate always increments its term.
    // If request.term == this.currentTerm, then this node should campaign for this.currentTerm + 1.
    // If request.term > this.currentTerm, this node became follower at request.term, then should campaign for request.term + 1.
    // So, effectively, it's always this.currentTerm (which might have just been updated) + 1.
    // The `startElection` method handles this `this.currentTerm + 1` logic via `prospectiveTerm`.

    // Clear existing election timer as we are starting one now.
    this.clearElectionTimer();
    // Directly call startElection, bypassing Pre-Vote.
    // The startElection method handles term increment.
    void this.startElection(true); // Pass true to bypass Pre-Vote
  }

  public async handlePreVoteRequest(
    request: PreVoteRequest,
  ): Promise<PreVoteResponse> {
    this.logger.debug("Handling PreVoteRequest", {
      nodeId: this.config.nodeId,
      request,
    });

    // Reply false if candidate's term is less than current term.
    // This is a strict check: pre-vote is for a *future* term.
    if (request.term < this.currentTerm) {
      this.logger.info(
        "Rejecting PreVote: Candidate term lower than current term.",
        { candidateTerm: request.term, currentTerm: this.currentTerm },
      );
      return { term: this.currentTerm, voteGranted: false };
    }

    // If candidate's term is equal to current term, it means they haven't incremented yet for pre-vote.
    // Or, if this node has a higher term already, the candidate would not win.
    // Pre-vote implies candidate *will* increment term if pre-vote succeeds.
    // So, a pre-vote request.term should ideally be currentTerm + 1 from candidate's perspective.
    // We grant pre-vote if their term is strictly greater OR if their log is more up-to-date in the same term they are campaigning for.
    // However, the most common rule is: grant pre-vote if candidate's term > currentTerm AND log is up-to-date.
    // Let's use the stricter interpretation: candidate's *prospective* term must be > currentTerm.
    if (request.term <= this.currentTerm) {
      this.logger.info(
        "Rejecting PreVote: Candidate prospective term not greater than current term.",
        { candidateTerm: request.term, currentTerm: this.currentTerm },
      );
      return { term: this.currentTerm, voteGranted: false };
    }

    // Check if candidate's log is at least as up-to-date as receiver's log.
    const localLastLogTerm = this.log.getLastTerm();
    const localLastLogIndex = this.log.getLastIndex();

    const logIsOk =
      request.lastLogTerm > localLastLogTerm ||
      (request.lastLogTerm === localLastLogTerm &&
        request.lastLogIndex >= localLastLogIndex);

    if (!logIsOk) {
      this.logger.info(
        "Rejecting PreVote: Candidate log is not as up-to-date.",
        {
          candidateLastLogTerm: request.lastLogTerm,
          candidateLastLogIndex: request.lastLogIndex,
          localLastLogTerm,
          localLastLogIndex,
        },
      );
      return { term: this.currentTerm, voteGranted: false };
    }

    // If all checks pass, grant pre-vote.
    // Importantly, DO NOT change this.currentTerm or this.votedFor.
    this.logger.info("Granting PreVote.", {
      candidateId: request.candidateId,
      candidateTerm: request.term,
    });
    return { term: this.currentTerm, voteGranted: true };
  }

  public async handleVoteRequest(request: VoteRequest): Promise<VoteResponse> {
    this.logger.debug("Handling VoteRequest", {
      nodeId: this.config.nodeId,
      request,
    });

    // Calculate voter weight for this node
    const voterWeight = this.weightCalculator.calculateWeight(
      this.config.nodeId,
    );

    // If candidate's term < currentTerm, reply false
    if (request.term < this.currentTerm) {
      this.logger.info(
        "Rejecting vote: Candidate term lower than current term",
        {
          candidateTerm: request.term,
          currentTerm: this.currentTerm,
        },
      );
      return { term: this.currentTerm, voteGranted: false, voterWeight };
    }

    // If candidate's term > currentTerm, update currentTerm and become follower
    if (request.term > this.currentTerm) {
      this.logger.info(
        "Received vote request from higher term, becoming follower",
        {
          newTerm: request.term,
          oldTerm: this.currentTerm,
        },
      );
      await this.becomeFollower(request.term);
    }

    // Check if we already voted for someone else in this term
    if (this.votedFor !== null && this.votedFor !== request.candidateId) {
      this.logger.info("Rejecting vote: Already voted for another candidate", {
        votedFor: this.votedFor,
        candidateId: request.candidateId,
      });
      return { term: this.currentTerm, voteGranted: false, voterWeight };
    }

    // Check if candidate's log is at least as up-to-date as receiver's log
    const localLastLogTerm = this.log.getLastTerm();
    const localLastLogIndex = this.log.getLastIndex();

    const logIsOk =
      request.lastLogTerm > localLastLogTerm ||
      (request.lastLogTerm === localLastLogTerm &&
        request.lastLogIndex >= localLastLogIndex);

    if (!logIsOk) {
      this.logger.info("Rejecting vote: Candidate log is not as up-to-date", {
        candidateLastLogTerm: request.lastLogTerm,
        candidateLastLogIndex: request.lastLogIndex,
        localLastLogTerm,
        localLastLogIndex,
      });
      return { term: this.currentTerm, voteGranted: false, voterWeight };
    }

    // Grant vote
    this.votedFor = request.candidateId;
    await this.persistState();
    this.startElectionTimer(); // Reset election timer when granting vote

    this.logger.info("Granting vote", {
      candidateId: request.candidateId,
      term: this.currentTerm,
    });

    return { term: this.currentTerm, voteGranted: true, voterWeight };
  }

  public async handleAppendEntries(
    request: AppendEntriesRequest,
  ): Promise<AppendEntriesResponse> {
    this.logger.debug("Handling AppendEntriesRequest", {
      nodeId: this.config.nodeId,
      request: {
        term: request.term,
        leaderId: request.leaderId,
        prevLogIndex: request.prevLogIndex,
        prevLogTerm: request.prevLogTerm,
        entriesCount: request.entries.length,
        leaderCommit: request.leaderCommit,
      },
    });

    // If leader's term < currentTerm, reply false
    if (request.term < this.currentTerm) {
      this.logger.info(
        "Rejecting AppendEntries: Leader term lower than current term",
        {
          leaderTerm: request.term,
          currentTerm: this.currentTerm,
        },
      );
      return {
        term: this.currentTerm,
        success: false,
        lastLogIndex: this.log.getLastIndex(),
      };
    }

    // If leader's term >= currentTerm, recognize leader and become follower
    if (request.term >= this.currentTerm) {
      if (
        request.term > this.currentTerm ||
        this.state !== RaftState.FOLLOWER
      ) {
        this.logger.info(
          "Received AppendEntries from valid leader, becoming follower",
          {
            newTerm: request.term,
            leaderId: request.leaderId,
          },
        );
        await this.becomeFollower(request.term);
      }
      // Reset election timer as we heard from the leader
      this.startElectionTimer();
    }

    // Check if log contains an entry at prevLogIndex with prevLogTerm
    if (request.prevLogIndex > 0) {
      const prevEntry = this.log.getEntry(request.prevLogIndex);
      if (!prevEntry || prevEntry.term !== request.prevLogTerm) {
        this.logger.info("Rejecting AppendEntries: Log inconsistency", {
          prevLogIndex: request.prevLogIndex,
          prevLogTerm: request.prevLogTerm,
          actualEntry: prevEntry,
        });
        return {
          term: this.currentTerm,
          success: false,
          lastLogIndex: this.log.getLastIndex(),
        };
      }
    }

    // Append new entries - the appendEntries method handles conflicts internally
    if (request.entries.length > 0) {
      await this.log.appendEntries(
        request.entries as LogEntry<TCommand>[],
        request.prevLogIndex,
        request.prevLogTerm,
      );
      this.logger.info("Appended new entries to log", {
        count: request.entries.length,
        lastIndex: this.log.getLastIndex(),
      });
    }

    // Update commit index
    if (request.leaderCommit > this.commitIndex) {
      const newCommitIndex = Math.min(
        request.leaderCommit,
        this.log.getLastIndex(),
      );
      this.logger.info("Updating commit index", {
        oldCommitIndex: this.commitIndex,
        newCommitIndex,
      });
      this.commitIndex = newCommitIndex;
      await this.applyCommittedEntries();
    }

    return {
      term: this.currentTerm,
      success: true,
      lastLogIndex: this.log.getLastIndex(),
    };
  }
}
