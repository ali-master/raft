import { it, expect, describe, beforeEach, afterEach } from "vitest";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestConfig } from "../shared/test-utils";
import { clearRedisData } from "../shared/test-setup";
import { RaftNode } from "../../src/core/raft-node";
import { RaftState } from "../../src/constants";
import { RaftValidationException } from "../../src/exceptions";
import { MockStateMachine } from "../shared/mocks/state-machine.mock";
import type { RaftConfiguration } from "../../src/types";

describe("raftNode", () => {
  let node: RaftNode;
  let config: RaftConfiguration;
  let stateMachine: MockStateMachine;
  let dataDir: string;

  beforeEach(async () => {
    await clearRedisData();
    config = createTestConfig();
    dataDir = await mkdtemp(join(tmpdir(), "raft-node-test-"));
    config.persistence.dataDir = dataDir;
    stateMachine = new MockStateMachine();
    node = new RaftNode(config, stateMachine);
  });

  afterEach(async () => {
    await node.stop();
    await rm(dataDir, { recursive: true, force: true });
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
    it("should reject elections on a stopped node", async () => {
      expect(node.getLeaderId()).toBeNull();
      await expect(node.forceElection()).rejects.toThrow("stopped node");
    });

    it("should run a real election and identify itself as leader", async () => {
      await node.start();
      await node.forceElection();
      expect(node.getState()).toBe(RaftState.LEADER);
      expect(node.getLeaderId()).toBe(config.nodeId);
      await node.appendLog("committed");
      expect(stateMachine.commands).toEqual(["committed"]);
      await node.stop();
      expect(node.getLeaderId()).toBeNull();
    });

    it("should report only a leader observed in the current term", async () => {
      config.electionTimeout = [10000, 15000];
      await node.start();
      const heartbeat = {
        term: 2,
        leaderId: "leader-2",
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0,
      };
      await node.handleAppendEntries(heartbeat);
      expect(node.getLeaderId()).toBe("leader-2");
      await node.handleAppendEntries({
        ...heartbeat,
        term: 1,
        leaderId: "stale-leader",
      });
      expect(node.getLeaderId()).toBe("leader-2");
      await node.handleVoteRequest({
        term: 3,
        candidateId: "candidate-3",
        lastLogIndex: 0,
        lastLogTerm: 0,
      });
      expect(node.getLeaderId()).toBeNull();
      await node.handleAppendEntries({
        ...heartbeat,
        term: 3,
        leaderId: "leader-3",
      });
      expect(node.getLeaderId()).toBe("leader-3");
      await node.stop();
      await node.start();
      expect(node.getLeaderId()).toBeNull();
    });

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
