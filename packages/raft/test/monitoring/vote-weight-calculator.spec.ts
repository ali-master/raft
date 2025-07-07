import { vi, it, expect, describe, beforeEach } from "vitest";
import { VoteWeightCalculator } from "../../src/monitoring/vote-weight-calculator";
import { RaftMetricsCollector } from "../../src/monitoring/metrics-collector";
import { PeerDiscoveryService } from "../../src/services";
import { RaftState } from "../../src/constants";
import type { RaftConfiguration, PeerInfo } from "../../src/types";
import {
  createTestConfig,
  createMockRedis,
  createMockLogger,
} from "../shared/test-utils";

describe("voteWeightCalculator", () => {
  let calculator: VoteWeightCalculator;
  let config: RaftConfiguration;
  let metricsCollector: RaftMetricsCollector;
  let peerDiscovery: PeerDiscoveryService;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    config = createTestConfig();
    metricsCollector = new RaftMetricsCollector(config.metrics);

    mockRedis = createMockRedis();
    peerDiscovery = new PeerDiscoveryService(
      mockRedis as any,
      config,
      createMockLogger(),
    );
    calculator = new VoteWeightCalculator(
      config.voting,
      metricsCollector,
      peerDiscovery,
    );
  });

  it("should return default weight when weighting is disabled", () => {
    const disabledConfig = createTestConfig({
      voting: { ...config.voting, enableWeighting: false },
    });
    const calc = new VoteWeightCalculator(
      disabledConfig.voting,
      metricsCollector,
      peerDiscovery,
    );

    const weight = calc.calculateWeight("node1");
    expect(weight).toBe(disabledConfig.voting.defaultWeight);
  });

  it("should calculate weight based on system metrics", () => {
    const peerInfo: PeerInfo = {
      nodeId: "node1",
      clusterId: "cluster1",
      httpHost: "localhost",
      httpPort: 3001,
      state: RaftState.FOLLOWER,
      term: 0,
      lastSeen: new Date(),
      weight: 1,
      metrics: {
        cpuUsage: 10,
        memoryUsage: 20,
        diskUsage: 30,
        networkLatency: 5,
        loadAverage: [0.2, 0.3, 0.4],
        uptime: 3600,
      },
    };

    vi.spyOn(peerDiscovery, "getPeerInfo").mockReturnValue(peerInfo);

    const weight = calculator.calculateWeight("node1");

    // Base (10) + cpu (90) + mem (80) + disk (70) + net (95) = 345
    expect(weight).toBeGreaterThan(300);
  });

  it("should include all configured metrics in calculation", () => {
    const fullConfig = createTestConfig({
      voting: {
        enableWeighting: true,
        weightMetrics: [
          "cpuUsage",
          "memoryUsage",
          "diskUsage",
          "networkLatency",
          "loadAverage",
          "uptime",
          "logLength",
        ],
        defaultWeight: 10,
      },
    });

    const calc = new VoteWeightCalculator(
      fullConfig.voting,
      metricsCollector,
      peerDiscovery,
    );

    const peerInfo: PeerInfo = {
      nodeId: "node1",
      clusterId: "cluster1",
      httpHost: "localhost",
      httpPort: 3001,
      state: RaftState.FOLLOWER,
      term: 0,
      lastSeen: new Date(),
      weight: 1,
      metrics: {
        cpuUsage: 10, // 90 points
        memoryUsage: 20, // 80 points
        diskUsage: 30, // 70 points
        networkLatency: 5, // 95 points
        loadAverage: [0.2, 0.3, 0.4], // ~80 points
        uptime: 7200, // 2 hours = 2 points
      },
    };

    metricsCollector.updateMetrics("node1", "cluster1", {
      logLength: 500, // 50 points
    });

    vi.spyOn(peerDiscovery, "getPeerInfo").mockReturnValue(peerInfo);

    const weight = calc.calculateWeight("node1");

    // Base (10) + cpu (90) + mem (80) + disk (70) + net (95) + load (80) + uptime (2) + log (50) = 477
    expect(weight).toBe(477);
  });

  it("should return at least 1 as weight", () => {
    const peerInfo: PeerInfo = {
      nodeId: "node1",
      clusterId: "cluster1",
      httpHost: "localhost",
      httpPort: 3001,
      state: RaftState.FOLLOWER,
      term: 0,
      lastSeen: new Date(),
      weight: 1,
      metrics: {
        cpuUsage: 100, // 0 points
        memoryUsage: 100, // 0 points
        diskUsage: 100, // 0 points
        networkLatency: 1000, // 0 points
        loadAverage: [100, 100, 100], // 0 points
        uptime: 0, // 0 points
      },
    };

    vi.spyOn(peerDiscovery, "getPeerInfo").mockReturnValue(peerInfo);

    const weight = calculator.calculateWeight("node1");
    expect(weight).toBeGreaterThanOrEqual(1);
  });
});
