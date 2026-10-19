import { RaftState, RaftEngine } from "@usex/raft";
import type { RaftNode, RaftConfiguration } from "@usex/raft";
import type { PlaygroundConfig } from "./config";
import { DEFAULT_PLAYGROUND_CONFIG, createRaftConfig } from "./config";
import { PlaygroundLogger } from "./logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";
import { KVStateMachine } from "../state-machines/kv-state-machine";
import Redis from "ioredis";
import type { PlaygroundDashboard } from "../dashboard/server";
import { ObservatoryStateMachine } from "../dashboard/commands";

export type StateMachineType = "counter" | "kv";

export interface CleanupableStateMachine {
  cleanup: () => Promise<void>;
}

export interface ExtendedRaftNode {
  clearTimers: () => void;
  redisListenerActive: boolean;
  peerDiscovery: {
    stop: () => Promise<void>;
  };
  network: {
    resetCircuitBreakers: () => void;
  };
}

export interface NodeInfo {
  nodeId: string;
  node: RaftNode;
  stateMachine: CounterStateMachine | KVStateMachine;
  config: RaftConfiguration;
  port: number;
  weight?: number;
}

export interface ClusterMetrics {
  totalNodes: number;
  activeNodes: number;
  leader?: string;
  followers: string[];
  candidates: string[];
  term: number;
  commitIndex: number;
}

export class ClusterManager {
  private nodes: Map<string, NodeInfo> = new Map();
  private raftEngine: RaftEngine;
  private logger: InstanceType<typeof PlaygroundLogger>;
  private readonly blockedLinks = new Set<string>();
  private readonly clusterId: string;
  private readonly config: PlaygroundConfig;
  private dashboard?: PlaygroundDashboard;

  constructor(
    clusterId: string = "playground-cluster",
    config: PlaygroundConfig = DEFAULT_PLAYGROUND_CONFIG,
  ) {
    this.clusterId = clusterId;
    this.config = config;
    this.raftEngine = new RaftEngine();
    this.logger = new PlaygroundLogger();
  }

