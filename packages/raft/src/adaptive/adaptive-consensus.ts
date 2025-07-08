import type { RaftLogger } from "../services/logger";
import type { AdaptiveConsensusConfig } from "../types/config";
import type { RaftMetricsCollector } from "../monitoring/metrics-collector";

/**
 * Network Quality Metrics used for adaptive decisions
 */
export interface NetworkQualityMetrics {
  averageLatency: number;
  packetLoss: number;
  throughput: number;
  jitter: number;
}

/**
 * Cluster Performance Metrics used for adaptive decisions
 */
export interface ClusterPerformanceMetrics {
  leaderElections: number;
  logReplicationLatency: number;
  consensusTime: number;
  failureRate: number;
}

/**
 * Adaptive Parameters that can be dynamically adjusted
 */
export interface AdaptiveParameters {
  electionTimeout: [number, number];
  heartbeatInterval: number;
  batchSize: number;
  replicationTimeout: number;
}

/**
 * Adaptive Consensus Algorithm Implementation
 *
 * This class implements machine learning-inspired adaptive mechanisms
 * to optimize Raft consensus parameters based on real-time cluster conditions.
 */
export class AdaptiveConsensusAlgorithm {
  private readonly config: AdaptiveConsensusConfig;
  private readonly logger: RaftLogger;
  private readonly metricsCollector: RaftMetricsCollector;

  private adaptationTimer?: NodeJS.Timeout;
  private currentParameters: AdaptiveParameters;
  private historicalMetrics: Array<{
    timestamp: number;
    networkQuality: NetworkQualityMetrics;
    clusterPerformance: ClusterPerformanceMetrics;
    parameters: AdaptiveParameters;
  }> = [];

  // Learning state
  private performanceHistory: number[] = [];
  private parameterEffectiveness: Map<string, number> = new Map();

  constructor(
    config: AdaptiveConsensusConfig,
    logger: RaftLogger,
    metricsCollector: RaftMetricsCollector,
    initialParameters: AdaptiveParameters,
  ) {
    this.config = config;
    this.logger = logger;
    this.metricsCollector = metricsCollector;
    this.currentParameters = { ...initialParameters };

    this.logger.info("Adaptive Consensus Algorithm initialized", {
      enabled: this.config.enabled,
      adaptationInterval: this.config.adaptationInterval,
      learningRate: this.config.learningRate,
    });
  }

  /**
   * Start the adaptive consensus algorithm
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.info("Adaptive Consensus Algorithm is disabled");
      return;
    }

    this.logger.info("Starting Adaptive Consensus Algorithm");
    this.scheduleAdaptation();
  }

  /**
   * Stop the adaptive consensus algorithm
   */
  public stop(): void {
    if (this.adaptationTimer) {
      clearTimeout(this.adaptationTimer);
      this.adaptationTimer = undefined;
    }
    this.logger.info("Adaptive Consensus Algorithm stopped");
  }

  /**
   * Get current adaptive parameters
   */
  public getCurrentParameters(): AdaptiveParameters {
    return { ...this.currentParameters };
  }

  /**
   * Force an immediate adaptation cycle
   */
  public async forceAdaptation(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    await this.performAdaptation();
  }

  /**
   * Schedule the next adaptation cycle
   */
  private scheduleAdaptation(): void {
    this.adaptationTimer = setTimeout(async () => {
      try {
        await this.performAdaptation();
        this.scheduleAdaptation(); // Schedule next cycle
      } catch (error) {
        this.logger.error("Error during adaptation cycle", { error });
        this.scheduleAdaptation(); // Continue despite errors
      }
    }, this.config.adaptationInterval);
  }

  /**
   * Perform adaptation based on current metrics
   */
  private async performAdaptation(): Promise<void> {
    const networkMetrics = await this.collectNetworkMetrics();
    const clusterMetrics = await this.collectClusterMetrics();

    // Calculate performance score
    const performanceScore = this.calculatePerformanceScore(
      networkMetrics,
      clusterMetrics,
    );
    this.performanceHistory.push(performanceScore);

    // Keep only recent history
    if (this.performanceHistory.length > 100) {
      this.performanceHistory = this.performanceHistory.slice(-50);
    }

    // Determine if adaptation is needed
    const shouldAdapt = this.shouldAdaptParameters(
      networkMetrics,
      clusterMetrics,
      performanceScore,
    );

    if (shouldAdapt) {
      const newParameters = await this.calculateOptimalParameters(
        networkMetrics,
        clusterMetrics,
        performanceScore,
      );

      await this.applyParameters(newParameters);

      // Store historical data for learning
      this.historicalMetrics.push({
        timestamp: Date.now(),
        networkQuality: networkMetrics,
        clusterPerformance: clusterMetrics,
        parameters: { ...newParameters },
      });

      // Keep only recent history
      if (this.historicalMetrics.length > 1000) {
        this.historicalMetrics = this.historicalMetrics.slice(-500);
      }
    }

    this.logger.debug("Adaptation cycle completed", {
      performanceScore,
      shouldAdapt,
      currentParameters: this.currentParameters,
    });
  }

