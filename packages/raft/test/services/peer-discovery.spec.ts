import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import { PeerDiscoveryService } from "../../src/services/peer-discovery";
import { RaftState } from "../../src/constants";
import type { PeerInfo } from "../../src/types";
import { createTestConfig, createMockRedis, createMockLogger } from "../shared/test-utils";

describe("peerDiscoveryService", () => {
  let peerDiscovery: PeerDiscoveryService;
  let mockRedis: any;
  let mockLogger: any;
  let config: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockRedis = createMockRedis();
    mockLogger = createMockLogger();
    config = createTestConfig();
    peerDiscovery = new PeerDiscoveryService(mockRedis, config, mockLogger);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("start/stop", () => {
    it("should start and register self", async () => {
      await peerDiscovery.start();

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "raft:cluster:test-cluster:node:test-node-1",
        10, // peerTimeout (10000) / 1000
        expect.stringContaining("\"nodeId\":\"test-node-1\""),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Peer discovery service started",
        { nodeId: "test-node-1" },
      );
    });

    it("should stop and deregister self", async () => {
      await peerDiscovery.start();
      await peerDiscovery.stop();

      expect(mockRedis.del).toHaveBeenCalledWith(
        "raft:cluster:test-cluster:node:test-node-1",
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Peer discovery service stopped",
        { nodeId: "test-node-1" },
      );
    });
  });

  describe("peer discovery", () => {
    it("should discover new peers", async () => {
      const peerData: PeerInfo = {
        nodeId: "peer1",
        clusterId: "test-cluster",
        httpHost: "192.168.1.2",
        httpPort: 3002,
        state: RaftState.FOLLOWER,
        term: 0,
        lastSeen: new Date(),
        weight: 1,
        metrics: {
          cpuUsage: 50,
          memoryUsage: 50,
          diskUsage: 50,
          networkLatency: 10,
          loadAverage: [1, 1, 1],
          uptime: 1000,
        },
      };

      mockRedis.keys.mockResolvedValue([
        "raft:cluster:test-cluster:node:test-node-1",
        "raft:cluster:test-cluster:node:peer1",
      ]);
      mockRedis.get.mockResolvedValue(JSON.stringify(peerData));

      await peerDiscovery.start();
      await vi.runOnlyPendingTimersAsync();

      const peers = peerDiscovery.getPeers();
      expect(peers).toContain("peer1");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "New peer discovered",
        expect.objectContaining({ peerId: "peer1" }),
      );
    });

    it("should detect lost peers", async () => {
      const peerData: PeerInfo = {
        nodeId: "peer1",
        clusterId: "test-cluster",
        httpHost: "192.168.1.2",
        httpPort: 3002,
        state: RaftState.FOLLOWER,
        term: 0,
        lastSeen: new Date(),
        weight: 1,
        metrics: {
          cpuUsage: 50,
          memoryUsage: 50,
          diskUsage: 50,
          networkLatency: 10,
          loadAverage: [1, 1, 1],
          uptime: 1000,
        },
      };

      // First discovery includes peer1
      mockRedis.keys.mockResolvedValueOnce([
        "raft:cluster:test-cluster:node:test-node-1",
        "raft:cluster:test-cluster:node:peer1",
      ]);
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(peerData));

      await peerDiscovery.start();
      await vi.runOnlyPendingTimersAsync();

      expect(peerDiscovery.getPeers()).toContain("peer1");

      // Second discovery doesn't include peer1
      mockRedis.keys.mockResolvedValueOnce([
        "raft:cluster:test-cluster:node:test-node-1",
      ]);

      await vi.runOnlyPendingTimersAsync();

      expect(peerDiscovery.getPeers()).not.toContain("peer1");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Peer lost",
        { peerId: "peer1" },
      );
    });
  });

  describe("metrics", () => {
    it("should update system metrics", async () => {
      await peerDiscovery.start();

      // Trigger metrics update
      await vi.runOnlyPendingTimersAsync();

      // Check that setex was called with updated metrics
      expect(mockRedis.setex).toHaveBeenCalledWith(
        "raft:cluster:test-cluster:node:test-node-1",
        10, // peerTimeout (10000) / 1000
        expect.stringContaining("\"metrics\""),
      );
    });
  });

  describe("peer state updates", () => {
    it("should update peer state", async () => {
      const peerData: PeerInfo = {
        nodeId: "peer1",
        clusterId: "test-cluster",
        httpHost: "192.168.1.2",
        httpPort: 3002,
        state: RaftState.FOLLOWER,
        term: 0,
        lastSeen: new Date(),
        weight: 1,
        metrics: {
          cpuUsage: 50,
          memoryUsage: 50,
          diskUsage: 50,
          networkLatency: 10,
          loadAverage: [1, 1, 1],
          uptime: 1000,
        },
      };

      mockRedis.keys.mockResolvedValue([
        "raft:cluster:test-cluster:node:test-node-1",
        "raft:cluster:test-cluster:node:peer1",
      ]);
      mockRedis.get.mockResolvedValue(JSON.stringify(peerData));

      await peerDiscovery.start();
      await vi.runOnlyPendingTimersAsync();

      await peerDiscovery.updatePeerState("peer1", RaftState.LEADER, 5);

      const updatedPeer = peerDiscovery.getPeerInfo("peer1");
      expect(updatedPeer?.state).toBe(RaftState.LEADER);
      expect(updatedPeer?.term).toBe(5);
    });
  });
});
