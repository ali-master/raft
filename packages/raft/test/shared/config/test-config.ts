import type { RaftConfiguration } from "../../../src/types";
import { LogLevel } from "../../../src/constants";

/**
 * Create a test configuration with proper Redis settings
 */
export function createTestConfig(
  nodeId: string,
  overrides: Partial<RaftConfiguration> = {},
): RaftConfiguration {
  // Get Redis connection info from environment variables set by test setup
  const redisHost = process.env.REDIS_HOST || "localhost";
  const redisPort = parseInt(process.env.REDIS_PORT || "6379");

  const baseConfig: RaftConfiguration = {
    nodeId,
    clusterId: "test-cluster",
    httpHost: "localhost",
    httpPort: 4000,
    electionTimeout: [250, 400],
    heartbeatInterval: 100,
    snapshotThreshold: 10000,
    logging: {
      level: LogLevel.ERROR,
      redactedFields: [],
      enableStructured: true,
      enableConsole: true,
      enableFile: false,
    },
    persistence: {
      enableSnapshots: true,
      snapshotInterval: 1000,
      walEnabled: false,
      dataDir: "/tmp/raft-test",
      walSizeLimit: 10485760, // 10MB
    },
    network: {
      requestTimeout: 300,
      maxRetries: 3,
      retryDelay: 50,
      circuitBreakerThreshold: 10,
      circuitBreakerTimeout: 60000,
    },
    voting: {
      enableWeighting: false,
      weightMetrics: [],
      defaultWeight: 1,
    },
    metrics: {
      enablePrometheus: false,
      enableInternal: true,
      collectionInterval: 30000,
      retentionPeriod: 3600000,
    },
    redis: {
      host: redisHost,
      port: redisPort,
      password: undefined,
      db: 0,
      keyPrefix: "raft:test:",
      ttl: 3600,
    },
    peerDiscovery: {
      registrationInterval: 5000,
      healthCheckInterval: 2000,
      peerTimeout: 10000,
    },
    peers: [],
    ...overrides,
  };

  return baseConfig;
}

/**
 * Create multiple test configurations for cluster tests
 */
export function createClusterConfigs(
  nodeIds: string[],
  basePort: number = 4000,
  overrides: Partial<RaftConfiguration> = {},
): RaftConfiguration[] {
  const configs: RaftConfiguration[] = [];

  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i];
    if (!nodeId) {
      throw new Error(`Node ID at index ${i} is undefined`);
    }
    const port = basePort + i;
    const peers = nodeIds
      .filter((id) => id !== nodeId)
      .map(
        (_, index) =>
          `localhost:${basePort + (index >= i ? index + 1 : index)}`,
      );

    configs.push(
      createTestConfig(nodeId, {
        httpPort: port,
        peers,
        ...overrides,
      }),
    );
  }

  return configs;
}