  /**
   * Collect network quality metrics
   */
  private async collectNetworkMetrics(): Promise<NetworkQualityMetrics> {
    // This would integrate with actual network monitoring
    // For now, we'll simulate based on available metrics
    const allMetrics = this.metricsCollector.getAllMetrics();

    let totalLatency = 0;
    let samples = 0;

    for (const [_nodeId, metrics] of Array.from(allMetrics)) {
      if (metrics.systemMetrics?.networkLatency !== undefined) {
        totalLatency += metrics.systemMetrics.networkLatency;
        samples++;
      }
    }

    const averageLatency = samples > 0 ? totalLatency / samples : 50;

    return {
      averageLatency,
      packetLoss: Math.random() * 0.01, // Simulated
      throughput: Math.random() * 1000 + 500, // Simulated ops/sec
      jitter: averageLatency * 0.1, // Simulated
    };
  }

  /**
   * Collect cluster performance metrics
   */
  private async collectClusterMetrics(): Promise<ClusterPerformanceMetrics> {
    const allMetrics = this.metricsCollector.getAllMetrics();

    let totalElections = 0;
    let totalReplicationLatency = 0;
    let samples = 0;

    for (const [_nodeId, metrics] of Array.from(allMetrics)) {
      totalElections += metrics.electionCount;
      // logReplicationLatency is not available in RaftMetrics, using simulated value
      const simulatedReplicationLatency = Math.random() * 100 + 50;
      totalReplicationLatency += simulatedReplicationLatency;
      samples++;
    }

    return {
      leaderElections: totalElections,
      logReplicationLatency:
        samples > 0 ? totalReplicationLatency / samples : 100,
      consensusTime: Math.random() * 200 + 50, // Simulated
      failureRate: Math.random() * 0.05, // Simulated
    };
  }

  /**
   * Calculate overall performance score (0-1, higher is better)
   */
  private calculatePerformanceScore(
    networkMetrics: NetworkQualityMetrics,
    clusterMetrics: ClusterPerformanceMetrics,
  ): number {
    // Network quality component (0-1)
    const latencyScore = Math.max(0, 1 - networkMetrics.averageLatency / 1000);
    const throughputScore = Math.min(1, networkMetrics.throughput / 1000);
    const packetLossScore = Math.max(0, 1 - networkMetrics.packetLoss * 100);

    const networkScore = (latencyScore + throughputScore + packetLossScore) / 3;

    // Cluster performance component (0-1)
    const replicationScore = Math.max(
      0,
      1 - clusterMetrics.logReplicationLatency / 500,
    );
    const consensusScore = Math.max(0, 1 - clusterMetrics.consensusTime / 1000);
    const stabilityScore = Math.max(0, 1 - clusterMetrics.failureRate);

    const clusterScore =
      (replicationScore + consensusScore + stabilityScore) / 3;

    // Weighted combination
    return (
      (networkScore * this.config.networkQualityWeight +
        clusterScore *
          (this.config.throughputWeight + this.config.stabilityWeight)) /
      (this.config.networkQualityWeight +
        this.config.throughputWeight +
        this.config.stabilityWeight)
    );
  }

  /**
   * Determine if parameters should be adapted
   */
  private shouldAdaptParameters(
    networkMetrics: NetworkQualityMetrics,
    clusterMetrics: ClusterPerformanceMetrics,
    _performanceScore: number,
  ): boolean {
    // Check if performance is declining
    if (this.performanceHistory.length >= 3) {
      const recentScores = this.performanceHistory.slice(-3);
      const isDecline = recentScores.every(
        (score, i) => i === 0 || score < recentScores[i - 1]!,
      );

      if (isDecline) {
        return true;
      }
    }

    // Check threshold-based conditions
    const highLatency =
      networkMetrics.averageLatency > this.config.latencyThreshold;
    const lowThroughput =
      networkMetrics.throughput < this.config.throughputThreshold;
    const highElections = clusterMetrics.leaderElections > 5; // More than 5 elections recently

    return highLatency || lowThroughput || highElections;
  }

