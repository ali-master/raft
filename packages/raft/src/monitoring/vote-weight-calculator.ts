import type { VotingConfig } from "../types";
import type { RaftMetricsCollector } from "./metrics-collector";
import type { PeerDiscoveryService } from "../services";

export class VoteWeightCalculator {
  private readonly config: VotingConfig;
  private readonly metrics: RaftMetricsCollector;
  private readonly peerDiscovery: PeerDiscoveryService;

  constructor(
    config: VotingConfig,
    metrics: RaftMetricsCollector,
    peerDiscovery: PeerDiscoveryService,
  ) {
    this.config = config;
    this.metrics = metrics;
    this.peerDiscovery = peerDiscovery;
  }

  public calculateWeight(nodeId: string): number {
    if (!this.config.enableWeighting) {
      return this.config.defaultWeight;
    }

    const nodeMetrics = this.metrics.getMetrics(nodeId);
    const peerInfo = this.peerDiscovery.getPeerInfo(nodeId);
    const systemMetrics = peerInfo?.metrics || nodeMetrics?.systemMetrics;

    if (!systemMetrics) {
      return this.config.defaultWeight;
    }

    let weight = this.config.defaultWeight;

    for (const metric of this.config.weightMetrics) {
      switch (metric) {
        case "networkLatency":
          // Lower latency = higher weight
          weight += Math.max(0, 100 - systemMetrics.networkLatency);
          break;
        case "cpuUsage":
          // Lower CPU usage = higher weight
          weight += Math.max(0, 100 - systemMetrics.cpuUsage);
          break;
        case "memoryUsage":
          // Lower memory usage = higher weight
          weight += Math.max(0, 100 - systemMetrics.memoryUsage);
          break;
        case "diskUsage":
          // Lower disk usage = higher weight
          weight += Math.max(0, 100 - systemMetrics.diskUsage);
          break;
        case "loadAverage": {
          // Lower load average = higher weight
          const load1m = systemMetrics.loadAverage[0] || 0;
          weight += Math.max(0, 100 - load1m * 100);
          break;
        }
        case "uptime":
          // Higher uptime = higher weight (stability)
          weight += Math.min(100, systemMetrics.uptime / 3600); // Convert to hours, cap at 100
          break;
        case "logLength": {
          // More log entries = higher weight (more up-to-date)
          const logLength = nodeMetrics?.logLength || 0;
          weight += logLength * 0.1;
          break;
        }
      }
    }

    return Math.max(1, Math.round(weight));
  }
}
