import { RaftState, RaftEngine } from "@usex/raft";
import type { RaftNode } from "@usex/raft";
import type { PlaygroundConfig } from "./config";
import { DEFAULT_PLAYGROUND_CONFIG, createRaftConfig } from "./config";
import { PlaygroundLogger } from "./logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";
import { KVStateMachine } from "../state-machines/kv-state-machine";
import Redis from "ioredis";

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
  config: any;
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
  private logger: PlaygroundLogger;
  private redis: Redis;
  private readonly clusterId: string;
  private readonly config: PlaygroundConfig;

  constructor(
    clusterId: string = "playground-cluster",
    config: PlaygroundConfig = DEFAULT_PLAYGROUND_CONFIG,
  ) {
    this.clusterId = clusterId;
    this.config = config;
    this.raftEngine = new RaftEngine();
    this.logger = new PlaygroundLogger();

    // Setup Redis connection for cleanup
    this.redis = new Redis({
      host: config.cluster.redisHost,
      port: config.cluster.redisPort,
    });
  }

  async createCluster(
    size: number = 3,
    stateMachineType: StateMachineType = "counter",
  ): Promise<NodeInfo[]> {
    this.logger.info(`Creating cluster with ${size} nodes`);

    // Clean up any existing data
    await this.cleanup();

    const nodes: NodeInfo[] = [];

    for (let i = 0; i < size; i++) {
      const nodeId = `node-${i}`;
      const nodeInfo = await this.createNode(nodeId, stateMachineType);
      nodes.push(nodeInfo);
    }

    // Start all nodes
    for (const nodeInfo of nodes) {
      await nodeInfo.node.start();
      this.logger.success(`Started node ${nodeInfo.nodeId}`);
    }

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
      const nodeInfo = await this.createNode(nodeId, stateMachineType);
      // Store weight information (in a real implementation, this would be part of the configuration)
      nodeInfo.weight = weight;
      nodes.push(nodeInfo);
    }

    // Start all nodes
    for (const nodeInfo of nodes) {
      await nodeInfo.node.start();
      this.logger.success(
        `Started weighted node ${nodeInfo.nodeId} (weight: ${nodeInfo.weight})`,
      );
    }

    // Wait for cluster to stabilize
    await this.waitForStability();

    return nodes;
  }

  async createNode(
    nodeId: string,
    stateMachineType: StateMachineType = "counter",
  ): Promise<NodeInfo> {
    this.logger.info(`Creating node ${nodeId}`);

    const raftConfig = createRaftConfig(nodeId, this.clusterId, this.config);

    // Create state machine
    let stateMachine: CounterStateMachine | KVStateMachine;
    switch (stateMachineType) {
      case "counter":
        stateMachine = new CounterStateMachine(nodeId);
        break;
      case "kv":
        stateMachine = new KVStateMachine(nodeId, {
          host: this.config.cluster.redisHost,
          port: this.config.cluster.redisPort,
          db: parseInt(nodeId.split("-")[1]!) + 1, // Use different DB for each node
          keyPrefix: `playground:${this.clusterId}:`,
        });
        break;
      default:
        throw new Error(`Unknown state machine type: ${stateMachineType}`);
    }

    // Create Raft node
    const node = await this.raftEngine.createNode(raftConfig, stateMachine);

    const nodeInfo: NodeInfo = {
      nodeId,
      node,
      stateMachine,
      config: raftConfig,
      port: raftConfig.httpPort,
    };

    this.nodes.set(nodeId, nodeInfo);
    return nodeInfo;
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

    return nodeInfo;
  }

  async removeNode(nodeId: string): Promise<void> {
    const nodeInfo = this.nodes.get(nodeId);
    if (!nodeInfo) {
      throw new Error(`Node ${nodeId} not found`);
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
    await this.delay(1000);

    // Recreate the node with fresh connections
    const newNodeInfo = await this.createNode(
      nodeId,
      nodeInfo.stateMachine instanceof CounterStateMachine ? "counter" : "kv",
    );

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
    return this.getAllNodes().find(
      (node) => node.node.getState() === RaftState.LEADER,
    );
  }

  getFollowers(): NodeInfo[] {
    return this.getAllNodes().filter(
      (node) => node.node.getState() === RaftState.FOLLOWER,
    );
  }

  getCandidates(): NodeInfo[] {
    return this.getAllNodes().filter(
      (node) => node.node.getState() === RaftState.CANDIDATE,
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
      activeNodes: allNodes.length, // Simplified - could check actual health
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
    this.logger.info(
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
      const allNodes = this.getAllNodes();

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
        this.logger.debug("Cluster not stable yet", {
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

    // Stop nodes in partition2 to simulate network split
    for (const nodeId of partition2) {
      await this.stopNode(nodeId);
    }

    this.logger.info(
      `Partition created: [${partition1.join(", ")}] | [${partition2.join(", ")}]`,
    );
  }

  async healNetworkPartition(partition2: string[]): Promise<void> {
    this.logger.info("Healing network partition");

    // Restart nodes in partition2
    for (const nodeId of partition2) {
      await this.startNode(nodeId);
    }

    await this.waitForStability();
    this.logger.success("Network partition healed");
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async cleanup(): Promise<void> {
    this.logger.info("Cleaning up cluster");

    // Step 1: Reset circuit breakers to prevent cascading failures
    this.resetAllCircuitBreakers();

    // Step 2: Signal cluster shutdown to all nodes by clearing Redis peer data first
    // This allows remaining nodes to detect they're in single-node state
    try {
      const peerPattern = `raft:cluster:${this.clusterId}:node:*`;
      const keys = await this.redis.keys(peerPattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      this.logger.debug(
        `Cleared peer discovery data for cluster ${this.clusterId}`,
      );
    } catch (_error) {
      this.logger.warn(
        "Failed to clear peer discovery data",
        undefined,
        _error,
      );
    }

    // Step 3: Wait for nodes to detect single-node state and stabilize
    await this.delay(2000);

    // Step 4: Gracefully stop all nodes after they've had time to adapt
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

    // Step 5: Wait for circuit breakers to reset and operations to complete
    // Circuit breaker timeout is typically 5 seconds, so wait 6 seconds to be safe
    await this.delay(6000);

    // Step 6: Clear remaining Redis data for this cluster
    try {
      const patterns = [
        `raft:cluster:${this.clusterId}:queue:*`,
        `raft:cluster:${this.clusterId}:responses:*`,
      ];

      for (const pattern of patterns) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }

      this.logger.debug(
        `Cleared remaining Redis data for cluster ${this.clusterId}`,
      );
    } catch (_error) {
      this.logger.warn(
        "Failed to clear remaining Redis data",
        undefined,
        _error,
      );
    }

    // Step 7: Final cleanup - remove from RaftEngine and clean up state machines
    for (const nodeInfo of this.nodes.values()) {
      try {
        // Remove from RaftEngine tracking
        this.raftEngine.removeNode(nodeInfo.nodeId);

        // Clean up state machine if it has a cleanup method
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

    // Step 8: Final cleanup
    this.nodes.clear();
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