  /**
   * Calculate optimal parameters using adaptive algorithm
   */
  private async calculateOptimalParameters(
    networkMetrics: NetworkQualityMetrics,
    clusterMetrics: ClusterPerformanceMetrics,
    _performanceScore: number,
  ): Promise<AdaptiveParameters> {
    const newParameters = { ...this.currentParameters };

    // Adaptive election timeout based on network latency
    const latencyFactor = Math.max(1, networkMetrics.averageLatency / 100);
    const baseElectionTimeout =
      (this.config.minElectionTimeout + this.config.maxElectionTimeout) / 2;

    const adaptedMinTimeout = Math.max(
      this.config.minElectionTimeout,
      Math.min(
        this.config.maxElectionTimeout * 0.8,
        baseElectionTimeout * latencyFactor * 0.8,
      ),
    );

    const adaptedMaxTimeout = Math.max(
      adaptedMinTimeout * 1.5,
      Math.min(
        this.config.maxElectionTimeout,
        baseElectionTimeout * latencyFactor * 1.2,
      ),
    );

    newParameters.electionTimeout = [adaptedMinTimeout, adaptedMaxTimeout];

    // Adaptive heartbeat interval
    const heartbeatFactor = Math.max(
      0.5,
      Math.min(2, networkMetrics.averageLatency / 50),
    );
    newParameters.heartbeatInterval = Math.max(
      this.config.minHeartbeatInterval,
      Math.min(
        this.config.maxHeartbeatInterval,
        this.currentParameters.heartbeatInterval * heartbeatFactor,
      ),
    );

    // Adaptive batch size based on throughput
    const throughputFactor = Math.max(
      0.5,
      Math.min(2, networkMetrics.throughput / 500),
    );
    newParameters.batchSize = Math.max(
      1,
      Math.min(
        100,
        Math.round(this.currentParameters.batchSize * throughputFactor),
      ),
    );

    // Adaptive replication timeout
    newParameters.replicationTimeout = Math.max(
      100,
      Math.min(
        5000,
        networkMetrics.averageLatency * 3 +
          clusterMetrics.logReplicationLatency,
      ),
    );

    // Apply learning rate for gradual adaptation
    const lr = this.config.learningRate;

    newParameters.electionTimeout = [
      this.currentParameters.electionTimeout[0] * (1 - lr) +
        newParameters.electionTimeout[0] * lr,
      this.currentParameters.electionTimeout[1] * (1 - lr) +
        newParameters.electionTimeout[1] * lr,
    ];

    newParameters.heartbeatInterval =
      this.currentParameters.heartbeatInterval * (1 - lr) +
      newParameters.heartbeatInterval * lr;

    return newParameters;
  }

  /**
   * Apply new parameters to the system
   */
  private async applyParameters(
    newParameters: AdaptiveParameters,
  ): Promise<void> {
    const oldParameters = { ...this.currentParameters };
    this.currentParameters = { ...newParameters };

    this.logger.info("Adaptive parameters updated", {
      oldParameters,
      newParameters,
      reason: "performance_optimization",
    });

    // Emit parameter change event for other components to react
    this.metricsCollector.incrementCounter(
      "adaptive_consensus_adaptations_total",
      {
        cluster_id: "default",
        node_id: "default",
      },
    );
  }

  /**
   * Get adaptation statistics
   */
  public getAdaptationStats(): {
    totalAdaptations: number;
    averagePerformanceScore: number;
    // @ts-ignore
    parameterHistory: typeof this.historicalMetrics;
    currentEffectiveness: Map<string, number>;
  } {
    const averageScore =
      this.performanceHistory.length > 0
        ? this.performanceHistory.reduce((a, b) => a + b, 0) /
          this.performanceHistory.length
        : 0;

    return {
      totalAdaptations: this.historicalMetrics.length,
      averagePerformanceScore: averageScore,
      parameterHistory: [...this.historicalMetrics],
      currentEffectiveness: new Map(this.parameterEffectiveness),
    };
  }

  /**
   * Reset learning state (useful for testing)
   */
  public resetLearningState(): void {
    this.performanceHistory = [];
    this.historicalMetrics = [];
    this.parameterEffectiveness.clear();

    this.logger.info("Adaptive Consensus learning state reset");
  }
}

/**
 * Factory function to create adaptive consensus algorithm
 */
export function createAdaptiveConsensusAlgorithm(
  config: AdaptiveConsensusConfig,
  logger: RaftLogger,
  metricsCollector: RaftMetricsCollector,
  initialElectionTimeout: [number, number],
  initialHeartbeatInterval: number,
): AdaptiveConsensusAlgorithm {
  const initialParameters: AdaptiveParameters = {
    electionTimeout: initialElectionTimeout,
    heartbeatInterval: initialHeartbeatInterval,
    batchSize: 10,
    replicationTimeout: 1000,
  };

  return new AdaptiveConsensusAlgorithm(
    config,
    logger,
    metricsCollector,
    initialParameters,
  );
}
