import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { RaftEngine } from "../../src/raft-engine";
import { RaftState } from "../../src/constants";
import { createTestConfig, createMockRedis } from "../shared/test-utils";

describe("integration Tests", () => {
  let engine: RaftEngine;
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = createMockRedis();
    engine = new RaftEngine();
  });

  afterEach(async () => {
    await engine.stopAllNodes();
    vi.clearAllTimers();
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

    // Mock peer discovery
    const peerData = (nodeId: string, port: number): string => JSON.stringify({
      nodeId,
      clusterId: "test-cluster",
      httpHost: "localhost",
      httpPort: port,
      state: RaftState.FOLLOWER,
      term: 0,
      lastSeen: new Date(),
      weight: 1,
      metrics: {
        cpuUsage: 50,
        memoryUsage: 50,
        diskUsage: 50,
        networkLatency: 10,
        loadAverage: [0.5, 0.5, 0.5],
        uptime: 1000,
      },
    });

    mockRedis.keys.mockResolvedValue([
      "raft:cluster:test-cluster:node:node1",
      "raft:cluster:test-cluster:node:node2",
      "raft:cluster:test-cluster:node:node3",
    ]);

    mockRedis.get.mockImplementation((key: string) => {
      if (key.includes("node1"))
return Promise.resolve(peerData("node1", 3001));
      if (key.includes("node2"))
return Promise.resolve(peerData("node2", 3002));
      if (key.includes("node3"))
return Promise.resolve(peerData("node3", 3003));
      return Promise.resolve(null);
    });

    // Start all nodes
    await engine.startNode("node1");
    await engine.startNode("node2");
    await engine.startNode("node3");

    // Wait for peer discovery
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify cluster formation
    expect(node1.getPeers()).toHaveLength(2);
    expect(node2.getPeers()).toHaveLength(2);
    expect(node3.getPeers()).toHaveLength(2);

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

    // Stop one node
    await engine.stopNode("node2");

    // Verify the other node continues running
    expect(node1.getState()).toBe(RaftState.FOLLOWER);
  });

  it("should persist and recover state", async () => {
    const config = createTestConfig({ nodeId: "persistent-node" });

    // First run
    const node1 = await engine.createNode(config);
    await engine.startNode("persistent-node");

    // Simulate state persistence
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      currentTerm: 10,
      votedFor: "other-node",
    }));

    await engine.stopNode("persistent-node");
    await engine.stopAllNodes();

    // Second run - create new engine
    const newEngine = new RaftEngine();
    const node2 = await newEngine.createNode(config);
    await newEngine.startNode("persistent-node");

    expect(node2.getCurrentTerm()).toBe(10);

    await newEngine.stopAllNodes();
  });
});
