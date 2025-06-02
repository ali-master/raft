import { EventEmitter } from "node:events";
import Redis from "ioredis";
import { RaftEvent } from "../types";
import type {
  VoteResponse,
  VoteRequest,
  RaftMetrics,
  RaftConfiguration,
  PeerInfo,
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

export class RaftNode extends EventEmitter {
  private readonly config: RaftConfiguration;
  private readonly storage: Redis;
  private readonly log: RaftLog;
  private readonly network: RaftNetwork;
  private readonly metrics: RaftMetricsCollector;
  private readonly weightCalculator: VoteWeightCalculator;
  private readonly eventBus: RaftEventBus;
  private readonly logger: RaftLogger;
  private readonly retry: RetryStrategy;
  private readonly peerDiscovery: PeerDiscoveryService;

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

  constructor(config: RaftConfiguration) {
    super();
    this.config = config;
    this.logger = new RaftLogger(config.logging);
    this.retry = new RetryStrategy(config.retry);
    this.metrics = new RaftMetricsCollector(config.metrics);
    this.eventBus = new RaftEventBus();

    this.storage = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db || 0,
    });

    this.log = new RaftLog(this.storage, config.nodeId, this.logger, config);
    this.peerDiscovery = new PeerDiscoveryService(
      this.storage,
      config,
      this.logger,
    );
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
      await this.loadPersistedState();

      // Initialize WAL if enabled
      await this.log.initializeWALEngine();

      await this.log.loadFromStorage();
      await this.peerDiscovery.start();

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

  public async appendLog(command: any): Promise<boolean> {
    if (this.state !== RaftState.LEADER) {
      throw new RaftValidationException("Only leader can append logs");
    }

    try {
      const index = await this.log.appendEntry(this.currentTerm, command);
      await this.replicateLogToFollowers();

      this.publishEvent(RaftEventType.LOG_REPLICATED, {
        index,
        command,
        term: this.currentTerm,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to append log", {
        error,
        nodeId: this.config.nodeId,
      });
      throw new RaftReplicationException(`Failed to append log: ${error}`);
    }
  }

  public getState(): RaftState {
    return this.state;
  }

  public getCurrentTerm(): number {
    return this.currentTerm;
  }

  public getMetrics(): RaftMetrics | undefined {
    return this.metrics.getMetrics(this.config.nodeId);
  }

  public async getPrometheusMetrics(): Promise<string> {
    return await this.metrics.getPrometheusMetrics();
  }

  public getPeers(): string[] {
    return this.peerDiscovery.getPeers();
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

  private publishEvent(type: RaftEventType, data: any): void {
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

  private async startElection(): Promise<void> {
    try {
      this.state = RaftState.CANDIDATE;
      this.currentTerm++;
      this.votedFor = this.config.nodeId;

      await this.persistState();
      await this.peerDiscovery.updatePeerState(
        this.config.nodeId,
        this.state,
        this.currentTerm,
      );
      this.startElectionTimer();

      this.logger.info("Starting election", {
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
      const totalWeight = this.calculateTotalWeight(votes);
      const requiredWeight = Math.floor(totalWeight / 2) + 1;

      if (this.calculateReceivedWeight(votes) >= requiredWeight) {
        await this.becomeLeader();
      } else {
        void this.becomeFollower();
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
      } else {
        // Decrement nextIndex and retry
        const currentNext = this.nextIndex.get(peerId) || 0;
        this.nextIndex.set(peerId, Math.max(0, currentNext - 1));
        await this.replicateLogToPeer(peerId);
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
}
