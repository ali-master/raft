import { Injectable } from "@nestjs/common";
import { RaftService } from "@usex/raft-nestjs";
import { EventBusService } from "@/shared/services/event-bus.service";
import { MetricsService } from "@/shared/services/metrics.service";
import { LoggerService } from "@/shared/services/logger.service";
import { DistributedCacheService } from "../distributed-cache/distributed-cache.service";
import { TaskQueueService } from "../task-queue/task-queue.service";
import { LockService } from "../lock-service/lock-service.service";
import { GameServerService } from "../game-server/game-server.service";

export interface NodeHealth {
  nodeId: string;
  status: "healthy" | "degraded" | "unhealthy";
  isLeader: boolean;
  state: string;
  lastHeartbeat: Date;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  cpu: number;
}

export interface ClusterHealth {
  healthy: boolean;
  nodeCount: number;
  leaderNode?: string;
  healthyNodes: number;
  degradedNodes: number;
  unhealthyNodes: number;
  lastElection?: Date;
  electionCount: number;
}

export interface RaftMetrics {
  logIndex: number;
  commitIndex: number;
  term: number;
  votedFor?: string;
  appliedEntries: number;
  pendingEntries: number;
  replicationLag: Map<string, number>;
}

export interface ApplicationMetrics {
  cache: {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
  tasks: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    throughput: number;
  };
  locks: {
    active: number;
    expired: number;
    acquired: number;
    released: number;
  };
  games: {
    active: number;
    totalPlayers: number;
    gamesCreated: number;
    gamesFinished: number;
  };
}

@Injectable()
export class MonitoringService {
  private readonly nodeId: string;
  private startTime: Date;
  private metricsHistory: any[] = [];
  private eventHistory: any[] = [];
  private alertHistory: any[] = [];

  constructor(
    private readonly raftService: RaftService,
    private readonly eventBus: EventBusService,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
    private readonly cacheService: DistributedCacheService,
    private readonly taskQueueService: TaskQueueService,
    private readonly lockService: LockService,
    private readonly gameServerService: GameServerService,
  ) {
    this.nodeId = process.env.NODE_ID || "unknown";
    this.startTime = new Date();
    this.startMetricsCollection();
    this.subscribeToEvents();
  }

  async getNodeHealth(): Promise<NodeHealth> {
    const uptime = Date.now() - this.startTime.getTime();

    return {
      nodeId: this.nodeId,
      status: this.calculateHealthStatus(),
      isLeader: this.raftService.isLeader(),
      state: this.raftService.getState(),
      lastHeartbeat: new Date(),
      uptime,
      memory: process.memoryUsage(),
      cpu: this.getCpuUsage(),
    };
  }

  async getClusterHealth(): Promise<ClusterHealth> {
    const nodes = this.raftService.getClusterNodes();
    const leaderNode = this.raftService.getLeaderId();

    // In a real implementation, we'd check each node's health
    const healthyNodes = nodes.length; // Simplified

    return {
      healthy: healthyNodes === nodes.length,
      nodeCount: nodes.length,
      leaderNode,
      healthyNodes,
      degradedNodes: 0,
      unhealthyNodes: 0,
      lastElection: this.getLastElectionTime(),
      electionCount: this.getElectionCount(),
    };
  }

  async getRaftMetrics(): Promise<RaftMetrics> {
    // These would come from the actual Raft implementation
    return {
      logIndex: 0, // Placeholder
      commitIndex: 0, // Placeholder
      term: 0, // Placeholder
      votedFor: undefined,
      appliedEntries: 0,
      pendingEntries: 0,
      replicationLag: new Map(),
    };
  }

  async getApplicationMetrics(): Promise<ApplicationMetrics> {
    const cacheStats = await this.cacheService.stats();
    const taskStats = await this.taskQueueService.getQueueStats();
    const lockStats = await this.lockService.getStats();
    const gameStats = await this.gameServerService.getStats();

    return {
      cache: {
        size: cacheStats.size,
        hits: this.getMetricValue("cache_hits_total"),
        misses: this.getMetricValue("cache_misses_total"),
        hitRate: this.calculateHitRate(),
      },
      tasks: {
        total: taskStats.totalTasks,
        pending: taskStats.tasksByStatus["PENDING"] || 0,
        processing: taskStats.tasksByStatus["PROCESSING"] || 0,
        completed: taskStats.tasksByStatus["COMPLETED"] || 0,
        failed: taskStats.tasksByStatus["FAILED"] || 0,
        throughput: this.calculateTaskThroughput(),
      },
      locks: {
        active: lockStats.activeLocks,
        expired: lockStats.expiredLocks,
        acquired: this.getMetricValue("locks_acquired_total"),
        released: this.getMetricValue("locks_released_total"),
      },
      games: {
        active: gameStats.gamesByState.inProgress,
        totalPlayers: gameStats.totalPlayers,
        gamesCreated: this.getMetricValue("games_created_total"),
        gamesFinished: this.getMetricValue("games_finished_total"),
      },
    };
  }

  async getPrometheusMetrics(): Promise<string> {
    return this.metrics.getMetrics();
  }

