import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { createTestConfig } from "../shared/test-utils";
import { clearRedisData } from "../shared/test-setup";
import { RaftEngine } from "../../src/raft-engine";
import { RaftState, LogLevel } from "../../src/constants";
import { RaftConfigurationException } from "../../src/exceptions";

describe("raft engine advanced", { timeout: 30000 }, () => {
  let engine: RaftEngine;

  beforeEach(async () => {
    await clearRedisData();
    vi.useFakeTimers();
    engine = new RaftEngine();
  });

  afterEach(async () => {
    await engine.stopAllNodes();
    vi.useRealTimers();
  });

  describe.skip("advanced node management (requires Redis)", () => {
    it("should handle complex node lifecycle scenarios", async () => {
      const configs = [
        createTestConfig({ nodeId: "leader-candidate", httpPort: 7001 }),
        createTestConfig({ nodeId: "follower-1", httpPort: 7002 }),
        createTestConfig({ nodeId: "follower-2", httpPort: 7003 }),
      ];

      // Create nodes sequentially
      const nodes = [];
      for (const config of configs) {
        const node = await engine.createNode(config);
        nodes.push(node);
      }

      expect(engine.getAllNodes().size).toBe(3);

      // Start all nodes
      for (const config of configs) {
        await engine.startNode(config.nodeId);
      }

      // All nodes should be in follower state initially
      for (const node of nodes) {
        expect(node?.getState()).toBe(RaftState.FOLLOWER);
        expect(node?.getCurrentTerm()).toBe(0);
      }

      // Test node accessibility
      expect(engine.getNode("leader-candidate")).toBe(nodes[0]);
      expect(engine.getNode("follower-1")).toBe(nodes[1]);
      expect(engine.getNode("follower-2")).toBe(nodes[2]);
    });

    it("should prevent operations on non-existent nodes", async () => {
      const nodeIds = ["ghost-node", "phantom-node", "void-node"];

      for (const nodeId of nodeIds) {
        await expect(engine.startNode(nodeId)).rejects.toThrow(
          RaftConfigurationException,
        );
        await expect(engine.stopNode(nodeId)).rejects.toThrow(
          RaftConfigurationException,
        );
        expect(engine.getNode(nodeId)).toBeUndefined();
      }
    });

    it("should maintain node state consistency", async () => {
      const config = createTestConfig({ nodeId: "consistent-node" });
      const node = await engine.createNode(config);

      // Initial state
      expect(node.getState()).toBe(RaftState.FOLLOWER);
      expect(node.getCurrentTerm()).toBe(0);

      // Start node
      await engine.startNode("consistent-node");
      expect(node.getState()).toBe(RaftState.FOLLOWER);

      // Node should remain accessible through engine
      expect(engine.getNode("consistent-node")).toBe(node);

      // Stop node
      await engine.stopNode("consistent-node");
      expect(engine.getNode("consistent-node")).toBe(node);
    });
  });

  describe.skip("configuration management (requires Redis)", () => {
    it("should handle various configuration options", async () => {
      const customConfigs = [
        createTestConfig({
          nodeId: "config-test-1",
          httpPort: 8001,
          heartbeatInterval: 25,
          electionTimeout: [100, 200],
        }),
        createTestConfig({
          nodeId: "config-test-2",
          httpPort: 8002,
          heartbeatInterval: 75,
          electionTimeout: [200, 400],
        }),
      ];

      for (const config of customConfigs) {
        const node = await engine.createNode(config);
        await engine.startNode(config.nodeId);

        expect(node.getState()).toBe(RaftState.FOLLOWER);
        expect(node.getCurrentTerm()).toBe(0);
      }

      expect(engine.getAllNodes().size).toBe(2);
    });

    it("should validate environment-based configurations", () => {
      const originalEnv = { ...process.env };

      try {
        // Set custom environment variables
        process.env.REDIS_HOST = "test-redis-host";
        process.env.REDIS_PORT = "6380";
        process.env.REDIS_DB = "3";

        const config = RaftEngine.createDefaultConfiguration(
          "env-test-node",
          "env-test-cluster",
        );

        expect(config.redis.host).toBe("test-redis-host");
        expect(config.redis.port).toBe(6380);
        expect(config.redis.db).toBe(3);
        expect(config.nodeId).toBe("env-test-node");
        expect(config.clusterId).toBe("env-test-cluster");
      } finally {
        // Restore environment
        process.env = originalEnv;
      }
    });
  });

  describe.skip("error scenarios and edge cases (requires Redis)", () => {
    it("should handle duplicate node creation gracefully", async () => {
      const config = createTestConfig({ nodeId: "duplicate-test" });

      // Create first node
      const node1 = await engine.createNode(config);
      expect(node1).toBeDefined();

      // Attempt to create duplicate
      await expect(engine.createNode(config)).rejects.toThrow(
        RaftConfigurationException,
      );
      await expect(engine.createNode(config)).rejects.toThrow(
        "Node duplicate-test already exists",
      );

      // Original node should still be accessible
      expect(engine.getNode("duplicate-test")).toBe(node1);
    });

    it("should handle batch operations correctly", async () => {
      const batchConfigs = Array.from({ length: 5 }, (_, i) =>
        createTestConfig({
          nodeId: `batch-node-${i}`,
          httpPort: 9000 + i,
        }),
      );

      // Create all nodes
      const nodes = [];
      for (const config of batchConfigs) {
        const node = await engine.createNode(config);
        nodes.push(node);
      }

      // Start all nodes
      for (const config of batchConfigs) {
        await engine.startNode(config.nodeId);
      }

      // Verify all nodes are started and accessible
      for (let i = 0; i < batchConfigs.length; i++) {
        const config = batchConfigs[i];
        const node = nodes[i];
        expect(engine.getNode(config!.nodeId)).toBe(node);
        expect(node?.getState()).toBe(RaftState.FOLLOWER);
      }

      // Stop all at once
      await engine.stopAllNodes();
      expect(engine.getAllNodes().size).toBe(0);
    });

    it("should maintain consistency during partial failures", async () => {
      const workingConfig = createTestConfig({ nodeId: "working-node" });
      const workingNode = await engine.createNode(workingConfig);

      await engine.startNode("working-node");
      expect(workingNode.getState()).toBe(RaftState.FOLLOWER);

      // Attempt operations on non-existent nodes
      await expect(engine.startNode("non-existent")).rejects.toThrow();

      // Working node should remain unaffected
      expect(engine.getNode("working-node")).toBe(workingNode);
      expect(workingNode.getState()).toBe(RaftState.FOLLOWER);
    });
  });

  describe.skip("metrics and monitoring (requires Redis)", () => {
    it("should provide comprehensive node metrics", async () => {
      const config = createTestConfig({ nodeId: "metrics-node" });
      const node = await engine.createNode(config);

      await engine.startNode("metrics-node");

      // Test metrics availability
      const metrics = node.getMetrics();
      expect(metrics).toBeDefined();

      if (metrics) {
        expect(metrics.state).toBe(RaftState.FOLLOWER);
        expect(metrics.currentTerm).toBe(0);
        expect(typeof metrics.logLength).toBe("number");
        expect(typeof metrics.peerCount).toBe("number");
      }

      // Test Prometheus metrics
      const prometheusMetrics = await node.getPrometheusMetrics();
      expect(typeof prometheusMetrics).toBe("string");
    });

    it("should handle peer management operations", async () => {
      const config = createTestConfig({ nodeId: "peer-test-node" });
      const node = await engine.createNode(config);

      await engine.startNode("peer-test-node");

      // Test peer operations
      const peers = node.getPeers();
      expect(Array.isArray(peers)).toBe(true);

      const unknownPeerInfo = node.getPeerInfo("unknown-peer");
      expect(unknownPeerInfo).toBeUndefined();
    });
  });

  describe("default configuration validation", () => {
    it("should create comprehensive default configuration", () => {
      // Save current env vars
      const originalRedisHost = process.env.REDIS_HOST;
      const originalRedisPort = process.env.REDIS_PORT;

      // Clear test Redis env vars temporarily
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;

      const config = RaftEngine.createDefaultConfiguration(
        "default-test-node",
        "default-test-cluster",
      );

      // Basic configuration
      expect(config.nodeId).toBe("default-test-node");
      expect(config.clusterId).toBe("default-test-cluster");
      expect(config.httpHost).toBe("localhost");
      expect(config.httpPort).toBe(3000);

      // Timing configuration
      expect(config.electionTimeout).toEqual([150, 300]);
      expect(config.heartbeatInterval).toBe(50);

      // Redis configuration
      expect(config.redis.host).toBe("localhost");
      expect(config.redis.port).toBe(6379);

      // Logging configuration
      expect(config.logging.level).toBe(LogLevel.INFO);
      expect(config.logging.enableStructured).toBe(true);

      // Metrics configuration
      expect(config.metrics.enablePrometheus).toBe(true);
      expect(config.metrics.enableInternal).toBe(true);

      // Network configuration
      expect(config.network.requestTimeout).toBe(5000);
      expect(config.network.maxRetries).toBe(3);

      // Persistence configuration
      expect(config.persistence.enableSnapshots).toBe(true);
      expect(config.persistence.walEnabled).toBe(true);

      // Restore env vars
      if (originalRedisHost) process.env.REDIS_HOST = originalRedisHost;
      if (originalRedisPort) process.env.REDIS_PORT = originalRedisPort;
    });
  });
});
