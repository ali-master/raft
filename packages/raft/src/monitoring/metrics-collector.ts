import type * as promClient from "prom-client";
import type { RaftMetrics, MetricsConfig } from "../types";
import { RaftState } from "../constants";
import { PrometheusMetrics } from "./prometheus-metrics";

export class RaftMetricsCollector {
  private readonly metrics: Map<string, RaftMetrics> = new Map();
  private readonly prometheusMetrics: PrometheusMetrics;
  private readonly config: MetricsConfig;

  constructor(config: MetricsConfig) {
    this.config = config;
    this.prometheusMetrics = new PrometheusMetrics();
  }

  public updateMetrics(
    nodeId: string,
    clusterId: string,
    metrics: Partial<RaftMetrics>,
  ): void {
    const currentMetrics = this.metrics.get(nodeId) || this.getDefaultMetrics();
    const updatedMetrics = { ...currentMetrics, ...metrics };

    this.metrics.set(nodeId, updatedMetrics);

    if (this.config.enablePrometheus) {
      this.prometheusMetrics.updateRaftMetrics(
        nodeId,
        clusterId,
        updatedMetrics,
      );
    }
  }

  public getMetrics(nodeId: string): RaftMetrics | undefined {
    return this.metrics.get(nodeId);
  }

  public getAllMetrics(): Map<string, RaftMetrics> {
    return new Map(this.metrics);
  }

  public async getPrometheusMetrics(): Promise<string> {
    if (!this.config.enablePrometheus) return "";
    return await this.prometheusMetrics.getMetrics();
  }

  public getPrometheusRegister(): promClient.Registry {
    return this.prometheusMetrics.getRegister();
  }

  public incrementCounter(
    metricName: string,
    labels: Record<string, string>,
  ): void {
    if (this.config.enablePrometheus) {
      this.prometheusMetrics.incrementCounter(metricName, labels);
    }
  }

  public observeHistogram(
    metricName: string,
    labels: Record<string, string>,
    value: number,
  ): void {
    if (this.config.enablePrometheus) {
      this.prometheusMetrics.observeHistogram(metricName, labels, value);
    }
  }

  private getDefaultMetrics(): RaftMetrics {
    return {
      currentTerm: 0,
      state: RaftState.FOLLOWER,
      votedFor: null,
      commitIndex: 0,
      lastApplied: 0,
      logLength: 0,
      leaderHeartbeats: 0,
      electionCount: 0,
      voteCount: 0,
      appendEntriesCount: 0,
      peerCount: 0,
      systemMetrics: {
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0,
        networkLatency: 0,
        loadAverage: [0, 0, 0],
        uptime: 0,
      },
    };
  }
}
