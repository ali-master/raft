import { it, expect, describe, beforeEach } from "vitest";
import { RaftMetricsCollector } from "../../src/monitoring/metrics-collector";
import { RaftState } from "../../src/constants";

describe("prometheusIntegration", () => {
  let metricsCollector: RaftMetricsCollector;

  beforeEach(() => {
    metricsCollector = new RaftMetricsCollector({
      enablePrometheus: true,
      enableInternal: true,
      collectionInterval: 1000,
      retentionPeriod: 3600000,
    });
  });

  describe("metrics collection", () => {
    it("should initialize with default metrics", () => {
      const nodeId = "test-node";
      const clusterId = "test-cluster";

      const initialMetrics = metricsCollector.getMetrics(nodeId);
      expect(initialMetrics).toBeUndefined(); // No metrics until first update

      // Update with initial metrics
      metricsCollector.updateMetrics(nodeId, clusterId, {
        currentTerm: 0,
        state: RaftState.FOLLOWER,
        votedFor: null,
        commitIndex: 0,
        lastApplied: 0,
        logLength: 0,
        peerCount: 0,
      });

      const updatedMetrics = metricsCollector.getMetrics(nodeId);
      expect(updatedMetrics).toBeDefined();
      expect(updatedMetrics?.state).toBe(RaftState.FOLLOWER);
      expect(updatedMetrics?.currentTerm).toBe(0);
    });

    it("should merge partial metric updates", () => {
      const nodeId = "test-node";
      const clusterId = "test-cluster";

      // Initial update
      metricsCollector.updateMetrics(nodeId, clusterId, {
        currentTerm: 1,
        state: RaftState.FOLLOWER,
      });

      // Partial update
      metricsCollector.updateMetrics(nodeId, clusterId, {
        currentTerm: 2,
        logLength: 5,
      });

      const metrics = metricsCollector.getMetrics(nodeId);
      expect(metrics?.currentTerm).toBe(2);
      expect(metrics?.state).toBe(RaftState.FOLLOWER); // Should retain previous value
      expect(metrics?.logLength).toBe(5);
    });

    it("should track multiple nodes", () => {
      const clusterId = "test-cluster";

      metricsCollector.updateMetrics("node1", clusterId, {
        currentTerm: 1,
        state: RaftState.LEADER,
      });

      metricsCollector.updateMetrics("node2", clusterId, {
        currentTerm: 1,
        state: RaftState.FOLLOWER,
      });

      const node1Metrics = metricsCollector.getMetrics("node1");
      const node2Metrics = metricsCollector.getMetrics("node2");

      expect(node1Metrics?.state).toBe(RaftState.LEADER);
      expect(node2Metrics?.state).toBe(RaftState.FOLLOWER);

      const allMetrics = metricsCollector.getAllMetrics();
      expect(allMetrics.size).toBe(2);
      expect(allMetrics.has("node1")).toBe(true);
      expect(allMetrics.has("node2")).toBe(true);
    });
  });

  describe("prometheus metrics", () => {
    it("should generate prometheus format when enabled", async () => {
      const nodeId = "test-node";
      const clusterId = "test-cluster";

      metricsCollector.updateMetrics(nodeId, clusterId, {
        currentTerm: 5,
        state: RaftState.LEADER,
        logLength: 100,
        peerCount: 3,
      });

      const prometheusMetrics = await metricsCollector.getPrometheusMetrics();
      expect(typeof prometheusMetrics).toBe("string");
    });

    it("should return empty string when prometheus disabled", async () => {
      const disabledCollector = new RaftMetricsCollector({
        enablePrometheus: false,
        enableInternal: true,
        collectionInterval: 1000,
        retentionPeriod: 3600000,
      });

      const prometheusMetrics = await disabledCollector.getPrometheusMetrics();
      expect(prometheusMetrics).toBe("");
    });

    it("should increment counters", () => {
      const nodeId = "test-node";
      const clusterId = "test-cluster";

      // This should not throw
      expect(() => {
        metricsCollector.incrementCounter("raft_elections_total", {
          node_id: nodeId,
          cluster_id: clusterId,
        });
      }).not.toThrow();
    });

    it("should observe histogram values", () => {
      const nodeId = "test-node";
      const clusterId = "test-cluster";

      // This should not throw
      expect(() => {
        metricsCollector.observeHistogram(
          "raft_network_latency_seconds",
          {
            node_id: nodeId,
            cluster_id: clusterId,
            target_node: "peer1",
          },
          0.05,
        );
      }).not.toThrow();
    });
  });

  describe("metric registry", () => {
    it("should provide prometheus registry", () => {
      const registry = metricsCollector.getPrometheusRegister();
      expect(registry).toBeDefined();
      expect(typeof registry.metrics).toBe("function");
    });
  });

  describe("system metrics integration", () => {
    it("should handle system metrics in updates", () => {
      const nodeId = "test-node";
      const clusterId = "test-cluster";

      const systemMetrics = {
        cpuUsage: 45.5,
        memoryUsage: 67.2,
        diskUsage: 23.1,
        networkLatency: 12.5,
        loadAverage: [0.8, 0.9, 1.0] as [number, number, number],
        uptime: 86400,
      };

      metricsCollector.updateMetrics(nodeId, clusterId, {
        currentTerm: 3,
        state: RaftState.CANDIDATE,
        systemMetrics,
      });

      const metrics = metricsCollector.getMetrics(nodeId);
      expect(metrics?.systemMetrics?.cpuUsage).toBe(45.5);
      expect(metrics?.systemMetrics?.memoryUsage).toBe(67.2);
      expect(metrics?.systemMetrics?.loadAverage).toEqual([0.8, 0.9, 1.0]);
    });
  });
});
