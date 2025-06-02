import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { createTestConfig } from "../shared/test-utils";
import { clearRedisData } from "../shared/test-setup";
import { RaftEngine } from "../../src/raft-engine";
import { RaftState } from "../../src/constants";

describe("nodeLifecycle", () => {
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

  describe("single node lifecycle", () => {
    it("should handle complete node lifecycle", async () => {
      const config = createTestConfig({ nodeId: "lifecycle-node" });

      // Create
      const node = await engine.createNode(config);
      expect(node).toBeDefined();
      expect(node.getState()).toBe(RaftState.FOLLOWER);

      // Start
      await engine.startNode("lifecycle-node");
      expect(node.getState()).toBe(RaftState.FOLLOWER);

      // Verify accessibility
      expect(engine.getNode("lifecycle-node")).toBe(node);

      // Stop
      await engine.stopNode("lifecycle-node");

      // Node should still exist in engine after stop
      expect(engine.getNode("lifecycle-node")).toBe(node);
    });

    it("should track node state correctly", async () => {
      const config = createTestConfig({ nodeId: "state-node" });
      const node = await engine.createNode(config);

      // Initial state
      expect(node.getState()).toBe(RaftState.FOLLOWER);
      expect(node.getCurrentTerm()).toBe(0);

      await engine.startNode("state-node");

      // After start, should still be follower until election
      expect(node.getState()).toBe(RaftState.FOLLOWER);
      expect(node.getCurrentTerm()).toBe(0);

      // Should have metrics available
      const metrics = node.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics?.state).toBe(RaftState.FOLLOWER);
    });
  });

  describe("multiple nodes lifecycle", () => {
    it("should handle multiple nodes independently", async () => {
      const configs = [
        createTestConfig({ nodeId: "multi-1", httpPort: 5001 }),
        createTestConfig({ nodeId: "multi-2", httpPort: 5002 }),
        createTestConfig({ nodeId: "multi-3", httpPort: 5003 }),
      ];

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

      // All nodes should be accessible and in follower state
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        expect(node?.getState()).toBe(RaftState.FOLLOWER);
        expect(engine.getNode(configs[i]!.nodeId)).toBe(node);
      }

      // Stop all
      await engine.stopAllNodes();
      expect(engine.getAllNodes().size).toBe(0);
    });

    it("should handle selective node stopping", async () => {
      const configs = [
        createTestConfig({ nodeId: "selective-1", httpPort: 5101 }),
        createTestConfig({ nodeId: "selective-2", httpPort: 5102 }),
      ];

      const node1 = await engine.createNode(configs[0]!);
      const node2 = await engine.createNode(configs[1]!);

      await engine.startNode("selective-1");
      await engine.startNode("selective-2");

      expect(engine.getAllNodes().size).toBe(2);

      // Stop one node
      await engine.stopNode("selective-1");

      // Both nodes should still exist in engine
      expect(engine.getNode("selective-1")).toBe(node1);
      expect(engine.getNode("selective-2")).toBe(node2);
      expect(engine.getAllNodes().size).toBe(2);

      // Stop the other
      await engine.stopNode("selective-2");
      expect(engine.getAllNodes().size).toBe(2); // Still exist until stopAllNodes
    });
  });

  describe("error scenarios", () => {
    it("should handle node operations on non-existent nodes", async () => {
      await expect(engine.startNode("non-existent")).rejects.toThrow();
      await expect(engine.stopNode("non-existent")).rejects.toThrow();
      expect(engine.getNode("non-existent")).toBeUndefined();
    });

    it("should prevent duplicate node creation", async () => {
      const config = createTestConfig({ nodeId: "duplicate-test" });

      await engine.createNode(config);
      await expect(engine.createNode(config)).rejects.toThrow();
    });

    it("should handle operations when nodes are in various states", async () => {
      const config = createTestConfig({ nodeId: "state-test" });
      const node = await engine.createNode(config);

      // Operations before start
      expect(node.getState()).toBe(RaftState.FOLLOWER);
      await expect(node.appendLog({ test: "data" })).rejects.toThrow();

      // Start node
      await engine.startNode("state-test");

      // Should still reject leader operations
      await expect(node.appendLog({ test: "data" })).rejects.toThrow();

      // Stop node
      await engine.stopNode("state-test");

      // Node should still be accessible
      expect(engine.getNode("state-test")).toBe(node);
    });
  });

  describe("metrics and monitoring", () => {
    it("should provide node metrics throughout lifecycle", async () => {
      const config = createTestConfig({ nodeId: "metrics-test" });
      const node = await engine.createNode(config);

      await engine.startNode("metrics-test");

      // Metrics should be available
      const metrics = node.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics?.currentTerm).toBe(0);
      expect(metrics?.state).toBe(RaftState.FOLLOWER);

      // Prometheus metrics should be available
      const prometheusMetrics = await node.getPrometheusMetrics();
      expect(typeof prometheusMetrics).toBe("string");

      // Peer management
      const peers = node.getPeers();
      expect(Array.isArray(peers)).toBe(true);
    });
  });
});
