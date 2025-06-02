import { it, expect, describe } from "vitest";
import { RaftEngine } from "../../src/raft-engine";
import { LogLevel } from "../../src/constants";

describe("configurationValidation", () => {
  describe("default configuration", () => {
    it("should create complete default configuration", () => {
      // Save current env vars
      const originalRedisHost = process.env.REDIS_HOST;
      const originalRedisPort = process.env.REDIS_PORT;

      // Clear test Redis env vars temporarily
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;

      const config = RaftEngine.createDefaultConfiguration(
        "test-node",
        "test-cluster",
      );

      // Basic properties
      expect(config.nodeId).toBe("test-node");
      expect(config.clusterId).toBe("test-cluster");
      expect(config.httpHost).toBe("localhost");
      expect(config.httpPort).toBe(3000);

      // Timing configurations
      expect(config.electionTimeout).toEqual([150, 300]);
      expect(config.heartbeatInterval).toBe(50);
      expect(config.maxLogEntries).toBe(10000);
      expect(config.snapshotThreshold).toBe(1000);

      // Redis configuration
      expect(config.redis).toBeDefined();
      expect(config.redis.host).toBe("localhost");
      expect(config.redis.port).toBe(6379);
      expect(config.redis.db).toBe(0);

      // Peer discovery
      expect(config.peerDiscovery).toBeDefined();
      expect(config.peerDiscovery?.registrationInterval).toBe(5000);
      expect(config.peerDiscovery?.healthCheckInterval).toBe(10000);
      expect(config.peerDiscovery?.peerTimeout).toBe(30000);

      // Voting configuration
      expect(config.voting).toBeDefined();
      expect(config.voting.enableWeighting).toBe(true);
      expect(config.voting.weightMetrics).toContain("cpuUsage");
      expect(config.voting.defaultWeight).toBe(1);

      // Retry configuration
      expect(config.retry).toBeDefined();
      expect(config.retry?.maxAttempts).toBe(3);
      expect(config.retry?.backoffFactor).toBe(2);
      expect(config.retry?.initialDelay).toBe(100);

      // Circuit breaker
      expect(config.circuitBreaker).toBeDefined();
      expect(config.circuitBreaker?.timeout).toBe(3000);
      expect(config.circuitBreaker?.errorThresholdPercentage).toBe(50);
      expect(config.circuitBreaker?.resetTimeout).toBe(30000);

      // Metrics
      expect(config.metrics).toBeDefined();
      expect(config.metrics.enablePrometheus).toBe(true);
      expect(config.metrics.enableInternal).toBe(true);
      expect(config.metrics.collectionInterval).toBe(5000);

      // Logging
      expect(config.logging).toBeDefined();
      expect(config.logging.level).toBe(LogLevel.INFO);
      expect(config.logging.redactedFields).toContain("password");
      expect(config.logging.enableStructured).toBe(true);

      // Network
      expect(config.network).toBeDefined();
      expect(config.network.requestTimeout).toBe(5000);
      expect(config.network.maxRetries).toBe(3);
      expect(config.network.retryDelay).toBe(100);

      // Persistence
      expect(config.persistence).toBeDefined();
      expect(config.persistence.enableSnapshots).toBe(true);
      expect(config.persistence.snapshotInterval).toBe(300000);
      expect(config.persistence.dataDir).toBe("/var/lib/raft");
      expect(config.persistence.walEnabled).toBe(true);
      expect(config.persistence.walSizeLimit).toBe(104857600);

      // Restore env vars
      if (originalRedisHost) process.env.REDIS_HOST = originalRedisHost;
      if (originalRedisPort) process.env.REDIS_PORT = originalRedisPort;
    });

    it("should respect environment variables", () => {
      const originalEnv = { ...process.env };

      try {
        process.env.REDIS_HOST = "custom-redis-host";
        process.env.REDIS_PORT = "6380";
        process.env.REDIS_PASSWORD = "secret-password";
        process.env.REDIS_DB = "5";

        const config = RaftEngine.createDefaultConfiguration(
          "test-node",
          "test-cluster",
        );

        expect(config.redis.host).toBe("custom-redis-host");
        expect(config.redis.port).toBe(6380);
        expect(config.redis.password).toBe("secret-password");
        expect(config.redis.db).toBe(5);
      } finally {
        // Restore environment
        process.env = originalEnv;
      }
    });
  });

  describe("configuration validation", () => {
    it("should handle missing environment variables gracefully", () => {
      const originalEnv = { ...process.env };

      try {
        delete process.env.REDIS_HOST;
        delete process.env.REDIS_PORT;
        delete process.env.REDIS_PASSWORD;
        delete process.env.REDIS_DB;

        const config = RaftEngine.createDefaultConfiguration(
          "test-node",
          "test-cluster",
        );

        expect(config.redis.host).toBe("localhost");
        expect(config.redis.port).toBe(6379);
        expect(config.redis.password).toBeUndefined();
        expect(config.redis.db).toBe(0);
      } finally {
        // Restore environment
        process.env = originalEnv;
      }
    });
  });
});
