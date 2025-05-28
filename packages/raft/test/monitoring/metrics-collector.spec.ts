import { it, expect, describe, beforeEach } from "vitest";
import { RaftMetricsCollector } from "../../src/monitoring/metrics-collector";
import { RaftState } from "../../src/constants";
import { createTestConfig } from "../shared/test-utils";

describe("raftMetricsCollector", () => {
  let metricsCollector: RaftMetricsCollector;
  let config: any;

  beforeEach(() => {
    config = createTestConfig();
    metricsCollector = new RaftMetricsCollector(config.metrics);
  });

  it("should store and retrieve metrics", () => {
    metricsCollector.updateMetrics("node1", "cluster1", {
      currentTerm: 5,
      state: RaftState.FOLLOWER,
    });

    const metrics = metricsCollector.getMetrics("node1");
    expect(metrics).toBeDefined();
    expect(metrics?.currentTerm).toBe(5);
    expect(metrics?.state).toBe(RaftState.FOLLOWER);
  });

  it("should merge partial updates", () => {
    metricsCollector.updateMetrics("node1", "cluster1", {
      currentTerm: 5,
      state: RaftState.FOLLOWER,
    });

    metricsCollector.updateMetrics("node1", "cluster1", {
      votedFor: "node2",
      commitIndex: 10,
    });

    const metrics = metricsCollector.getMetrics("node1");
    expect(metrics?.currentTerm).toBe(5);
    expect(metrics?.state).toBe(RaftState.FOLLOWER);
    expect(metrics?.votedFor).toBe("node2");
    expect(metrics?.commitIndex).toBe(10);
  });

  it("should provide default metrics for new nodes", () => {
    const metrics = metricsCollector.getMetrics("new-node");
    expect(metrics).toBeUndefined();

    metricsCollector.updateMetrics("new-node", "cluster1", {});
    const updated = metricsCollector.getMetrics("new-node");
    expect(updated).toBeDefined();
    expect(updated?.currentTerm).toBe(0);
    expect(updated?.state).toBe(RaftState.FOLLOWER);
    expect(updated?.votedFor).toBeNull();
  });

  it("should get all metrics", () => {
    metricsCollector.updateMetrics("node1", "cluster1", {
      currentTerm: 5,
    });
    metricsCollector.updateMetrics("node2", "cluster1", {
      currentTerm: 6,
    });

    const allMetrics = metricsCollector.getAllMetrics();
    expect(allMetrics.size).toBe(2);
    expect(allMetrics.get("node1")?.currentTerm).toBe(5);
    expect(allMetrics.get("node2")?.currentTerm).toBe(6);
  });
});
