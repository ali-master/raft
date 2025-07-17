import type { StateMachine, RaftConfiguration } from "./types";
import { LogLevel } from "./constants";
import { RaftConfigurationException } from "./exceptions";
import { RaftLogger } from "./services";
import { RaftNode } from "./core";

// A mock state machine for default configuration
const defaultStateMachine: StateMachine = {
  apply: async () => {
    /* no-op */
  },
  getSnapshotData: async () => Buffer.from(""),
  applySnapshot: async () => {
    /* no-op */
  },
};

export class RaftEngine {
  private readonly nodes: Map<string, RaftNode> = new Map();
  private readonly logger: RaftLogger;

  constructor() {
    // Default logger configuration
    this.logger = new RaftLogger({
      level: LogLevel.INFO,
      redactedFields: ["password", "token", "secret"],
      enableStructured: true,
    });
  }

  public async createNode(
    config: RaftConfiguration,
    stateMachine?: StateMachine,
  ): Promise<RaftNode> {
    if (this.nodes.has(config.nodeId)) {
      throw new RaftConfigurationException(
        `Node ${config.nodeId} already exists`,
      );
    }

    const sm = stateMachine || defaultStateMachine;
    const node = new RaftNode(config, sm);
    this.nodes.set(config.nodeId, node);

    this.logger.info("Raft node created", {
      nodeId: config.nodeId,
      clusterId: config.clusterId,
    });

    return node;
  }

  public async startNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new RaftConfigurationException(`Node ${nodeId} not found`);
    }

    await node.start();
    this.logger.info("Raft node started", { nodeId });
  }

  public async stopNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new RaftConfigurationException(`Node ${nodeId} not found`);
    }

    await node.stop();
    this.logger.info("Raft node stopped", { nodeId });
  }

  public removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    this.logger.info("Raft node removed from engine", { nodeId });
  }

  public getNode(nodeId: string): RaftNode | undefined {
    return this.nodes.get(nodeId);
  }

  public getAllNodes(): Map<string, RaftNode> {
    return new Map(this.nodes);
  }

  public async stopAllNodes(): Promise<void> {
    const stopPromises = Array.from(this.nodes.values()).map((node) =>
      node.stop(),
    );
    await Promise.all(stopPromises);
    this.nodes.clear();
    this.logger.info("All Raft nodes stopped");
  }

  public static createDefaultConfiguration(
    nodeId: string,
    clusterId: string,
    // StateMachine is not included here, will be defaulted in createNode
  ): RaftConfiguration {
    return {
      nodeId,
      clusterId,
      httpHost: "localhost",
      httpPort: 3000,
      electionTimeout: [150, 300],
      heartbeatInterval: 50,
      maxLogEntries: 10000,
      snapshotThreshold: 1000,
      redis: {
        host: process.env.REDIS_HOST || "localhost",
        port: Number.parseInt(process.env.REDIS_PORT || "6379"),
        ...(process.env.REDIS_PASSWORD && {
          password: process.env.REDIS_PASSWORD,
        }),
        db: Number.parseInt(process.env.REDIS_DB || "0"),
      },
      peerDiscovery: {
        registrationInterval: 5000,
        healthCheckInterval: 10000,
        peerTimeout: 30000,
      },
      voting: {
        enableWeighting: true,
        weightMetrics: ["cpuUsage", "memoryUsage", "networkLatency", "uptime"],
        defaultWeight: 1,
      },
      retry: {
        maxAttempts: 3,
        backoffFactor: 2,
        initialDelay: 100,
      },
      circuitBreaker: {
        timeout: 3000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
      },
      metrics: {
        enablePrometheus: true,
        enableInternal: true,
        collectionInterval: 5000,
      },
      logging: {
        level: LogLevel.INFO,
        redactedFields: ["password", "token", "secret"],
        enableStructured: true,
      },
      network: {
        requestTimeout: 5000,
        maxRetries: 3,
        retryDelay: 100,
        circuitBreakerThreshold: 5,
        circuitBreakerTimeout: 30000,
      },
      persistence: {
        enableSnapshots: true,
        snapshotInterval: 300000,
        dataDir: "/var/lib/raft",
        walEnabled: true,
        walSizeLimit: 104857600,
      },
    };
  }
}
