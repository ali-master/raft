import {
  vi,
  it,
  expect,
  describe,
  beforeEach,
  beforeAll,
  afterEach,
  afterAll,
} from "vitest";
import { PeerDiscoveryService } from "../../src/services/peer-discovery";
import { RaftState } from "../../src/constants";
import type { PeerInfo } from "../../src/types";
import type Redis from "ioredis";
import { createTestConfig, createMockLogger } from "../shared/test-utils";
import {
  teardownRedisContainer,
  setupRedisContainer,
} from "../shared/testcontainers";
import type { RedisTestContext } from "../shared/testcontainers";

describe("peerDiscoveryService", { timeout: 60000 }, () => {
  let peerDiscovery: PeerDiscoveryService;
  let redisContext: RedisTestContext;
  let redis: Redis;
  let mockLogger: any;
  let config: any;

  // Setup single Redis container for all tests
  beforeAll(async () => {
    redisContext = await setupRedisContainer();
    redis = redisContext.redis;
  }, 30000);

  afterAll(async () => {
    if (redisContext) {
      await teardownRedisContainer(redisContext);
    }
  }, 30000);

  beforeEach(async () => {
    vi.useFakeTimers();
    // Clear Redis before each test
    await redis.flushall();
    mockLogger = createMockLogger();
    config = createTestConfig();
    peerDiscovery = new PeerDiscoveryService(redis, config, mockLogger);
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Stop peer discovery to clean up timers
    try {
      await peerDiscovery.stop();
    } catch {
      // Ignore errors
    }
  });

  describe("start/stop", () => {
    it("should start and register self", async () => {
      await peerDiscovery.start();

      // Check that the node is registered in Redis
      const key = "raft:cluster:test-cluster:node:test-node-1";
      const value = await redis.get(key);
      expect(value).toBeTruthy();
      expect(value).toContain('"nodeId":"test-node-1"');
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Peer discovery service started",
        { nodeId: "test-node-1" },
      );
    });

    it("should stop and deregister self", async () => {
      await peerDiscovery.start();
      await peerDiscovery.stop();

      // Check that the node is deregistered from Redis
      const key = "raft:cluster:test-cluster:node:test-node-1";
      const value = await redis.get(key);
      expect(value).toBeNull();
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

      // First start the discovery service so it registers itself
      await peerDiscovery.start();

      // Manually add peer data to Redis
      await redis.setex(
        "raft:cluster:test-cluster:node:peer1",
        10,
        JSON.stringify(peerData),
      );

      // Manually trigger discovery instead of waiting for timer
      await (peerDiscovery as any).discoverPeers();

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

      // Start the discovery service
      await peerDiscovery.start();

      // Add peer1 to Redis
      await redis.setex(
        "raft:cluster:test-cluster:node:peer1",
        10,
        JSON.stringify(peerData),
      );

      // Manually trigger discovery to discover peer1
      await (peerDiscovery as any).discoverPeers();

      // Verify peer1 was discovered
      expect(peerDiscovery.getPeers()).toContain("peer1");

      // Delete peer1 from Redis to simulate it going offline
      await redis.del("raft:cluster:test-cluster:node:peer1");

      // Manually trigger discovery again
      await (peerDiscovery as any).discoverPeers();

      // Verify peer1 is no longer in the peer list
      expect(peerDiscovery.getPeers()).not.toContain("peer1");
      expect(mockLogger.info).toHaveBeenCalledWith("Peer lost", {
        peerId: "peer1",
      });
    });
  });

  describe("metrics", () => {
    it("should update system metrics", async () => {
      await peerDiscovery.start();

      // Trigger metrics update
      await vi.runOnlyPendingTimersAsync();

      // Check that metrics are stored in Redis
      const key = "raft:cluster:test-cluster:node:test-node-1";
      const value = await redis.get(key);
      expect(value).toBeTruthy();
      expect(value).toContain('"metrics"');
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

      // Start the discovery service
      await peerDiscovery.start();

      // Add peer1 to Redis
      await redis.setex(
        "raft:cluster:test-cluster:node:peer1",
        10,
        JSON.stringify(peerData),
      );

      // Manually trigger discovery
      await (peerDiscovery as any).discoverPeers();

      await peerDiscovery.updatePeerState("peer1", RaftState.LEADER, 5);

      const updatedPeer = peerDiscovery.getPeerInfo("peer1");
      expect(updatedPeer?.state).toBe(RaftState.LEADER);
      expect(updatedPeer?.term).toBe(5);
    });
  });
});
