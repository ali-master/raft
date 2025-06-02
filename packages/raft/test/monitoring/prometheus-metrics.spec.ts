import { it, expect, describe, beforeEach } from "vitest";
import { PrometheusMetrics } from "../../src/monitoring/prometheus-metrics";
import { RaftState } from "../../src/constants";
import type { RaftMetrics } from "../../src/types";

describe("prometheusMetrics", () => {
  let prometheusMetrics: PrometheusMetrics;

  beforeEach(() => {
    prometheusMetrics = new PrometheusMetrics();
  });

  it("should initialize all metrics", async () => {
    const metrics = await prometheusMetrics.getMetrics();

    expect(metrics).toContain("raft_current_term");
    expect(metrics).toContain("raft_state");
    expect(metrics).toContain("raft_log_entries_total");
    expect(metrics).toContain("raft_commit_index");
    expect(metrics).toContain("raft_peer_count");
    expect(metrics).toContain("raft_elections_total");
    expect(metrics).toContain("raft_heartbeats_total");
    expect(metrics).toContain("raft_votes_total");
    expect(metrics).toContain("system_cpu_usage_percent");
    expect(metrics).toContain("system_memory_usage_percent");
    expect(metrics).toContain("system_disk_usage_percent");
    expect(metrics).toContain("system_load_average");
    expect(metrics).toContain("system_uptime_seconds");
    expect(metrics).toContain("raft_network_latency_seconds");
  });

  it("should update Raft metrics", async () => {
    const raftMetrics: RaftMetrics = {
      currentTerm: 5,
      state: RaftState.LEADER,
      votedFor: "node2",
      commitIndex: 10,
      lastApplied: 8,
      logLength: 15,
      leaderHeartbeats: 100,
      electionCount: 2,
      voteCount: 3,
      appendEntriesCount: 50,
      peerCount: 3,
      systemMetrics: {
        cpuUsage: 25,
        memoryUsage: 40,
        diskUsage: 60,
        networkLatency: 5,
        loadAverage: [0.5, 0.6, 0.7],
        uptime: 3600,
      },
    };

    prometheusMetrics.updateRaftMetrics("node1", "cluster1", raftMetrics);

    const metrics = await prometheusMetrics.getMetrics();
    expect(metrics).toContain(
      'raft_current_term{node_id="node1",cluster_id="cluster1"} 5',
    );
    expect(metrics).toContain(
      'raft_state{node_id="node1",cluster_id="cluster1",state="leader"} 2',
    );
    expect(metrics).toContain(
      'raft_log_entries_total{node_id="node1",cluster_id="cluster1"} 15',
    );
    expect(metrics).toContain(
      'raft_commit_index{node_id="node1",cluster_id="cluster1"} 10',
    );
  });

  it("should increment counters", async () => {
    prometheusMetrics.incrementCounter("raft_elections_total", {
      node_id: "node1",
      cluster_id: "cluster1",
    });

    prometheusMetrics.incrementCounter("raft_elections_total", {
      node_id: "node1",
      cluster_id: "cluster1",
    });

    const metrics = await prometheusMetrics.getMetrics();
    expect(metrics).toContain(
      'raft_elections_total{node_id="node1",cluster_id="cluster1"} 2',
    );
  });

  it("should observe histogram values", async () => {
    prometheusMetrics.observeHistogram(
      "raft_network_latency_seconds",
      {
        node_id: "node1",
        cluster_id: "cluster1",
        target_node: "node2",
      },
      0.025,
    );

    prometheusMetrics.observeHistogram(
      "raft_network_latency_seconds",
      {
        node_id: "node1",
        cluster_id: "cluster1",
        target_node: "node2",
      },
      0.075,
    );

    const metrics = await prometheusMetrics.getMetrics();
    expect(metrics).toContain("raft_network_latency_seconds_bucket");
    expect(metrics).toContain("raft_network_latency_seconds_sum");
    expect(metrics).toContain("raft_network_latency_seconds_count");
  });
});