  getMetricsHistory(minutes: number = 60): any[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.metricsHistory.filter((m) => m.timestamp > cutoff);
  }

  getEventHistory(limit: number = 100): any[] {
    return this.eventHistory.slice(-limit);
  }

  getAlertHistory(limit: number = 50): any[] {
    return this.alertHistory.slice(-limit);
  }

  async getDashboardData() {
    const [nodeHealth, clusterHealth, raftMetrics, appMetrics] =
      await Promise.all([
        this.getNodeHealth(),
        this.getClusterHealth(),
        this.getRaftMetrics(),
        this.getApplicationMetrics(),
      ]);

    return {
      nodeHealth,
      clusterHealth,
      raftMetrics,
      appMetrics,
      recentEvents: this.getEventHistory(20),
      recentAlerts: this.getAlertHistory(10),
      metricsHistory: this.getMetricsHistory(5),
    };
  }

  private calculateHealthStatus(): "healthy" | "degraded" | "unhealthy" {
    const memory = process.memoryUsage();
    const memoryUsagePercent = (memory.heapUsed / memory.heapTotal) * 100;

    if (memoryUsagePercent > 90) return "unhealthy";
    if (memoryUsagePercent > 70) return "degraded";

    // Check other health indicators
    const errorRate = this.calculateErrorRate();
    if (errorRate > 0.1) return "unhealthy";
    if (errorRate > 0.05) return "degraded";

    return "healthy";
  }

  private getCpuUsage(): number {
    // Simplified CPU usage calculation
    const cpus = require("os").cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    return 100 - ~~((100 * totalIdle) / totalTick);
  }

  private getMetricValue(metricName: string): number {
    // In a real implementation, this would query the metrics registry
    return Math.floor(Math.random() * 1000); // Placeholder
  }

  private calculateHitRate(): number {
    const hits = this.getMetricValue("cache_hits_total");
    const misses = this.getMetricValue("cache_misses_total");
    const total = hits + misses;

    return total > 0 ? (hits / total) * 100 : 0;
  }

  private calculateTaskThroughput(): number {
    // Tasks per minute
    const completed = this.getMetricValue("tasks_processed_total");
    const uptime = (Date.now() - this.startTime.getTime()) / 60000;

    return uptime > 0 ? completed / uptime : 0;
  }

  private calculateErrorRate(): number {
    // Simplified error rate calculation
    const errors = this.eventHistory.filter(
      (e) => e.type.includes("error") || e.type.includes("fail"),
    ).length;

    return this.eventHistory.length > 0 ? errors / this.eventHistory.length : 0;
  }

  private getLastElectionTime(): Date | undefined {
    const electionEvent = this.eventHistory
      .filter((e) => e.type === "raft.leader_elected")
      .pop();

    return electionEvent ? new Date(electionEvent.timestamp) : undefined;
  }

  private getElectionCount(): number {
    return this.eventHistory.filter((e) => e.type === "raft.leader_elected")
      .length;
  }

  private startMetricsCollection() {
    setInterval(async () => {
      const snapshot = {
        timestamp: Date.now(),
        nodeHealth: await this.getNodeHealth(),
        appMetrics: await this.getApplicationMetrics(),
      };

      this.metricsHistory.push(snapshot);

      // Keep only last hour of metrics
      const cutoff = Date.now() - 3600000;
      this.metricsHistory = this.metricsHistory.filter(
        (m) => m.timestamp > cutoff,
      );
    }, 10000); // Collect every 10 seconds
  }

  private subscribeToEvents() {
    // Subscribe to all events for monitoring
    this.eventBus.getAllEvents().subscribe((event) => {
      this.eventHistory.push({
        ...event,
        timestamp: Date.now(),
      });

      // Keep only last 1000 events
      if (this.eventHistory.length > 1000) {
        this.eventHistory = this.eventHistory.slice(-1000);
      }

      // Check for alerts
      this.checkForAlerts(event);
    });
  }

  private checkForAlerts(event: any) {
    // Check for error events
    if (event.type.includes("error") || event.type.includes("fail")) {
      this.addAlert("error", `Error event: ${event.type}`, event.data);
    }

    // Check for state changes
    if (event.type === "raft.state_change") {
      this.addAlert(
        "warning",
        `Node state changed to ${event.data.to}`,
        event.data,
      );
    }

    // Check for leader changes
    if (event.type === "raft.leader_elected") {
      this.addAlert(
        "info",
        `New leader elected: ${event.data.leaderId}`,
        event.data,
      );
    }
  }

  private addAlert(
    level: "info" | "warning" | "error",
    message: string,
    data?: any,
  ) {
    const alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      level,
      message,
      data,
      timestamp: new Date(),
      nodeId: this.nodeId,
    };

    this.alertHistory.push(alert);

    // Keep only last 100 alerts
    if (this.alertHistory.length > 100) {
      this.alertHistory = this.alertHistory.slice(-100);
    }

    this.eventBus.emit({
      type: "monitoring.alert",
      nodeId: this.nodeId,
      timestamp: new Date(),
      data: alert,
    });

    this.logger.warn(`Alert: ${message}`, "Monitoring");
  }
}
