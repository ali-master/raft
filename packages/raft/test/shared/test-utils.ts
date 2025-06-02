import { vi } from "vitest";
import type { RaftConfiguration } from "../../src/types";
import { LogLevel } from "../../src/constants";

export function createTestConfig(
  overrides: Partial<RaftConfiguration> = {},
): RaftConfiguration {
  const defaults: RaftConfiguration = {
    nodeId: overrides.nodeId || "test-node-1",
    clusterId: "test-cluster",
    httpHost: "localhost",
    httpPort: overrides.httpPort || 3001,
    electionTimeout: overrides.electionTimeout || [150, 300],
    heartbeatInterval: overrides.heartbeatInterval || 50,
    logging: {
      level: LogLevel.ERROR,
      enableConsole: false,
      enableFile: false,
      filePath: "/dev/null",
      redactedFields: [],
      enableStructured: false,
    },
    metrics: {
      enableInternal: true,
      enablePrometheus: true,
      collectionInterval: 5000,
      retentionPeriod: 3600000,
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
      snapshotInterval: 100,
      dataDir: "/tmp/raft-test",
      walEnabled: true,
      walSizeLimit: 1048576,
    },
    redis: {
      host: process.env.REDIS_HOST || "localhost",
      port: Number.parseInt(process.env.REDIS_PORT || "6379"),
      password: undefined,
      db: 0,
      keyPrefix: "raft",
      ttl: 3600,
    },
    voting: {
      enableWeighting: true,
      weightMetrics: ["cpuUsage", "memoryUsage", "diskUsage", "networkLatency"],
      defaultWeight: 10,
    },
    peerDiscovery: {
      registrationInterval: 5000,
      healthCheckInterval: 2000,
      peerTimeout: 10000,
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
  };

  return { ...defaults, ...overrides };
}

export function createMockRedis() {
  return {
    setex: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockResolvedValue("OK"),
    mget: vi.fn().mockResolvedValue([]),
    quit: vi.fn().mockResolvedValue("OK"),
    status: "ready",
  };
}

/**
 * Get a Redis instance from the shared test container
 * This should be used in tests instead of mocking
 */
export async function getTestRedis() {
  const { getGlobalRedisContext } = await import("./test-setup");
  const context = getGlobalRedisContext();
  return context.redis.duplicate();
}

export function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

export function createMockEventBus() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    publish: vi.fn(),
    getEvents: vi.fn().mockReturnValue([]),
  };
}

export function createMockMetricsCollector() {
  return {
    updateMetrics: vi.fn(),
    getMetrics: vi.fn(),
    getAllMetrics: vi.fn().mockReturnValue(new Map()),
    getPrometheusMetrics: vi.fn().mockResolvedValue(""),
    getPrometheusRegister: vi.fn(),
    incrementCounter: vi.fn(),
    observeHistogram: vi.fn(),
  };
}

export function createMockPeerDiscovery() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getPeers: vi.fn().mockReturnValue([]),
    getPeerInfo: vi.fn(),
    updatePeerState: vi.fn().mockResolvedValue(undefined),
    getCurrentMetrics: vi.fn().mockReturnValue({
      cpuUsage: 50,
      memoryUsage: 50,
      diskUsage: 50,
      networkLatency: 10,
      loadAverage: [0.5, 0.5, 0.5],
      uptime: 1000,
    }),
  };
}
