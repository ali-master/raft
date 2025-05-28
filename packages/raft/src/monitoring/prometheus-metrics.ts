import * as promClient from "prom-client";
import type { RaftMetrics } from "../types";
import { RaftState } from "../constants";

export class PrometheusMetrics {
  private readonly register: promClient.Registry;
  private readonly metrics: Map<string, promClient.Metric> = new Map();

  constructor() {
    this.register = new promClient.Registry();
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // Raft specific metrics
    const raftCurrentTerm = new promClient.Gauge({
      name: "raft_current_term",
      help: "Current Raft term",
      labelNames: ["node_id", "cluster_id"],
      registers: [this.register],
    });

    const raftState = new promClient.Gauge({
      name: "raft_state",
      help: "Current Raft state (0=follower, 1=candidate, 2=leader)",
      labelNames: ["node_id", "cluster_id", "state"],
      registers: [this.register],
    });

    const raftLogEntries = new promClient.Gauge({
      name: "raft_log_entries_total",
      help: "Total number of log entries",
      labelNames: ["node_id", "cluster_id"],
      registers: [this.register],
    });

    const raftCommitIndex = new promClient.Gauge({
      name: "raft_commit_index",
      help: "Current commit index",
      labelNames: ["node_id", "cluster_id"],
      registers: [this.register],
    });

    const raftPeerCount = new promClient.Gauge({
      name: "raft_peer_count",
      help: "Number of known peers",
      labelNames: ["node_id", "cluster_id"],
      registers: [this.register],
    });

    const raftElections = new promClient.Counter({
      name: "raft_elections_total",
      help: "Total number of elections",
      labelNames: ["node_id", "cluster_id"],
      registers: [this.register],
    });

    const raftHeartbeats = new promClient.Counter({
      name: "raft_heartbeats_total",
      help: "Total number of heartbeats sent",
      labelNames: ["node_id", "cluster_id"],
      registers: [this.register],
    });

    const raftVotes = new promClient.Counter({
      name: "raft_votes_total",
      help: "Total number of votes cast",
      labelNames: ["node_id", "cluster_id", "result"],
      registers: [this.register],
    });

    // System metrics
    const systemCpuUsage = new promClient.Gauge({
      name: "system_cpu_usage_percent",
      help: "System CPU usage percentage",
      labelNames: ["node_id", "cluster_id"],
      registers: [this.register],
    });

    const systemMemoryUsage = new promClient.Gauge({
      name: "system_memory_usage_percent",
      help: "System memory usage percentage",
      labelNames: ["node_id", "cluster_id"],
      registers: [this.register],
    });

    const systemDiskUsage = new promClient.Gauge({
      name: "system_disk_usage_percent",
      help: "System disk usage percentage",
      labelNames: ["node_id", "cluster_id"],
      registers: [this.register],
    });

    const systemLoadAverage = new promClient.Gauge({
      name: "system_load_average",
      help: "System load average",
      labelNames: ["node_id", "cluster_id", "period"],
      registers: [this.register],
    });

    const systemUptime = new promClient.Gauge({
      name: "system_uptime_seconds",
      help: "System uptime in seconds",
      labelNames: ["node_id", "cluster_id"],
      registers: [this.register],
    });

    const networkLatency = new promClient.Histogram({
      name: "raft_network_latency_seconds",
      help: "Network latency between nodes",
      labelNames: ["node_id", "cluster_id", "target_node"],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.register],
    });

    // Store references
    this.metrics.set("raft_current_term", raftCurrentTerm);
    this.metrics.set("raft_state", raftState);
    this.metrics.set("raft_log_entries_total", raftLogEntries);
    this.metrics.set("raft_commit_index", raftCommitIndex);
    this.metrics.set("raft_peer_count", raftPeerCount);
    this.metrics.set("raft_elections_total", raftElections);
    this.metrics.set("raft_heartbeats_total", raftHeartbeats);
    this.metrics.set("raft_votes_total", raftVotes);
    this.metrics.set("system_cpu_usage_percent", systemCpuUsage);
    this.metrics.set("system_memory_usage_percent", systemMemoryUsage);
    this.metrics.set("system_disk_usage_percent", systemDiskUsage);
    this.metrics.set("system_load_average", systemLoadAverage);
    this.metrics.set("system_uptime_seconds", systemUptime);
    this.metrics.set("raft_network_latency_seconds", networkLatency);
  }

  public updateRaftMetrics(
    nodeId: string,
    clusterId: string,
    metrics: RaftMetrics,
  ): void {
    const labels = { node_id: nodeId, cluster_id: clusterId };

    (this.metrics.get("raft_current_term") as promClient.Gauge)?.set(
      labels,
      metrics.currentTerm,
    );
    (this.metrics.get("raft_log_entries_total") as promClient.Gauge)?.set(
      labels,
      metrics.logLength,
    );
    (this.metrics.get("raft_commit_index") as promClient.Gauge)?.set(
      labels,
      metrics.commitIndex,
    );
    (this.metrics.get("raft_peer_count") as promClient.Gauge)?.set(
      labels,
      metrics.peerCount,
    );

    // State metric (0=follower, 1=candidate, 2=leader)
    const stateValue =
      metrics.state === RaftState.FOLLOWER
        ? 0
        : metrics.state === RaftState.CANDIDATE
          ? 1
          : 2;
    (this.metrics.get("raft_state") as promClient.Gauge)?.set(
      { ...labels, state: metrics.state },
      stateValue,
    );

    // System metrics
    (this.metrics.get("system_cpu_usage_percent") as promClient.Gauge)?.set(
      labels,
      metrics.systemMetrics.cpuUsage,
    );
    (this.metrics.get("system_memory_usage_percent") as promClient.Gauge)?.set(
      labels,
      metrics.systemMetrics.memoryUsage,
    );
    (this.metrics.get("system_disk_usage_percent") as promClient.Gauge)?.set(
      labels,
      metrics.systemMetrics.diskUsage,
    );
    (this.metrics.get("system_uptime_seconds") as promClient.Gauge)?.set(
      labels,
      metrics.systemMetrics.uptime,
    );

    // Load average metrics
    const loadMetric = this.metrics.get(
      "system_load_average",
    ) as promClient.Gauge;
    if (loadMetric && metrics.systemMetrics.loadAverage) {
      loadMetric.set(
        { ...labels, period: "1m" },
        metrics.systemMetrics.loadAverage[0] || 0,
      );
      loadMetric.set(
        { ...labels, period: "5m" },
        metrics.systemMetrics.loadAverage[1] || 0,
      );
      loadMetric.set(
        { ...labels, period: "15m" },
        metrics.systemMetrics.loadAverage[2] || 0,
      );
    }
  }

  public incrementCounter(
    metricName: string,
    labels: Record<string, string>,
  ): void {
    const metric = this.metrics.get(metricName) as promClient.Counter;
    if (metric) {
      metric.inc(labels);
    }
  }

  public observeHistogram(
    metricName: string,
    labels: Record<string, string>,
    value: number,
  ): void {
    const metric = this.metrics.get(metricName) as promClient.Histogram;
    if (metric) {
      metric.observe(labels, value);
    }
  }

  public getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  public getRegister(): promClient.Registry {
    return this.register;
  }
}
