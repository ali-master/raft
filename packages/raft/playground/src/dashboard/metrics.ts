export interface NodeTelemetry {
  sent: number;
  received: number;
  failed: number;
  inFlight: number;
  heartbeats: number;
  elections: number;
  applied: number;
  rate: number;
  p50: number | null;
  p95: number | null;
}

export interface MetricsSample {
  time: number;
  nodes: Record<string, { rate: number; p95: number | null; lag: number }>;
  rss: number;
  heap: number;
  cpu: number;
}

const empty = (): NodeTelemetry => ({
  sent: 0,
  received: 0,
  failed: 0,
  inFlight: 0,
  heartbeats: 0,
  elections: 0,
  applied: 0,
  rate: 0,
  p50: null,
  p95: null,
});

export class DashboardMetrics {
  private nodes = new Map<
    string,
    {
      metrics: NodeTelemetry;
      durations: { time: number; duration: number }[];
      previousSent: number;
    }
  >();
  private lastSample = Date.now();
  private previousCpu = process.cpuUsage();
  readonly history: MetricsSample[] = [];

  private entry(id: string) {
    let entry = this.nodes.get(id);
    if (!entry) {
      entry = { metrics: empty(), durations: [], previousSent: 0 };
      this.nodes.set(id, entry);
    }
    return entry;
  }

  rpc(id: string, target: string, phase: string, duration: number) {
    const source = this.entry(id);
    const metrics = source.metrics;
    if (phase === "sent" || phase === "blocked") metrics.sent++;
    if (phase === "sent") metrics.inFlight++;
    if (phase === "failed" || phase === "blocked") metrics.failed++;
    if (phase === "received" || phase === "failed")
      metrics.inFlight = Math.max(0, metrics.inFlight - 1);
    if (phase === "received") {
      this.entry(target).metrics.received++;
      source.durations.push({ time: Date.now(), duration });
      source.durations = source.durations.slice(-1000);
    }
  }

  event(id: string, type: string) {
    const metrics = this.entry(id).metrics;
    if (type === "heartbeat_received") metrics.heartbeats++;
    if (type === "election_started") metrics.elections++;
    if (type === "log_applied") metrics.applied++;
  }

  get(id: string): NodeTelemetry {
    return { ...this.entry(id).metrics };
  }

  sample(
    nodes: {
      id: string;
      commitIndex: number;
      lastApplied: number;
      running: boolean;
    }[],
    now = Date.now(),
  ) {
    const elapsed = now - this.lastSample;
    if (elapsed < 1000) return;
    const cpu = process.cpuUsage();
    const memory = process.memoryUsage();
    const sample: MetricsSample = {
      time: now,
      nodes: {},
      rss: memory.rss,
      heap: memory.heapUsed,
      cpu: Math.max(
        0,
        (cpu.user +
          cpu.system -
          this.previousCpu.user -
          this.previousCpu.system) /
          (elapsed * 10),
      ),
    };
    const commit = Math.max(
      0,
      ...nodes.filter((node) => node.running).map((node) => node.commitIndex),
    );
    for (const node of nodes) {
      const entry = this.entry(node.id);
      const metrics = entry.metrics;
      metrics.rate = Math.round(
        ((metrics.sent - entry.previousSent) * 1000) / elapsed,
      );
      entry.previousSent = metrics.sent;
      entry.durations = entry.durations.filter(
        (item) => item.time >= now - 60_000,
      );
      const sorted = entry.durations
        .map((item) => item.duration)
        .sort((a, b) => a - b);
      metrics.p50 = sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null;
      metrics.p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
      sample.nodes[node.id] = {
        rate: metrics.rate,
        p95: metrics.p95,
        lag: Math.max(0, commit - node.lastApplied),
      };
    }
    this.lastSample = now;
    this.previousCpu = cpu;
    this.history.push(sample);
    if (this.history.length > 60) this.history.shift();
  }
}