  async createCluster(
    size: number = 3,
    stateMachineType: StateMachineType = "counter",
  ): Promise<NodeInfo[]> {
    this.logger.info(`Creating cluster with ${size} nodes`);

    // Clean up any existing data
    await this.cleanup();

    const nodes: NodeInfo[] = [];

    const peerIds = Array.from({ length: size }, (_, i) => `node-${i}`);
    for (const nodeId of peerIds) {
      const config = createRaftConfig(nodeId, this.clusterId, this.config);
      config.peers = peerIds;
      const nodeInfo = await this.createNode(nodeId, stateMachineType, config);
      nodes.push(nodeInfo);
    }

    // Start all nodes simultaneously to avoid timing issues
    this.logger.info("Starting all nodes simultaneously...");
    const startPromises = nodes.map(async (nodeInfo) => {
      await nodeInfo.node.start();
      this.logger.success(`Started node ${nodeInfo.nodeId}`);
      return nodeInfo;
    });

    await Promise.all(startPromises);

    // Add extra delay to ensure all Redis listeners are fully initialized
    this.logger.info("Waiting for all Redis listeners to initialize...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Wait for cluster to stabilize
    await this.waitForStability();

    return nodes;
  }

  async createWeightedCluster(
    nodeWeights: Record<string, number>,
    stateMachineType: StateMachineType = "counter",
  ): Promise<NodeInfo[]> {
    this.logger.info(
      `Creating weighted cluster with ${Object.keys(nodeWeights).length} nodes`,
    );

    // Clean up any existing data
    await this.cleanup();

    const nodes: NodeInfo[] = [];

    for (const [nodeId, weight] of Object.entries(nodeWeights)) {
      const config = createRaftConfig(nodeId, this.clusterId, this.config);
      config.peers = Object.keys(nodeWeights);
      config.voting = {
        enableWeighting: true,
        weights: nodeWeights,
        defaultWeight: weight,
        weightMetrics: [],
      };
      const nodeInfo = await this.createNode(nodeId, stateMachineType, config);
      nodeInfo.weight = weight;
      nodes.push(nodeInfo);
    }

    // Start all nodes simultaneously to avoid timing issues
    this.logger.info("Starting all weighted nodes simultaneously...");
    const startPromises = nodes.map(async (nodeInfo) => {
      await nodeInfo.node.start();
      this.logger.success(
        `Started weighted node ${nodeInfo.nodeId} (weight: ${nodeInfo.weight})`,
      );
      return nodeInfo;
    });

    await Promise.all(startPromises);

    // Add extra delay to ensure all Redis listeners are fully initialized
    this.logger.info("Waiting for all Redis listeners to initialize...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Wait for cluster to stabilize
    await this.waitForStability();

    return nodes;
  }

  async createNode(
    nodeId: string,
    stateMachineType: StateMachineType = "counter",
    raftConfig: RaftConfiguration = createRaftConfig(
      nodeId,
      this.clusterId,
      this.config,
    ),
  ): Promise<NodeInfo> {
    await this.enableDashboard();
    this.logger.info(`Creating node ${nodeId}`);
    raftConfig.peers ??= [...new Set([...this.nodes.keys(), nodeId])];

    // Create state machine
    let stateMachine: CounterStateMachine | KVStateMachine;
    switch (stateMachineType) {
      case "counter":
        stateMachine = this.dashboard?.controls
          ? new ObservatoryStateMachine(nodeId)
          : new CounterStateMachine(nodeId);
        break;
      case "kv":
        stateMachine = new KVStateMachine(nodeId, {
          host: this.config.cluster.redisHost,
          port: this.config.cluster.redisPort,
          db: 0,
          keyPrefix: `playground:${this.clusterId}:`,
        });
        break;
      default:
        throw new Error(`Unknown state machine type: ${stateMachineType}`);
    }

    // Create Raft node
    const node = await this.raftEngine.createNode(raftConfig, stateMachine);
    // Fault injection stays in the playground; running nodes retain their voting membership.
    const { network } = node as unknown as {
      network: {
        sendMessage: (
          target: string,
          type: unknown,
          payload: object,
        ) => Promise<unknown>;
      };
    };
    const send = network.sendMessage.bind(network);
    network.sendMessage = async (target, type, payload) => {
      if (this.blockedLinks.has(`${nodeId}->${target}`)) {
        this.dashboard?.rpc(nodeId, target, type, payload, "blocked");
        throw new Error(`Simulated partition: ${nodeId} -> ${target}`);
      }
      const start = performance.now();
      this.dashboard?.rpc(nodeId, target, type, payload, "sent");
      try {
        const result = await send(target, type, payload);
        this.dashboard?.rpc(
          nodeId,
          target,
          type,
          payload,
          "received",
          performance.now() - start,
        );
        return result;
      } catch (error) {
        this.dashboard?.rpc(
          nodeId,
          target,
          type,
          payload,
          "failed",
          performance.now() - start,
          String(error),
        );
        throw error;
      }
    };

    const nodeInfo: NodeInfo = {
      nodeId,
      node,
      stateMachine,
      config: raftConfig,
      port: raftConfig.httpPort,
    };

    this.nodes.set(nodeId, nodeInfo);
    this.dashboard?.observe(nodeInfo);
    return nodeInfo;
  }

  async enableDashboard(
    controls = false,
  ): Promise<PlaygroundDashboard | undefined> {
    if (this.dashboard) return this.dashboard;
    if (
      !controls &&
      (process.env.RAFT_DASHBOARD === "0" ||
        process.env.CI ||
        process.env.VITEST)
    )
      return;
    const { PlaygroundDashboard } = await import("../dashboard/server");
    const dashboard = new PlaygroundDashboard(this, this.clusterId, controls);
    try {
      await dashboard.start({ keepAlive: controls });
      this.dashboard = dashboard;
      return dashboard;
    } catch (error) {
      if (controls) throw error;
      this.logger.warn("Could not start the dashboard", undefined, error);
    }
  }

  getBlockedLinks(): string[] {
    return [...this.blockedLinks];
  }

  async addNode(
    nodeId: string,
    stateMachineType: StateMachineType = "counter",
  ): Promise<NodeInfo> {
    const nodeInfo = await this.createNode(nodeId, stateMachineType);
    await nodeInfo.node.start();

    this.logger.success(`Added and started node ${nodeId}`);

    // Wait for the new node to be discovered
    await this.delay(2000);
    const leader = this.getLeader();
    if (!leader) throw new Error("No leader available for membership change");
    await leader.node.changeClusterConfiguration([...this.nodes.keys()]);
    await this.waitForStability();

    return nodeInfo;
  }

  async removeNode(nodeId: string): Promise<void> {
    const nodeInfo = this.nodes.get(nodeId);
    if (!nodeInfo) {
      throw new Error(`Node ${nodeId} not found`);
    }

    let leader = this.getLeader();
    if (leader?.nodeId === nodeId && this.nodes.size > 1) {
      const target = this.getFollowers()[0];
      if (!target)
        throw new Error("No follower available for leadership transfer");
      await leader.node.transferLeadership(target.nodeId);
      await this.waitForStability();
      leader = this.getLeader();
    }
    if (leader && this.nodes.size > 1) {
      await leader.node.changeClusterConfiguration(
        [...this.nodes.keys()].filter((id) => id !== nodeId),
      );
    }
    await nodeInfo.node.stop();

    // Cleanup state machine if it has a cleanup method
    if ("cleanup" in nodeInfo.stateMachine) {
      await (nodeInfo.stateMachine as CleanupableStateMachine).cleanup();
    }

    // Remove from both ClusterManager and RaftEngine
    this.nodes.delete(nodeId);
    this.raftEngine.removeNode(nodeId);
    this.logger.success(`Removed node ${nodeId}`);
  }

  async stopNode(nodeId: string): Promise<void> {
    const nodeInfo = this.nodes.get(nodeId);
    if (!nodeInfo) {
      throw new Error(`Node ${nodeId} not found`);
    }

    await nodeInfo.node.stop();
    this.logger.warn(`Stopped node ${nodeId}`);
  }

  async startNode(nodeId: string): Promise<void> {
    const nodeInfo = this.nodes.get(nodeId);
    if (!nodeInfo) {
      throw new Error(`Node ${nodeId} not found`);
    }

    await nodeInfo.node.start();
    this.logger.success(`Started node ${nodeId}`);
  }

  async restartNode(nodeId: string): Promise<void> {
    const nodeInfo = this.nodes.get(nodeId);
    if (!nodeInfo) {
      throw new Error(`Node ${nodeId} not found`);
    }

    // Stop the node
    await this.stopNode(nodeId);

    // Remove the node from the RaftEngine to allow recreation
    this.raftEngine.removeNode(nodeId);
    if ("cleanup" in nodeInfo.stateMachine)
      await nodeInfo.stateMachine.cleanup();

    // Recreate the node with fresh connections
    const newNodeInfo = await this.createNode(
      nodeId,
      nodeInfo.stateMachine instanceof CounterStateMachine ? "counter" : "kv",
      nodeInfo.config,
    );
    if (nodeInfo.weight !== undefined) newNodeInfo.weight = nodeInfo.weight;

    // Start the new node
    await newNodeInfo.node.start();
    this.logger.success(`Restarted node ${nodeId}`);
  }

  getNode(nodeId: string): NodeInfo | undefined {
    return this.nodes.get(nodeId);
  }

  getAllNodes(): NodeInfo[] {
    return Array.from(this.nodes.values());
  }

  getLeader(): NodeInfo | undefined {
    return this.getAllNodes()
      .filter(
        (node) =>
          node.node.isRunning() && node.node.getState() === RaftState.LEADER,
      )
      .sort(
        (left, right) =>
          right.node.getCurrentTerm() - left.node.getCurrentTerm(),
      )[0];
  }

  getFollowers(): NodeInfo[] {
    return this.getAllNodes().filter(
      (node) =>
        node.node.isRunning() && node.node.getState() === RaftState.FOLLOWER,
    );
  }

  getCandidates(): NodeInfo[] {
    return this.getAllNodes().filter(
      (node) =>
        node.node.isRunning() && node.node.getState() === RaftState.CANDIDATE,
    );
  }

  async getMetrics(): Promise<ClusterMetrics> {
    const allNodes = this.getAllNodes();
    const leader = this.getLeader();
    const followers = this.getFollowers();
    const candidates = this.getCandidates();

    let term = 0;
    let commitIndex = 0;

    if (leader) {
      term = leader.node.getCurrentTerm();
      commitIndex = leader.node.getCommitIndex();
    } else if (allNodes.length > 0) {
      // Get term from any node if no leader
      term = allNodes[0]!.node.getCurrentTerm();
    }

    const metrics: ClusterMetrics = {
      totalNodes: allNodes.length,
      activeNodes: allNodes.filter((info) => info.node.isRunning()).length,
      followers: followers.map((n) => n.nodeId),
      candidates: candidates.map((n) => n.nodeId),
      term,
      commitIndex,
    };

    if (leader?.nodeId) {
      metrics.leader = leader.nodeId;
    }

    return metrics;
  }

  async appendToLeader(command: any): Promise<void> {
    const leader = this.getLeader();
    if (!leader) {
      throw new Error("No leader available");
    }

    await leader.node.appendLog(command);
    this.logger.debug(
      `Appended command to leader ${leader.nodeId}`,
      undefined,
      command,
    );
  }

  async waitForStability(timeoutMs: number = 10000): Promise<void> {
    this.logger.info("Waiting for cluster stability...");

    const start = Date.now();
    let stableCount = 0;
    const requiredStableChecks = 5; // Must be stable for 5 consecutive checks

    while (Date.now() - start < timeoutMs) {
      const leader = this.getLeader();
      const followers = this.getFollowers();
      const candidates = this.getCandidates();
      const allNodes = this.getAllNodes().filter((info) =>
        info.node.isRunning(),
      );

      // Check if cluster is stable
      const isStable =
        leader &&
        candidates.length === 0 &&
        followers.length === allNodes.length - 1 &&
        allNodes.every((node) => {
          const term = node.node.getCurrentTerm();
          return leader.node.getCurrentTerm() === term;
        });

      if (isStable) {
        stableCount++;
        this.logger.debug(
          `Stability check ${stableCount}/${requiredStableChecks}`,
          leader?.nodeId,
          {
            leader: leader.nodeId,
            followers: followers.length,
            candidates: candidates.length,
            term: leader.node.getCurrentTerm(),
          },
        );

        if (stableCount >= requiredStableChecks) {
          this.logger.success(`Cluster stable with leader: ${leader.nodeId}`);
          return;
        }
      } else {
        stableCount = 0; // Reset counter if not stable
        this.logger.debug("Cluster not stable yet", leader?.nodeId, {
          hasLeader: !!leader,
          followers: followers.length,
          candidates: candidates.length,
          totalNodes: allNodes.length,
        });
      }

      await this.delay(200);
    }

    throw new Error("Cluster failed to stabilize within timeout");
  }

  async simulateNetworkPartition(
    partition1: string[],
    partition2: string[],
  ): Promise<void> {
    this.logger.warn("Simulating network partition");

    for (const left of partition1) {
      for (const right of partition2) {
        this.blockedLinks.add(`${left}->${right}`);
        this.blockedLinks.add(`${right}->${left}`);
      }
    }

    this.logger.info(
      `Partition created: [${partition1.join(", ")}] | [${partition2.join(", ")}]`,
    );
  }

  async healNetworkPartition(partition2: string[]): Promise<void> {
    this.logger.info("Healing network partition");

    for (const link of this.blockedLinks) {
      const [from, to] = link.split("->");
      if (partition2.includes(from!) || partition2.includes(to!))
        this.blockedLinks.delete(link);
    }
    if (this.blockedLinks.size === 0) await this.waitForStability(20000);
    this.logger.success("Network partition healed");
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async cleanup(): Promise<void> {
    this.logger.info("Cleaning up cluster");

    // Step 1: Stop all nodes immediately - this cancels pending network
    // operations via network.shutdown() which resolves blocked brpop calls
    const stopPromises = Array.from(this.nodes.values()).map(
      async (nodeInfo) => {
        try {
          this.logger.debug(`Stopping node ${nodeInfo.nodeId}`);
          await nodeInfo.node.stop();
        } catch (_error) {
          this.logger.warn(
            `Error stopping node ${nodeInfo.nodeId}`,
            undefined,
            _error,
          );
        }
      },
    );

    // Wait for all nodes to stop gracefully
    await Promise.allSettled(stopPromises);

    // Brief pause for any lingering Redis operations to settle
    await this.delay(500);

    // Step 2: Clear only data owned by this playground cluster.
    const redis = new Redis({
      host: this.config.cluster.redisHost,
      port: this.config.cluster.redisPort,
    });
    try {
      const patterns = [
        `raft:cluster:${this.clusterId}:node:*`,
        `raft:cluster:${this.clusterId}:queue:*`,
        `raft:cluster:${this.clusterId}:responses:*`,
        `playground:${this.clusterId}:*`,
        `raft:${this.clusterId}:*`,
      ];

      for (const pattern of patterns) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }

      this.logger.debug(`Cleared Redis data for cluster ${this.clusterId}`);
    } catch (_error) {
      this.logger.warn("Failed to clear Redis data", undefined, _error);
    } finally {
      redis.disconnect();
    }

    // Step 3: Clear filesystem persistence data
    try {
      const fs = await import("fs/promises");
      const persistenceDir = `/tmp/raft-playground/${this.clusterId}`;

      try {
        await fs.rm(persistenceDir, { recursive: true, force: true });
        this.logger.debug(`Cleared persistence directory: ${persistenceDir}`);
      } catch (error) {
        this.logger.warn(
          `Failed to clear persistence directory: ${persistenceDir}`,
          undefined,
          error,
        );
      }
    } catch (error) {
      this.logger.warn("Failed to import fs/path modules", undefined, error);
    }

    // Step 4: Remove from RaftEngine and clean up state machines
    for (const nodeInfo of this.nodes.values()) {
      try {
        this.raftEngine.removeNode(nodeInfo.nodeId);

        if ("cleanup" in nodeInfo.stateMachine) {
          await (nodeInfo.stateMachine as CleanupableStateMachine).cleanup();
        }
      } catch (_error) {
        this.logger.error(
          `Error cleaning up node ${nodeInfo.nodeId}`,
          undefined,
          _error,
        );
      }
    }

    // Step 5: Clear internal state
    if (this.nodes.size) await this.dashboard?.complete();
    this.nodes.clear();
    this.blockedLinks.clear();
    this.logger.success("Cluster cleanup completed");
  }

  public resetAllCircuitBreakers(): void {
    this.logger.info("Resetting circuit breakers for all nodes");
    for (const nodeInfo of this.nodes.values()) {
      try {
        // Access the network property to reset circuit breakers
        const extendedNode = nodeInfo.node as unknown as ExtendedRaftNode;
        if (
          extendedNode.network &&
          typeof extendedNode.network.resetCircuitBreakers === "function"
        ) {
          extendedNode.network.resetCircuitBreakers();
        }
      } catch (_error) {
        this.logger.warn(
          `Failed to reset circuit breakers for ${nodeInfo.nodeId}`,
          undefined,
          _error,
        );
      }
    }
  }

  public async waitForCircuitBreakerRecovery(
    timeoutMs: number = 15000,
  ): Promise<void> {
    this.logger.info("Waiting for circuit breakers to recover...");

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // Reset circuit breakers to speed up recovery
      this.resetAllCircuitBreakers();

      // Wait for circuit breakers to fully reset
      await this.delay(1000);

      // Check if cluster can stabilize after circuit breaker reset
      try {
        await this.waitForStability(5000);
        this.logger.success(
          "Circuit breakers recovered and cluster stabilized",
        );
        return;
      } catch {
        this.logger.debug("Circuit breakers still recovering...");
      }
    }

    throw new Error("Circuit breakers failed to recover within timeout");
  }

  public async waitForClusterSync(timeoutMs: number = 15000): Promise<void> {
    this.logger.info("Waiting for cluster to synchronize...");

    // First reset circuit breakers
    this.resetAllCircuitBreakers();

    // Wait for circuit breakers to recover
    await this.waitForCircuitBreakerRecovery(timeoutMs);

    // Then wait for stability
    await this.waitForStability(timeoutMs);

    this.logger.success("Cluster synchronized successfully");
  }
}
