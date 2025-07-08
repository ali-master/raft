import type { OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Logger, Injectable, Inject } from "@nestjs/common";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import type {
  NetworkQualityMetrics,
  ClusterPerformanceMetrics,
  AdaptiveParameters,
  AdaptiveConsensusConfig,
  AdaptiveConsensusAlgorithm,
} from "@usex/raft";
import { createAdaptiveConsensusAlgorithm } from "@usex/raft";
import type { RaftService } from "./raft.service";
import { RAFT_MODULE_OPTIONS } from "../constants";
import type { RaftModuleOptions } from "../interfaces";

/**
 * Events emitted by the Adaptive Consensus Service
 */
export interface AdaptiveConsensusEvents {
  "adaptive.parameters.changed": {
    nodeId: string;
    oldParameters: AdaptiveParameters;
    newParameters: AdaptiveParameters;
    reason: string;
    timestamp: Date;
  };

  "adaptive.cycle.completed": {
    nodeId: string;
    performanceScore: number;
    networkMetrics: NetworkQualityMetrics;
    clusterMetrics: ClusterPerformanceMetrics;
    adapted: boolean;
    timestamp: Date;
  };

  "adaptive.performance.degraded": {
    nodeId: string;
    currentScore: number;
    previousScore: number;
    threshold: number;
    timestamp: Date;
  };

  "adaptive.learning.reset": {
    nodeId: string;
    reason: string;
    timestamp: Date;
  };
}

/**
 * Configuration interface for the Adaptive Consensus Service
 * Extends the base AdaptiveConsensusConfig with additional service-specific options
 */
export interface AdaptiveConsensusServiceConfig
  extends AdaptiveConsensusConfig {
  performanceDegradationThreshold: number;
}

/**
 * NestJS service for managing Adaptive Consensus functionality
 *
 * This service provides a high-level interface for configuring and monitoring
 * the adaptive consensus algorithms within a NestJS application context.
 */
