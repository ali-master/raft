import type { RaftConfiguration } from "@usex/raft";
import { LogLevel } from "../../../src";

export interface PlaygroundConfig {
  cluster: {
    size: number;
    basePort: number;
    redisPort: number;
    redisHost: string;
  };
  timing: {
    electionTimeoutMin: number;
    electionTimeoutMax: number;
    heartbeatInterval: number;
    demoDelay: number;
  };
  network: {
    latency: number;
    packetLoss: number;
    jitter: number;
  };
  logging: {
    level: LogLevel;
    showTimestamps: boolean;
    showNodeIds: boolean;
  };
  visualization: {
    enabled: boolean;
    updateInterval: number;
    port: number;
  };
}

export const DEFAULT_PLAYGROUND_CONFIG: PlaygroundConfig = {
  cluster: {
    size: 5,
    basePort: 3000,
    redisPort: 6379,
    redisHost: "localhost",
  },
  timing: {
    electionTimeoutMin: 150,
    electionTimeoutMax: 300,
    heartbeatInterval: 50,
    demoDelay: 1000,
  },
  network: {
    latency: 0,
    packetLoss: 0,
    jitter: 0,
  },
  logging: {
    level: LogLevel.INFO,
    showTimestamps: true,
    showNodeIds: true,
  },
  visualization: {
    enabled: false,
    updateInterval: 100,
    port: 8080,
  },
};

export function createRaftConfig(
  nodeId: string,
  clusterId: string,
  playgroundConfig: PlaygroundConfig = DEFAULT_PLAYGROUND_CONFIG,
): RaftConfiguration {
  const nodeIndex = parseInt(nodeId.split("-").pop() || "0");
  const httpPort = playgroundConfig.cluster.basePort + nodeIndex;

  return {
    nodeId,
    clusterId,
    httpHost: "localhost",
    httpPort,
    electionTimeout: [
      playgroundConfig.timing.electionTimeoutMin,
      playgroundConfig.timing.electionTimeoutMax,
    ],
    heartbeatInterval: playgroundConfig.timing.heartbeatInterval,
    maxLogEntries: 1000,
    snapshotThreshold: 100,
    redis: {
      host: playgroundConfig.cluster.redisHost,
      port: playgroundConfig.cluster.redisPort,
      db: 0,
      keyPrefix: `raft:${clusterId}:`,
      ttl: 3600,
    },
    peerDiscovery: {
      registrationInterval: 5000,
      healthCheckInterval: 2000,
      peerTimeout: 10000,
    },
    voting: {
      enableWeighting: false,
      weightMetrics: ["networkLatency", "cpuUsage", "memoryUsage"],
      defaultWeight: 1,
    },
    retry: {
      maxAttempts: 3,
      backoffFactor: 2,
      initialDelay: 100,
    },
    circuitBreaker: {
      timeout: 5000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
    },
    metrics: {
      enablePrometheus: false,
      enableInternal: true,
      collectionInterval: 5000,
      retentionPeriod: 300000,
    },
    logging: {
      level: playgroundConfig.logging.level,
      redactedFields: ["password", "token"],
      enableStructured: true,
      enableConsole: true,
      enableFile: false,
      filePath: `/tmp/raft-${nodeId}.log`,
    },
    network: {
      requestTimeout: 5000,
      maxRetries: 3,
      retryDelay: 1000,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 30000,
    },
    persistence: {
      enableSnapshots: true,
      snapshotInterval: 60000,
      dataDir: `/tmp/raft-playground/${clusterId}/${nodeId}`,
      walEnabled: true,
      walSizeLimit: 64 * 1024 * 1024, // 64MB
    },
  };
}
