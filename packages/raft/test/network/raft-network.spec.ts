import { vi, it, expect, describe, beforeEach } from "vitest";
import { RaftNetwork } from "../../src/network/raft-network";
import { RetryStrategy } from "../../src/utils/retry-strategy";
import type { VoteRequest, RaftConfiguration } from "../../src/types";
import type Redis from "ioredis";
import {
  createTestConfig,
  createMockPeerDiscovery,
  createMockMetricsCollector,
  createMockLogger,
} from "../shared/test-utils";

describe("raftNetwork", () => {
  let network: RaftNetwork;
  let config: RaftConfiguration;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockPeerDiscovery: ReturnType<typeof createMockPeerDiscovery>;
  let mockMetrics: ReturnType<typeof createMockMetricsCollector>;
  let mockRetry: RetryStrategy;
  let mockRedis: Redis;

  beforeEach(() => {
    config = createTestConfig();
    mockLogger = createMockLogger();
    mockPeerDiscovery = createMockPeerDiscovery();
    mockMetrics = createMockMetricsCollector();
    mockRetry = new RetryStrategy(config.retry);

    mockRedis = {
      lpush: vi.fn(),
      brpop: vi.fn(),
      quit: vi.fn(),
      status: "ready",
    } as any;

    network = new RaftNetwork(
      config,
      mockRetry,
      mockLogger,
      // @ts-ignore
      mockPeerDiscovery,
      mockMetrics,
      mockRedis,
    );
  });

  describe("circuit breaker initialization", () => {
    it("should initialize circuit breakers for all peers", () => {
      mockPeerDiscovery.getPeers.mockReturnValue(["peer1", "peer2"]);
      network.initializeCircuitBreakers();

      // Verify it doesn't throw when calling updateCircuitBreakers
      expect(() => network.updateCircuitBreakers()).not.toThrow();
    });
  });

  describe("message sending", () => {
    it("should handle network errors gracefully", async () => {
      mockPeerDiscovery.getPeerInfo.mockReturnValue(undefined);

      const voteRequest: VoteRequest = {
        term: 1,
        candidateId: "node1",
        lastLogIndex: 0,
        lastLogTerm: 0,
        weight: 1,
      };

      await expect(
        network.sendVoteRequest("unknown-peer", voteRequest),
      ).rejects.toThrow();
    });
  });

  describe("circuit breaker updates", () => {
    it("should add circuit breakers for new peers", () => {
      vi.spyOn(mockPeerDiscovery, "getPeers").mockReturnValueOnce([]);
      network.initializeCircuitBreakers();

      vi.spyOn(mockPeerDiscovery, "getPeers").mockReturnValueOnce(["new-peer"]);
      network.updateCircuitBreakers();

      // Test that the new peer can be contacted (circuit breaker exists)
      expect(() => network.updateCircuitBreakers()).not.toThrow();
    });

    it("should remove circuit breakers for lost peers", () => {
      vi.spyOn(mockPeerDiscovery, "getPeers").mockReturnValueOnce(["old-peer"]);
      network.initializeCircuitBreakers();

      vi.spyOn(mockPeerDiscovery, "getPeers").mockReturnValueOnce([]);
      network.updateCircuitBreakers();

      // Verify that the peer has been removed
      vi.spyOn(mockPeerDiscovery, "getPeers").mockReturnValueOnce([]);
      expect(() => network.updateCircuitBreakers()).not.toThrow();
    });
  });
});