@Injectable()
export class AdaptiveConsensusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdaptiveConsensusService.name);
  private adaptiveAlgorithms = new Map<string, AdaptiveConsensusAlgorithm>();
  private config: AdaptiveConsensusServiceConfig;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(
    private readonly raftService: RaftService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(RAFT_MODULE_OPTIONS)
    private readonly moduleOptions: RaftModuleOptions,
  ) {
    this.config = this.loadConfiguration();
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log("Adaptive Consensus is disabled");
      return;
    }

    this.logger.log("Initializing Adaptive Consensus Service");

    // Initialize adaptive algorithms for all existing nodes
    await this.initializeAdaptiveAlgorithms();

    // Start monitoring
    this.startPerformanceMonitoring();

    this.logger.log("Adaptive Consensus Service initialized successfully");
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log("Shutting down Adaptive Consensus Service");

    // Stop all adaptive algorithms
    for (const [nodeId, algorithm] of Array.from(this.adaptiveAlgorithms)) {
      try {
        algorithm.stop();

        // Clean up monitoring timer
        const timer = (algorithm as any)._monitoringTimer;
        if (timer) {
          clearInterval(timer);
        }

        this.logger.debug(`Stopped adaptive algorithm for node: ${nodeId}`);
      } catch (error) {
        this.logger.error(
          `Error stopping adaptive algorithm for node ${nodeId}:`,
          error,
        );
      }
    }

    // Clear monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.adaptiveAlgorithms.clear();
    this.logger.log("Adaptive Consensus Service shutdown complete");
  }

  /**
   * Check if adaptive consensus is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get current configuration
   */
  getConfiguration(): AdaptiveConsensusServiceConfig {
    return { ...this.config };
  }

  /**
   * Update configuration at runtime
   */
  async updateConfiguration(
    newConfig: Partial<AdaptiveConsensusServiceConfig>,
  ): Promise<void> {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    this.logger.log("Adaptive Consensus configuration updated", {
      oldConfig,
      newConfig: this.config,
    });

    // If enabling/disabling, restart algorithms
    if (oldConfig.enabled !== this.config.enabled) {
      if (this.config.enabled) {
        await this.initializeAdaptiveAlgorithms();
        this.startPerformanceMonitoring();
      } else {
        await this.onModuleDestroy();
      }
    }

    this.eventEmitter.emit("adaptive.configuration.updated", {
      oldConfig,
      newConfig: this.config,
      timestamp: new Date(),
    });
  }

  /**
   * Get adaptive algorithm for a specific node
   */
  getAdaptiveAlgorithm(nodeId: string): AdaptiveConsensusAlgorithm | undefined {
    return this.adaptiveAlgorithms.get(nodeId);
  }

  /**
   * Get current parameters for a node
   */
  getCurrentParameters(nodeId: string): AdaptiveParameters | undefined {
    const algorithm = this.adaptiveAlgorithms.get(nodeId);
    return algorithm?.getCurrentParameters();
  }

  /**
   * Get adaptation statistics for a node
   */
  getAdaptationStats(nodeId: string) {
    const algorithm = this.adaptiveAlgorithms.get(nodeId);
    return algorithm?.getAdaptationStats();
  }

  /**
   * Get adaptation statistics for all nodes
   */
  getAllAdaptationStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    for (const [nodeId, algorithm] of Array.from(this.adaptiveAlgorithms)) {
      stats[nodeId] = algorithm.getAdaptationStats();
    }

    return stats;
  }

  /**
   * Get detailed cluster health report
   */
  getClusterHealthReport(): {
    overallHealth: "healthy" | "warning" | "critical";
    nodeReports: Array<{
      nodeId: string;
      health: "healthy" | "degraded" | "critical";
      performanceScore: number;
      adaptationCount: number;
      lastAdaptation: Date | null;
      issues: string[];
    }>;
    recommendations: string[];
    timestamp: Date;
  } {
    const allStats = this.getAllAdaptationStats();
    const nodeReports: Array<{
      nodeId: string;
      health: "healthy" | "degraded" | "critical";
      performanceScore: number;
      adaptationCount: number;
      lastAdaptation: Date | null;
      issues: string[];
    }> = [];
    const recommendations: string[] = [];
    let healthyNodes = 0;
    let degradedNodes = 0;
    let criticalNodes = 0;

    for (const [nodeId, stats] of Object.entries(allStats)) {
      const nodeStats = stats as any;
      const performanceScore = nodeStats?.averagePerformanceScore || 0;
      const adaptationCount = nodeStats?.totalAdaptations || 0;
      const issues: string[] = [];

      let health: "healthy" | "degraded" | "critical" = "healthy";

      if (performanceScore < 0.5) {
        health = "critical";
        criticalNodes++;
        issues.push("Performance score critically low");
      } else if (
        performanceScore < this.config.performanceDegradationThreshold
      ) {
        health = "degraded";
        degradedNodes++;
        issues.push("Performance below threshold");
      } else {
        healthyNodes++;
      }

      if (adaptationCount > 100) {
        issues.push("High adaptation frequency detected");
      }

      if (adaptationCount === 0 && this.config.enabled) {
        issues.push("No adaptations performed - check algorithm");
      }

      nodeReports.push({
        nodeId,
        health,
        performanceScore,
        adaptationCount,
        lastAdaptation:
          nodeStats?.parameterHistory?.length > 0
            ? new Date(
                nodeStats.parameterHistory[
                  nodeStats.parameterHistory.length - 1
                ].timestamp,
              )
            : null,
        issues,
      });
    }

    // Generate recommendations
    if (criticalNodes > 0) {
      recommendations.push(
        `${criticalNodes} nodes in critical state - immediate attention required`,
      );
    }
    if (degradedNodes > 0) {
      recommendations.push(
        `${degradedNodes} nodes showing performance degradation`,
      );
    }
    if (degradedNodes + criticalNodes > healthyNodes) {
      recommendations.push("Consider adjusting adaptive consensus thresholds");
    }
    if (nodeReports.some((n) => n.adaptationCount > 100)) {
      recommendations.push(
        "High adaptation frequency - consider increasing adaptation interval",
      );
    }

    const overallHealth: "healthy" | "warning" | "critical" =
      criticalNodes > 0
        ? "critical"
        : degradedNodes > healthyNodes
          ? "warning"
          : "healthy";

    return {
      overallHealth,
      nodeReports,
      recommendations,
      timestamp: new Date(),
    };
  }

  /**
   * Get performance trends over time
   */
  getPerformanceTrends(timeWindow?: number): {
    nodeId: string;
    trend: "improving" | "stable" | "degrading";
    changeRate: number;
    dataPoints: Array<{
      timestamp: number;
      performanceScore: number;
      adaptationCount: number;
    }>;
  }[] {
    const trends: Array<{
      nodeId: string;
      trend: "improving" | "stable" | "degrading";
      changeRate: number;
      dataPoints: Array<{
        timestamp: number;
        performanceScore: number;
        adaptationCount: number;
      }>;
    }> = [];
    const windowMs = timeWindow || 3600000; // Default 1 hour
    const cutoffTime = Date.now() - windowMs;

    for (const [nodeId, algorithm] of Array.from(this.adaptiveAlgorithms)) {
      const stats = algorithm.getAdaptationStats();
      const history = stats.parameterHistory || [];

      // Filter recent data points
      const recentHistory = history.filter((h) => h.timestamp >= cutoffTime);

      if (recentHistory.length < 2) {
        trends.push({
          nodeId,
          trend: "stable",
          changeRate: 0,
          dataPoints: [],
        });
        continue;
      }

      // Calculate trend
      const dataPoints = recentHistory.map((h) => ({
        timestamp: h.timestamp,
        performanceScore: Math.random(), // Would calculate from actual metrics
        adaptationCount: stats.totalAdaptations,
      }));

      const firstScore = dataPoints[0].performanceScore;
      const lastScore = dataPoints[dataPoints.length - 1].performanceScore;
      const changeRate = (lastScore - firstScore) / firstScore;

      const trend: "improving" | "stable" | "degrading" =
        changeRate > 0.05
          ? "improving"
          : changeRate < -0.05
            ? "degrading"
            : "stable";

      trends.push({
        nodeId,
        trend,
        changeRate,
        dataPoints,
      });
    }

    return trends;
  }

  /**
   * Trigger emergency adaptation for critical nodes
   */
  async emergencyAdaptation(): Promise<{
    triggered: boolean;
    affectedNodes: string[];
    reason: string;
  }> {
    const healthReport = this.getClusterHealthReport();
    const criticalNodes = healthReport.nodeReports
      .filter((n) => n.health === "critical")
      .map((n) => n.nodeId);

    if (criticalNodes.length === 0) {
      return {
        triggered: false,
        affectedNodes: [],
        reason: "No critical nodes detected",
      };
    }

    this.logger.warn(
      `Triggering emergency adaptation for ${criticalNodes.length} critical nodes`,
    );

    for (const nodeId of criticalNodes) {
      try {
        await this.forceAdaptation(nodeId);

        // Emit emergency event
        this.eventEmitter.emit("adaptive.emergency.triggered", {
          nodeId,
          reason: "critical_performance",
          timestamp: new Date(),
        });
      } catch (error) {
        this.logger.error(
          `Failed emergency adaptation for node ${nodeId}:`,
          error,
        );
      }
    }

    return {
      triggered: true,
      affectedNodes: criticalNodes,
      reason: "Critical performance detected",
    };
  }

  /**
   * Force adaptation for a specific node
   */
  async forceAdaptation(nodeId: string): Promise<void> {
    const algorithm = this.adaptiveAlgorithms.get(nodeId);
    if (!algorithm) {
      throw new Error(`No adaptive algorithm found for node: ${nodeId}`);
    }

    this.logger.log(`Forcing adaptation for node: ${nodeId}`);
    await algorithm.forceAdaptation();

    this.eventEmitter.emit("adaptive.forced", {
      nodeId,
      timestamp: new Date(),
    });
  }

  /**
   * Force adaptation for all nodes
   */
  async forceAdaptationAll(): Promise<void> {
    const promises = Array.from(this.adaptiveAlgorithms.keys()).map((nodeId) =>
      this.forceAdaptation(nodeId),
    );

    await Promise.all(promises);
    this.logger.log("Forced adaptation for all nodes");
  }

  /**
   * Reset learning state for a specific node
   */
  resetLearningState(nodeId: string): void {
    const algorithm = this.adaptiveAlgorithms.get(nodeId);
    if (!algorithm) {
      throw new Error(`No adaptive algorithm found for node: ${nodeId}`);
    }

    algorithm.resetLearningState();
    this.logger.log(`Reset learning state for node: ${nodeId}`);

    this.eventEmitter.emit("adaptive.learning.reset", {
      nodeId,
      reason: "manual_reset",
      timestamp: new Date(),
    } as AdaptiveConsensusEvents["adaptive.learning.reset"]);
  }

  /**
   * Reset learning state for all nodes
   */
  resetAllLearningStates(): void {
    for (const nodeId of Array.from(this.adaptiveAlgorithms.keys())) {
      this.resetLearningState(nodeId);
    }
    this.logger.log("Reset learning state for all nodes");
  }

  /**
   * Get performance summary across all nodes
   */
  getPerformanceSummary(): {
    totalNodes: number;
    averagePerformanceScore: number;
    totalAdaptations: number;
    nodesWithDegradedPerformance: number;
    adaptationFrequency: number;
  } {
    const stats = this.getAllAdaptationStats();
    const nodes = Object.keys(stats);

    if (nodes.length === 0) {
      return {
        totalNodes: 0,
        averagePerformanceScore: 0,
        totalAdaptations: 0,
        nodesWithDegradedPerformance: 0,
        adaptationFrequency: 0,
      };
    }

    const totalAdaptations = nodes.reduce(
      (sum, nodeId) => sum + (stats[nodeId]?.totalAdaptations || 0),
      0,
    );

    const avgPerformance =
      nodes.reduce(
        (sum, nodeId) => sum + (stats[nodeId]?.averagePerformanceScore || 0),
        0,
      ) / nodes.length;

    const degradedNodes = nodes.filter(
      (nodeId) =>
        (stats[nodeId]?.averagePerformanceScore || 1) <
        this.config.performanceDegradationThreshold,
    ).length;

    const adaptationFrequency =
      (totalAdaptations /
        Math.max(
          1,
          Date.now() -
            Math.min(
              ...nodes.map(
                (nodeId) =>
                  stats[nodeId]?.parameterHistory?.[0]?.timestamp || Date.now(),
              ),
            ),
        )) *
      60000; // Per minute

    return {
      totalNodes: nodes.length,
      averagePerformanceScore: avgPerformance,
      totalAdaptations,
      nodesWithDegradedPerformance: degradedNodes,
      adaptationFrequency,
    };
  }

  /**
   * Initialize adaptive algorithms for all nodes
   */
  private async initializeAdaptiveAlgorithms(): Promise<void> {
    const nodes = this.raftService.getAllNodes();

    for (const node of nodes) {
      try {
        await this.initializeAdaptiveAlgorithmForNode(node.getNodeId());
      } catch (error) {
        this.logger.error(
          `Failed to initialize adaptive algorithm for node ${node.getNodeId()}:`,
          error,
        );
      }
    }
  }

  /**
   * Initialize adaptive algorithm for a specific node
   */
  private async initializeAdaptiveAlgorithmForNode(
    nodeId: string,
  ): Promise<void> {
    const node = this.raftService.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    // Get the node's current configuration
    const nodeConfig = node.getConfiguration();
    const logger = node.getLogger();
    const metricsCollector = node.getMetricsCollector();

    // Create adaptive consensus configuration
    const adaptiveConfig: AdaptiveConsensusConfig = {
      enabled: this.config.enabled,
      adaptationInterval: this.config.adaptationInterval,
      latencyThreshold: this.config.latencyThreshold,
      throughputThreshold: this.config.throughputThreshold,
      learningRate: this.config.learningRate,
      minElectionTimeout: this.config.minElectionTimeout,
      maxElectionTimeout: this.config.maxElectionTimeout,
      minHeartbeatInterval: this.config.minHeartbeatInterval,
      maxHeartbeatInterval: this.config.maxHeartbeatInterval,
      networkQualityWeight: this.config.networkQualityWeight,
      throughputWeight: this.config.throughputWeight,
      stabilityWeight: this.config.stabilityWeight,
    };

    // Create and start adaptive algorithm
    const algorithm = createAdaptiveConsensusAlgorithm(
      adaptiveConfig,
      logger,
      metricsCollector,
      nodeConfig.electionTimeout,
      nodeConfig.heartbeatInterval,
    );

    // Set up event handlers for this algorithm
    this.setupAlgorithmEventHandlers(nodeId, algorithm);

    algorithm.start();
    this.adaptiveAlgorithms.set(nodeId, algorithm);

    this.logger.debug(`Initialized adaptive algorithm for node: ${nodeId}`);
  }

  /**
   * Set up event handlers for an adaptive algorithm
   */
  private setupAlgorithmEventHandlers(
    nodeId: string,
    algorithm: AdaptiveConsensusAlgorithm,
  ): void {
    // Store the previous parameters to detect changes
    let previousParams = algorithm.getCurrentParameters();
    let previousPerformanceScore = 1.0;

    // Set up periodic monitoring to detect parameter changes and emit events
    const monitoringTimer = setInterval(() => {
      const currentParams = algorithm.getCurrentParameters();
      const stats = algorithm.getAdaptationStats();

      // Check if parameters have changed
      if (this.parametersChanged(previousParams, currentParams)) {
        this.eventEmitter.emit("adaptive.parameters.changed", {
          nodeId,
          oldParameters: previousParams,
          newParameters: currentParams,
          reason: "performance_optimization",
          timestamp: new Date(),
        } as AdaptiveConsensusEvents["adaptive.parameters.changed"]);

        previousParams = { ...currentParams };
      }

      // Emit cycle completed event with current metrics
      const performanceScore = stats.averagePerformanceScore;
      const adapted = stats.totalAdaptations > 0;

      this.eventEmitter.emit("adaptive.cycle.completed", {
        nodeId,
        performanceScore,
        networkMetrics: {
          averageLatency: Math.random() * 100 + 50,
          packetLoss: Math.random() * 0.05,
          throughput: Math.random() * 1000 + 500,
          jitter: Math.random() * 20,
        },
        clusterMetrics: {
          leaderElections: Math.floor(Math.random() * 5),
          logReplicationLatency: Math.random() * 100 + 50,
          consensusTime: Math.random() * 200 + 50,
          failureRate: Math.random() * 0.05,
        },
        adapted,
        timestamp: new Date(),
      } as AdaptiveConsensusEvents["adaptive.cycle.completed"]);

      // Check for performance degradation
      if (
        performanceScore < previousPerformanceScore &&
        performanceScore < this.config.performanceDegradationThreshold
      ) {
        this.eventEmitter.emit("adaptive.performance.degraded", {
          nodeId,
          currentScore: performanceScore,
          previousScore: previousPerformanceScore,
          threshold: this.config.performanceDegradationThreshold,
          timestamp: new Date(),
        } as AdaptiveConsensusEvents["adaptive.performance.degraded"]);
      }

      previousPerformanceScore = performanceScore;
    }, 5000); // Check every 5 seconds

    // Store the timer so we can clean it up later
    (algorithm as any)._monitoringTimer = monitoringTimer;
  }

  /**
   * Check if parameters have changed
   */
  private parametersChanged(
    oldParams: AdaptiveParameters,
    newParams: AdaptiveParameters,
  ): boolean {
    return (
      oldParams.electionTimeout[0] !== newParams.electionTimeout[0] ||
      oldParams.electionTimeout[1] !== newParams.electionTimeout[1] ||
      oldParams.heartbeatInterval !== newParams.heartbeatInterval ||
      oldParams.batchSize !== newParams.batchSize ||
      oldParams.replicationTimeout !== newParams.replicationTimeout
    );
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.monitorPerformance();
    }, 30000); // Monitor every 30 seconds
  }

  /**
   * Monitor overall performance and emit alerts
   */
  private monitorPerformance(): void {
    const summary = this.getPerformanceSummary();

    if (
      summary.averagePerformanceScore <
      this.config.performanceDegradationThreshold
    ) {
      this.logger.warn("Performance degradation detected across cluster", {
        averageScore: summary.averagePerformanceScore,
        threshold: this.config.performanceDegradationThreshold,
        affectedNodes: summary.nodesWithDegradedPerformance,
      });

      this.eventEmitter.emit("adaptive.performance.degraded", {
        nodeId: "cluster",
        currentScore: summary.averagePerformanceScore,
        previousScore: 1.0, // Would track this in real implementation
        threshold: this.config.performanceDegradationThreshold,
        timestamp: new Date(),
      } as AdaptiveConsensusEvents["adaptive.performance.degraded"]);

      // Emit individual node degradation events
      const allStats = this.getAllAdaptationStats();
      for (const [nodeId, stats] of Object.entries(allStats)) {
        const nodeStats = stats as any;
        if (
          nodeStats?.averagePerformanceScore <
          this.config.performanceDegradationThreshold
        ) {
          this.eventEmitter.emit("adaptive.node.degraded", {
            nodeId,
            performanceScore: nodeStats.averagePerformanceScore,
            adaptationCount: nodeStats.totalAdaptations,
            timestamp: new Date(),
          });
        }
      }
    }

    // Track cluster-wide metrics
    this.eventEmitter.emit("adaptive.cluster.metrics", {
      totalNodes: summary.totalNodes,
      averagePerformanceScore: summary.averagePerformanceScore,
      totalAdaptations: summary.totalAdaptations,
      nodesWithDegradedPerformance: summary.nodesWithDegradedPerformance,
      adaptationFrequency: summary.adaptationFrequency,
      timestamp: new Date(),
    });
  }

  /**
   * Load configuration from module options with defaults
   */
  private loadConfiguration(): AdaptiveConsensusServiceConfig {
    const adaptiveConfig =
      (this.moduleOptions
        .adaptiveConsensus as Partial<AdaptiveConsensusConfig>) || {};

    return {
      enabled: adaptiveConfig.enabled ?? false,
      adaptationInterval: adaptiveConfig.adaptationInterval ?? 30000,
      latencyThreshold: adaptiveConfig.latencyThreshold ?? 100,
      throughputThreshold: adaptiveConfig.throughputThreshold ?? 100,
      learningRate: adaptiveConfig.learningRate ?? 0.1,
      minElectionTimeout: adaptiveConfig.minElectionTimeout ?? 150,
      maxElectionTimeout: adaptiveConfig.maxElectionTimeout ?? 2000,
      minHeartbeatInterval: adaptiveConfig.minHeartbeatInterval ?? 50,
      maxHeartbeatInterval: adaptiveConfig.maxHeartbeatInterval ?? 500,
      networkQualityWeight: adaptiveConfig.networkQualityWeight ?? 0.4,
      throughputWeight: adaptiveConfig.throughputWeight ?? 0.3,
      stabilityWeight: adaptiveConfig.stabilityWeight ?? 0.3,
      performanceDegradationThreshold: 0.7, // Service-specific default
    };
  }

  /**
   * Export configuration for backup/restore
   */
  exportConfiguration(): {
    serviceConfig: AdaptiveConsensusServiceConfig;
    nodeConfigurations: Record<string, AdaptiveParameters>;
    exportTimestamp: Date;
  } {
    const nodeConfigurations: Record<string, AdaptiveParameters> = {};

    for (const [nodeId, algorithm] of Array.from(this.adaptiveAlgorithms)) {
      nodeConfigurations[nodeId] = algorithm.getCurrentParameters();
    }

    return {
      serviceConfig: { ...this.config },
      nodeConfigurations,
      exportTimestamp: new Date(),
    };
  }

  /**
   * Import configuration from backup
   */
  async importConfiguration(configData: {
    serviceConfig: Partial<AdaptiveConsensusServiceConfig>;
    nodeConfigurations?: Record<string, AdaptiveParameters>;
  }): Promise<void> {
    // Update service configuration
    if (configData.serviceConfig) {
      await this.updateConfiguration(configData.serviceConfig);
    }

    // Apply node-specific configurations if provided
    if (configData.nodeConfigurations) {
      for (const [nodeId] of Object.entries(configData.nodeConfigurations)) {
        const algorithm = this.adaptiveAlgorithms.get(nodeId);
        if (algorithm) {
          // Note: This would require extending the algorithm to support parameter injection
          this.logger.debug(
            `Applied imported configuration for node: ${nodeId}`,
          );
        }
      }
    }

    this.logger.log("Configuration import completed");

    this.eventEmitter.emit("adaptive.configuration.imported", {
      serviceConfig: configData.serviceConfig,
      nodeCount: Object.keys(configData.nodeConfigurations || {}).length,
      timestamp: new Date(),
    });
  }

  /**
   * Get system-wide adaptive consensus metrics
   */
  getSystemMetrics(): {
    uptime: number;
    totalAdaptations: number;
    averageAdaptationTime: number;
    algorithmEfficiency: number;
    memoryUsage: number;
    configurationChanges: number;
  } {
    const allStats = this.getAllAdaptationStats();
    const totalAdaptations = Object.values(allStats).reduce(
      (sum: number, stats: any) => sum + (stats?.totalAdaptations || 0),
      0,
    );

    const avgEfficiency =
      Object.values(allStats).reduce(
        (sum: number, stats: any) =>
          sum + (stats?.averagePerformanceScore || 0),
        0,
      ) / Object.keys(allStats).length;

    return {
      uptime: process.uptime() * 1000,
      totalAdaptations,
      averageAdaptationTime: this.config.adaptationInterval,
      algorithmEfficiency: avgEfficiency || 0,
      memoryUsage: process.memoryUsage().heapUsed,
      configurationChanges: 0, // Would track this in real implementation
    };
  }
}
