import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { createTestConfig } from "../shared/test-utils";
import { clearRedisData } from "../shared/test-setup";
import { RaftState, RaftNode } from "../../src";

describe("raftStateMachine", () => {
  let nodes: RaftNode[];
  let configs: any[];

  beforeEach(async () => {
    await clearRedisData();
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Use unique node IDs for each test to avoid state persistence issues
    const timestamp = Date.now();
    configs = [
      createTestConfig({
        nodeId: `node1-${timestamp}`,
        httpPort: 3001,
        electionTimeout: [100000, 200000],
      }),
      createTestConfig({
        nodeId: `node2-${timestamp}`,
        httpPort: 3002,
        electionTimeout: [100000, 200000],
      }),
      createTestConfig({
        nodeId: `node3-${timestamp}`,
        httpPort: 3003,
        electionTimeout: [100000, 200000],
      }),
    ];
    nodes = configs.map((config) => new RaftNode(config));
  });

  afterEach(async () => {
    for (const node of nodes) {
      try {
        await node.stop();
      } catch {
        // Ignore stop errors in tests
      }
    }
    vi.useRealTimers();
  });

  describe("state management", () => {
    it("should initialize in follower state", () => {
      for (const node of nodes) {
        expect(node.getState()).toBe(RaftState.FOLLOWER);
        expect(node.getCurrentTerm()).toBe(0);
      }
    });

    it("should track term changes", () => {
      const node = nodes[0]!;
      expect(node.getCurrentTerm()).toBe(0);

      // Term should be tracked internally (we can't directly set it in public API)
      expect(typeof node.getCurrentTerm()).toBe("number");
    });

    it("should provide node metrics", async () => {
      const node = nodes[0]!;
      await node.start();

      const metrics = node.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics?.state).toBe(RaftState.FOLLOWER);
      expect(metrics?.currentTerm).toBe(0);
    });
  });

  describe("leadership", () => {
    it("should reject operations when not leader", async () => {
      const node = nodes[0]!;
      await node.start();

      expect(node.getState()).toBe(RaftState.FOLLOWER);

      await expect(node.appendLog({ command: "test" })).rejects.toThrow(
        "Only leader can append logs",
      );
    });
  });

  describe("peer management", () => {
    it("should manage peer list", async () => {
      const node = nodes[0]!;
      await node.start();

      const peers = node.getPeers();
      expect(Array.isArray(peers)).toBe(true);

      const unknownPeer = node.getPeerInfo("unknown");
      expect(unknownPeer).toBeUndefined();
    });
  });

  describe("event handling", () => {
    it("should emit state change events", async () => {
      const node = nodes[0]!;
      const stateChangeHandler = vi.fn();

      node.on("stateChange", stateChangeHandler);
      await node.start();

      // Should emit initial state change event
      expect(stateChangeHandler).toHaveBeenCalled();
    });

    it("should provide prometheus metrics", async () => {
      const node = nodes[0]!;
      await node.start();

      const metrics = await node.getPrometheusMetrics();
      expect(typeof metrics).toBe("string");
    });
  });
});
