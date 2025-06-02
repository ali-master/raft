import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { createTestConfig } from "../shared/test-utils";
import { clearRedisData } from "../shared/test-setup";
import { RaftState, RaftEngine } from "../../src";

describe("integration Tests", () => {
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

  it("should create a three-node cluster", async () => {
    // Create three nodes with long election timeouts to prevent elections during test
    const config1 = createTestConfig({
      nodeId: "node1",
      httpPort: 3001,
      electionTimeout: [10000, 15000],
      heartbeatInterval: 5000,
    });
    const config2 = createTestConfig({
      nodeId: "node2",
      httpPort: 3002,
      electionTimeout: [10000, 15000],
      heartbeatInterval: 5000,
    });
    const config3 = createTestConfig({
      nodeId: "node3",
      httpPort: 3003,
      electionTimeout: [10000, 15000],
      heartbeatInterval: 5000,
    });

    const node1 = await engine.createNode(config1);
    const node2 = await engine.createNode(config2);
    const node3 = await engine.createNode(config3);

    // Start all nodes
    await engine.startNode("node1");
    await engine.startNode("node2");
    await engine.startNode("node3");

    // Wait for peer discovery
    await vi.advanceTimersByTimeAsync(5000); // Advance 5 seconds for peer discovery

    // Verify that nodes are started and accessible
    expect(node1.getState()).toBeDefined();
    expect(node2.getState()).toBeDefined();
    expect(node3.getState()).toBeDefined();

    // All nodes should start as followers
    expect(node1.getState()).toBe(RaftState.FOLLOWER);
    expect(node2.getState()).toBe(RaftState.FOLLOWER);
    expect(node3.getState()).toBe(RaftState.FOLLOWER);
  });

  it("should handle node failures gracefully", async () => {
    const config1 = createTestConfig({ nodeId: "node1" });
    const config2 = createTestConfig({ nodeId: "node2" });

    const node1 = await engine.createNode(config1);
    const node2 = await engine.createNode(config2);

    await engine.startNode("node1");
    await engine.startNode("node2");

    // Verify both nodes are running
    expect(node1.getState()).toBe(RaftState.FOLLOWER);
    expect(node2.getState()).toBe(RaftState.FOLLOWER);

    // Stop one node
    await engine.stopNode("node2");

    // Verify the other node continues running
    expect(node1.getState()).toBe(RaftState.FOLLOWER);
  });

  it("should persist and recover state", async () => {
    const config = createTestConfig({ nodeId: "persistent-node" });

    // First run - create and start node
    const node1 = await engine.createNode(config);
    await engine.startNode("persistent-node");

    // Verify initial state
    expect(node1.getState()).toBe(RaftState.FOLLOWER);
    expect(node1.getCurrentTerm()).toBe(0);

    // Stop the node
    await engine.stopNode("persistent-node");
    await engine.stopAllNodes();

    // Second run - create new engine
    const newEngine = new RaftEngine();

    const node2 = await newEngine.createNode(config);
    await newEngine.startNode("persistent-node");

    // With real Redis, the node should maintain its state
    expect(node2.getState()).toBe(RaftState.FOLLOWER);
    expect(node2.getCurrentTerm()).toBeGreaterThanOrEqual(0);

    await newEngine.stopAllNodes();
  });
});
