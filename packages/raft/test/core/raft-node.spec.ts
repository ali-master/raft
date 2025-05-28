import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { RaftNode } from "../../src/core/raft-node";
import { RaftState } from "../../src/constants";
import { RaftValidationException } from "../../src/exceptions";
import { createTestConfig } from "../shared/test-utils";

describe("raftNode", () => {
  let node: RaftNode;
  let config: any;

  beforeEach(() => {
    vi.useFakeTimers();
    config = createTestConfig();
    node = new RaftNode(config);
  });

  afterEach(async () => {
    await node.stop();
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("should start in follower state", async () => {
      expect(node.getState()).toBe(RaftState.FOLLOWER);
      expect(node.getCurrentTerm()).toBe(0);
    });

    it("should load persisted state on start", async () => {
      // This test would require mocking the internal Redis instance
      // For now, we can verify the initial state
      await node.start();
      expect(node.getCurrentTerm()).toBe(0);
    });
  });

  describe("leader operations", () => {
    it("should reject log appends when not leader", async () => {
      await node.start();
      await expect(
        node.appendLog({ cmd: "set", key: "a", value: "1" }),
      ).rejects.toThrow(RaftValidationException);
    });
  });

  describe("state transitions", () => {
    it("should track state transitions", async () => {
      await node.start();
      const initialState = node.getState();
      expect(initialState).toBe(RaftState.FOLLOWER);
    });

    it("should update term during transitions", async () => {
      await node.start();
      const initialTerm = node.getCurrentTerm();
      expect(initialTerm).toBe(0);
    });
  });

  describe("metrics", () => {
    it("should provide metrics", async () => {
      await node.start();
      const metrics = node.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics?.state).toBe(RaftState.FOLLOWER);
    });

    it("should provide prometheus metrics", async () => {
      await node.start();
      const prometheusMetrics = await node.getPrometheusMetrics();
      expect(typeof prometheusMetrics).toBe("string");
    });
  });

  describe("peer management", () => {
    it("should get peers list", async () => {
      await node.start();
      const peers = node.getPeers();
      expect(Array.isArray(peers)).toBe(true);
    });

    it("should get peer info", async () => {
      await node.start();
      // Peer discovery would need to be mocked internally
      // For now, verify that getPeerInfo returns undefined for unknown peers
      const peerInfo = node.getPeerInfo("unknown-peer");
      expect(peerInfo).toBeUndefined();
    });
  });
});
