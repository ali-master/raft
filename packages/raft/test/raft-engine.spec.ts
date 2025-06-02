import { it, expect, describe, beforeEach, afterEach } from "vitest";
import { createTestConfig } from "./shared/test-utils";
import { clearRedisData } from "./shared/test-setup";
import { RaftState, RaftEngine, RaftConfigurationException } from "../src";

describe("raftEngine", () => {
  let engine: RaftEngine;

  beforeEach(async () => {
    await clearRedisData();
    engine = new RaftEngine();
  });

  afterEach(async () => {
    await engine.stopAllNodes();
  });

  describe("node management", () => {
    it("should create nodes with unique IDs", async () => {
      const config1 = createTestConfig({ nodeId: "node1" });
      const config2 = createTestConfig({ nodeId: "node2" });

      const node1 = await engine.createNode(config1);
      const node2 = await engine.createNode(config2);

      expect(node1).toBeDefined();
      expect(node2).toBeDefined();
      expect(engine.getNode("node1")).toBe(node1);
      expect(engine.getNode("node2")).toBe(node2);
    });

    it("should prevent duplicate node IDs", async () => {
      const config = createTestConfig({ nodeId: "node1" });
      await engine.createNode(config);

      await expect(engine.createNode(config)).rejects.toThrow(
        RaftConfigurationException,
      );
    });

    it("should start and stop nodes", async () => {
      const config = createTestConfig({ nodeId: "node1" });
      const node = await engine.createNode(config);

      await engine.startNode("node1");
      expect(node.getState()).toBe(RaftState.FOLLOWER);

      await engine.stopNode("node1");
    });

    it("should handle non-existent nodes", async () => {
      await expect(engine.startNode("non-existent")).rejects.toThrow(
        RaftConfigurationException,
      );
      await expect(engine.stopNode("non-existent")).rejects.toThrow(
        RaftConfigurationException,
      );
      expect(engine.getNode("non-existent")).toBeUndefined();
    });

    it("should stop all nodes", async () => {
      const config1 = createTestConfig({ nodeId: "node1" });
      const config2 = createTestConfig({ nodeId: "node2" });

      await engine.createNode(config1);
      await engine.createNode(config2);

      await engine.startNode("node1");
      await engine.startNode("node2");

      await engine.stopAllNodes();
    });
  });

  describe("default configuration", () => {
    it("should create valid default configuration", () => {
      const config = RaftEngine.createDefaultConfiguration(
        "test-node",
        "test-cluster",
      );

      expect(config.nodeId).toBe("test-node");
      expect(config.clusterId).toBe("test-cluster");
      expect(config.httpHost).toBe("localhost");
      expect(config.httpPort).toBeGreaterThan(0);
      expect(config.electionTimeout).toHaveLength(2);
      expect(config.heartbeatInterval).toBeGreaterThan(0);
    });

    it("should use environment variables for Redis config", () => {
      process.env.REDIS_HOST = "custom-redis";
      process.env.REDIS_PORT = "6380";
      process.env.REDIS_PASSWORD = "secret";
      process.env.REDIS_DB = "2";

      const config = RaftEngine.createDefaultConfiguration(
        "test-node",
        "test-cluster",
      );

      expect(config.redis.host).toBe("custom-redis");
      expect(config.redis.port).toBe(6380);
      expect(config.redis.password).toBe("secret");
      expect(config.redis.db).toBe(2);

      // Clean up
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      delete process.env.REDIS_PASSWORD;
      delete process.env.REDIS_DB;
    });
  });
});
