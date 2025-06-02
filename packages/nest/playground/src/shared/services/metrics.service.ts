import { Injectable } from "@nestjs/common";
import {
  register,
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Summary,
} from "prom-client";

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly summaries = new Map<string, Summary>();

  constructor() {
    // Collect default metrics
    collectDefaultMetrics();

    // Initialize Raft-specific metrics
    this.initializeRaftMetrics();
  }

  private initializeRaftMetrics() {
    // State changes
    this.createCounter(
      "raft_state_changes_total",
      "Total number of state changes",
      ["node", "from", "to"],
    );

    // Elections
    this.createCounter("raft_elections_total", "Total number of elections", [
      "node",
      "result",
    ]);
    this.createHistogram(
      "raft_election_duration_seconds",
      "Election duration in seconds",
      ["node"],
    );

    // Voting
    this.createCounter("raft_votes_total", "Total number of votes", [
      "node",
      "type",
      "granted",
    ]);

    // Log replication
    this.createCounter(
      "raft_log_entries_total",
      "Total number of log entries",
      ["node"],
    );
    this.createCounter(
      "raft_replication_success_total",
      "Total successful replications",
      ["node", "peer"],
    );
    this.createCounter(
      "raft_replication_failure_total",
      "Total failed replications",
      ["node", "peer"],
    );
    this.createHistogram(
      "raft_replication_latency_seconds",
      "Replication latency",
      ["node", "peer"],
    );

    // Cluster
    this.createGauge("raft_cluster_size", "Current cluster size", ["cluster"]);
    this.createGauge(
      "raft_leader_changes_total",
      "Total number of leader changes",
      ["cluster"],
    );

    // Performance
    this.createHistogram("raft_request_duration_seconds", "Request duration", [
      "method",
      "status",
    ]);
    this.createGauge("raft_active_connections", "Active connections", ["node"]);

    // Application-specific
    this.createCounter("cache_hits_total", "Total cache hits", ["node"]);
    this.createCounter("cache_misses_total", "Total cache misses", ["node"]);
    this.createCounter("tasks_processed_total", "Total tasks processed", [
      "node",
      "status",
    ]);
    this.createCounter("locks_acquired_total", "Total locks acquired", [
      "node",
    ]);
    this.createCounter("locks_released_total", "Total locks released", [
      "node",
    ]);
  }

  createCounter(name: string, help: string, labels: string[] = []): Counter {
    if (!this.counters.has(name)) {
      const counter = new Counter({ name, help, labelNames: labels });
      this.counters.set(name, counter);
      register.registerMetric(counter);
    }
    return this.counters.get(name)!;
  }

  createGauge(name: string, help: string, labels: string[] = []): Gauge {
    if (!this.gauges.has(name)) {
      const gauge = new Gauge({ name, help, labelNames: labels });
      this.gauges.set(name, gauge);
      register.registerMetric(gauge);
    }
    return this.gauges.get(name)!;
  }

  createHistogram(
    name: string,
    help: string,
    labels: string[] = [],
  ): Histogram {
    if (!this.histograms.has(name)) {
      const histogram = new Histogram({ name, help, labelNames: labels });
      this.histograms.set(name, histogram);
      register.registerMetric(histogram);
    }
    return this.histograms.get(name)!;
  }

  createSummary(name: string, help: string, labels: string[] = []): Summary {
    if (!this.summaries.has(name)) {
      const summary = new Summary({ name, help, labelNames: labels });
      this.summaries.set(name, summary);
      register.registerMetric(summary);
    }
    return this.summaries.get(name)!;
  }

  incrementCounter(name: string, labels?: Record<string, string>) {
    const counter = this.counters.get(name);
    if (counter) {
      if (labels) {
        counter.labels(labels).inc();
      } else {
        counter.inc();
      }
    }
  }

  setGauge(name: string, value: number, labels?: Record<string, string>) {
    const gauge = this.gauges.get(name);
    if (gauge) {
      if (labels) {
        gauge.labels(labels).set(value);
      } else {
        gauge.set(value);
      }
    }
  }

  observeHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ) {
    const histogram = this.histograms.get(name);
    if (histogram) {
      if (labels) {
        histogram.labels(labels).observe(value);
      } else {
        histogram.observe(value);
      }
    }
  }

  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }
}
