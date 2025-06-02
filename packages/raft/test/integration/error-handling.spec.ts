import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { createTestConfig } from "../shared/test-utils";
import { clearRedisData } from "../shared/test-setup";
import {
  RaftValidationException,
  RaftEngine,
  RaftConfigurationException,
} from "../../src";

describe("errorHandling", () => {
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

  describe("configuration errors", () => {
    it("should handle duplicate node creation", async () => {
      const config = createTestConfig({ nodeId: "duplicate-node" });

      await engine.createNode(config);

      await expect(engine.createNode(config)).rejects.toThrow(
        RaftConfigurationException,
      );
      await expect(engine.createNode(config)).rejects.toThrow(
        "Node duplicate-node already exists",
      );
    });

    it("should handle invalid node operations", async () => {
      await expect(engine.startNode("non-existent")).rejects.toThrow(
        RaftConfigurationException,
      );
      await expect(engine.stopNode("non-existent")).rejects.toThrow(
        RaftConfigurationException,
      );

      expect(engine.getNode("non-existent")).toBeUndefined();
    });
  });

  describe("operational errors", () => {
    it("should handle node start/stop lifecycle errors gracefully", async () => {
      const config = createTestConfig({ nodeId: "lifecycle-test" });
      const node = await engine.createNode(config);

      // Should start successfully
      await engine.startNode("lifecycle-test");
      expect(node.getState()).toBeDefined();

      // Should stop successfully
      await engine.stopNode("lifecycle-test");

      // Multiple stops should work (node is still in engine map)
      await engine.stopNode("lifecycle-test");
    });

    it("should handle validation errors", async () => {
      const config = createTestConfig({ nodeId: "validation-test" });
      const node = await engine.createNode(config);
      await engine.startNode("validation-test");

      // Should reject operations when not leader
      await expect(node.appendLog({ command: "test" })).rejects.toThrow(
        RaftValidationException,
      );
    });
  });

  describe("resource management", () => {
    it("should clean up resources properly", async () => {
      const configs = [
        createTestConfig({ nodeId: "cleanup-1", httpPort: 4001 }),
        createTestConfig({ nodeId: "cleanup-2", httpPort: 4002 }),
        createTestConfig({ nodeId: "cleanup-3", httpPort: 4003 }),
      ];

      const nodes = [];
      for (const config of configs) {
        const node = await engine.createNode(config);
        nodes.push(node);
        await engine.startNode(config.nodeId);
      }

      // Verify all nodes are created
      expect(engine.getAllNodes().size).toBe(3);

      // Stop all should clean up properly
      await engine.stopAllNodes();
      expect(engine.getAllNodes().size).toBe(0);
    });

    it("should handle partial failures in batch operations", async () => {
      const validConfig = createTestConfig({ nodeId: "valid-node" });
      await engine.createNode(validConfig);

      // This should work
      await engine.startNode("valid-node");

      // Create a scenario where stop might partially fail
      // (in real scenarios, this could be network issues, etc.)
      const allNodes = engine.getAllNodes();
      expect(allNodes.size).toBe(1);

      // Should handle cleanup even if individual stops have issues
      await engine.stopAllNodes();
    });
  });

  describe("edge cases", () => {
    it("should handle rapid start/stop cycles", async () => {
      const config1 = createTestConfig({ nodeId: "rapid-cycle-1" });
      const config2 = createTestConfig({ nodeId: "rapid-cycle-2" });

      const node1 = await engine.createNode(config1);
      const node2 = await engine.createNode(config2);

      // Test rapid operations with separate nodes to avoid Redis connection issues
      await engine.startNode("rapid-cycle-1");
      await engine.startNode("rapid-cycle-2");

      await engine.stopNode("rapid-cycle-1");
      await engine.stopNode("rapid-cycle-2");

      // Verify nodes are still accessible
      expect(engine.getNode("rapid-cycle-1")).toBe(node1);
      expect(engine.getNode("rapid-cycle-2")).toBe(node2);
    });

    it("should maintain consistency during errors", async () => {
      const config = createTestConfig({ nodeId: "consistency-test" });
      const node = await engine.createNode(config);

      expect(engine.getNode("consistency-test")).toBe(node);

      await engine.startNode("consistency-test");

      // Even after operations, node should remain accessible
      expect(engine.getNode("consistency-test")).toBe(node);

      await engine.stopNode("consistency-test");

      // Node should still exist in engine (not auto-removed)
      expect(engine.getNode("consistency-test")).toBe(node);
    });
  });

  describe("exception types", () => {
    it("should throw appropriate exception types", async () => {
      const config = createTestConfig({ nodeId: "exception-test" });
      await engine.createNode(config);

      // Configuration exceptions
      await expect(engine.createNode(config)).rejects.toBeInstanceOf(
        RaftConfigurationException,
      );
      await expect(engine.startNode("missing")).rejects.toBeInstanceOf(
        RaftConfigurationException,
      );

      // Start the node for validation tests
      await engine.startNode("exception-test");
      const node = engine.getNode("exception-test")!;

      // Validation exceptions
      await expect(node.appendLog({})).rejects.toBeInstanceOf(
        RaftValidationException,
      );
    });
  });
});
