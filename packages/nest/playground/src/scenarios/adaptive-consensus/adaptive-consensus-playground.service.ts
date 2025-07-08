import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AdaptiveConsensusService } from "@usex/raft-nestjs";
import { NetworkSimulatorService } from "./network-simulator.service";
import { LoadGeneratorService } from "./load-generator.service";

/**
 * Simulation scenario configuration
 */
export interface SimulationScenario {
  name: string;
  description: string;
  duration: number; // seconds
  phases: Array<{
    name: string;
    startTime: number; // seconds from start
    duration: number; // seconds
    networkConditions: {
      latency: {
        min: number;
        max: number;
        distribution: "uniform" | "gaussian";
      };
      packetLoss: number;
      bandwidth: number; // Mbps
      jitter: number;
    };
    loadConditions: {
      requestRate: number; // requests per second
      burstProbability: number; // 0-1
      burstMultiplier: number;
    };
    adaptiveConfig?: {
      learningRate?: number;
      adaptationInterval?: number;
    };
  }>;
}

/**
 * Simulation results tracking
 */
export interface SimulationResults {
  scenarioName: string;
  startTime: Date;
  endTime?: Date;
  phases: Array<{
    name: string;
    startTime: Date;
    endTime?: Date;
    metrics: {
      averageLatency: number;
      throughput: number;
      adaptationCount: number;
      performanceScore: number;
      parameterChanges: Array<{
        timestamp: Date;
        parameter: string;
        oldValue: any;
        newValue: any;
      }>;
    };
  }>;
  summary: {
    totalAdaptations: number;
    averagePerformanceScore: number;
    performanceImprovement: number;
    adaptationEffectiveness: number;
  };
}

/**
 * Predefined simulation scenarios
 */
const SIMULATION_SCENARIOS: Record<string, SimulationScenario> = {
  "network-degradation": {
    name: "Network Degradation",
    description: "Simulates gradual network degradation and recovery",
    duration: 300, // 5 minutes
    phases: [
      {
        name: "Baseline",
        startTime: 0,
        duration: 60,
        networkConditions: {
          latency: { min: 10, max: 30, distribution: "uniform" },
          packetLoss: 0.001,
          bandwidth: 1000,
          jitter: 2,
        },
        loadConditions: {
          requestRate: 100,
          burstProbability: 0.1,
          burstMultiplier: 2,
        },
      },
      {
        name: "Degradation",
        startTime: 60,
        duration: 120,
        networkConditions: {
          latency: { min: 100, max: 300, distribution: "gaussian" },
          packetLoss: 0.05,
          bandwidth: 100,
          jitter: 50,
        },
        loadConditions: {
          requestRate: 100,
          burstProbability: 0.3,
          burstMultiplier: 3,
        },
      },
      {
        name: "Recovery",
        startTime: 180,
        duration: 120,
        networkConditions: {
          latency: { min: 20, max: 50, distribution: "uniform" },
          packetLoss: 0.01,
          bandwidth: 500,
          jitter: 5,
        },
        loadConditions: {
          requestRate: 100,
          burstProbability: 0.1,
          burstMultiplier: 2,
        },
      },
    ],
  },
  "load-spike": {
    name: "Load Spike",
    description: "Simulates sudden load spikes and adaptive response",
    duration: 240, // 4 minutes
    phases: [
      {
        name: "Normal Load",
        startTime: 0,
        duration: 60,
        networkConditions: {
          latency: { min: 20, max: 40, distribution: "uniform" },
          packetLoss: 0.001,
          bandwidth: 1000,
          jitter: 3,
        },
        loadConditions: {
          requestRate: 50,
          burstProbability: 0.05,
          burstMultiplier: 1.5,
        },
      },
      {
        name: "Spike 1",
        startTime: 60,
        duration: 30,
        networkConditions: {
          latency: { min: 20, max: 40, distribution: "uniform" },
          packetLoss: 0.001,
          bandwidth: 1000,
          jitter: 3,
        },
        loadConditions: {
          requestRate: 500,
          burstProbability: 0.8,
          burstMultiplier: 5,
        },
      },
      {
        name: "Recovery 1",
        startTime: 90,
        duration: 60,
        networkConditions: {
          latency: { min: 20, max: 40, distribution: "uniform" },
          packetLoss: 0.001,
          bandwidth: 1000,
          jitter: 3,
        },
        loadConditions: {
          requestRate: 50,
          burstProbability: 0.05,
          burstMultiplier: 1.5,
        },
      },
      {
        name: "Spike 2",
        startTime: 150,
        duration: 45,
        networkConditions: {
          latency: { min: 20, max: 40, distribution: "uniform" },
          packetLoss: 0.001,
          bandwidth: 1000,
          jitter: 3,
        },
        loadConditions: {
          requestRate: 800,
          burstProbability: 0.9,
          burstMultiplier: 8,
        },
      },
      {
        name: "Final Recovery",
        startTime: 195,
        duration: 45,
        networkConditions: {
          latency: { min: 20, max: 40, distribution: "uniform" },
          packetLoss: 0.001,
          bandwidth: 1000,
          jitter: 3,
        },
        loadConditions: {
          requestRate: 50,
          burstProbability: 0.05,
          burstMultiplier: 1.5,
        },
      },
    ],
  },
  "learning-effectiveness": {
    name: "Learning Effectiveness",
    description: "Tests adaptive learning over multiple cycles",
    duration: 600, // 10 minutes
    phases: [
      {
        name: "Cycle 1",
        startTime: 0,
        duration: 120,
        networkConditions: {
          latency: { min: 50, max: 150, distribution: "gaussian" },
          packetLoss: 0.02,
          bandwidth: 200,
          jitter: 20,
        },
        loadConditions: {
          requestRate: 200,
          burstProbability: 0.2,
          burstMultiplier: 3,
        },
        adaptiveConfig: {
          learningRate: 0.1,
          adaptationInterval: 15000,
        },
      },
      {
        name: "Cycle 2",
        startTime: 120,
        duration: 120,
        networkConditions: {
          latency: { min: 50, max: 150, distribution: "gaussian" },
          packetLoss: 0.02,
          bandwidth: 200,
          jitter: 20,
        },
        loadConditions: {
          requestRate: 200,
          burstProbability: 0.2,
          burstMultiplier: 3,
        },
        adaptiveConfig: {
          learningRate: 0.2,
          adaptationInterval: 10000,
        },
      },
      {
        name: "Cycle 3",
        startTime: 240,
        duration: 120,
        networkConditions: {
          latency: { min: 50, max: 150, distribution: "gaussian" },
          packetLoss: 0.02,
          bandwidth: 200,
          jitter: 20,
        },
        loadConditions: {
          requestRate: 200,
          burstProbability: 0.2,
          burstMultiplier: 3,
        },
        adaptiveConfig: {
          learningRate: 0.3,
          adaptationInterval: 5000,
        },
      },
      {
        name: "Cycle 4",
        startTime: 360,
        duration: 120,
        networkConditions: {
          latency: { min: 50, max: 150, distribution: "gaussian" },
          packetLoss: 0.02,
          bandwidth: 200,
          jitter: 20,
        },
        loadConditions: {
          requestRate: 200,
          burstProbability: 0.2,
          burstMultiplier: 3,
        },
        adaptiveConfig: {
          learningRate: 0.15,
          adaptationInterval: 8000,
        },
      },
      {
        name: "Final Evaluation",
        startTime: 480,
        duration: 120,
        networkConditions: {
          latency: { min: 50, max: 150, distribution: "gaussian" },
          packetLoss: 0.02,
          bandwidth: 200,
          jitter: 20,
        },
        loadConditions: {
          requestRate: 200,
          burstProbability: 0.2,
          burstMultiplier: 3,
        },
        adaptiveConfig: {
          learningRate: 0.1,
          adaptationInterval: 10000,
        },
      },
    ],
  },
};

/**
 * Playground service for testing and demonstrating adaptive consensus algorithms
 */
@Injectable()
export class AdaptiveConsensusPlaygroundService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AdaptiveConsensusPlaygroundService.name);
  private activeSimulation?: {
    scenario: SimulationScenario;
    results: SimulationResults;
    startTime: Date;
    currentPhaseIndex: number;
    phaseTimer?: NodeJS.Timeout;
  };

  constructor(
    private readonly adaptiveConsensusService: AdaptiveConsensusService,
    private readonly networkSimulator: NetworkSimulatorService,
    private readonly loadGenerator: LoadGeneratorService,
    private readonly _configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log("Adaptive Consensus Playground Service initialized");
  }

  async onModuleDestroy(): Promise<void> {
    if (this.activeSimulation) {
      await this.stopSimulation();
    }
    this.logger.log("Adaptive Consensus Playground Service destroyed");
  }

  /**
   * Get available simulation scenarios
   */
  getAvailableScenarios(): Record<string, Omit<SimulationScenario, "phases">> {
    const scenarios: Record<string, Omit<SimulationScenario, "phases">> = {};
    Object.entries(SIMULATION_SCENARIOS).forEach(([key, scenario]) => {
      scenarios[key] = {
        name: scenario.name,
        description: scenario.description,
        duration: scenario.duration,
      };
    });
    return scenarios;
  }

  /**
   * Get detailed scenario information
   */
  getScenario(scenarioId: string): SimulationScenario | null {
    return SIMULATION_SCENARIOS[scenarioId] || null;
  }

  /**
   * Start a simulation scenario
   */
  async startSimulation(
    scenarioId: string,
    customConfig?: Partial<SimulationScenario>,
  ): Promise<void> {
    if (this.activeSimulation) {
      throw new Error("Another simulation is already running");
    }

    const scenario = SIMULATION_SCENARIOS[scenarioId];
    if (!scenario) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }

    // Apply custom configuration if provided
    const finalScenario = customConfig
      ? { ...scenario, ...customConfig }
      : scenario;

    this.logger.log(`Starting simulation: ${finalScenario.name}`);

    // Initialize simulation state
    this.activeSimulation = {
      scenario: finalScenario,
      results: {
        scenarioName: finalScenario.name,
        startTime: new Date(),
        phases: [],
        summary: {
          totalAdaptations: 0,
          averagePerformanceScore: 0,
          performanceImprovement: 0,
          adaptationEffectiveness: 0,
        },
      },
      startTime: new Date(),
      currentPhaseIndex: 0,
    };

    // Start the first phase
    await this.startPhase(0);

    // Emit simulation started event
    this.eventEmitter.emit("simulation.started", {
      scenarioId,
      scenario: finalScenario,
      timestamp: new Date(),
    });
  }

  /**
   * Stop the current simulation
   */
  async stopSimulation(): Promise<SimulationResults | null> {
    if (!this.activeSimulation) {
      return null;
    }

    this.logger.log("Stopping simulation");

    // Clear phase timer
    if (this.activeSimulation.phaseTimer) {
      clearTimeout(this.activeSimulation.phaseTimer);
    }

    // Stop simulators
    await this.networkSimulator.stop();
    await this.loadGenerator.stop();

    // Finalize results
    const results = { ...this.activeSimulation.results };
    results.endTime = new Date();

    // Calculate summary metrics
    results.summary = this.calculateSummaryMetrics(results);

    // Clean up
    const finalResults = results;
    this.activeSimulation = undefined;

    // Emit simulation completed event
    this.eventEmitter.emit("simulation.completed", {
      results: finalResults,
      timestamp: new Date(),
    });

    this.logger.log("Simulation stopped", {
      scenario: finalResults.scenarioName,
      duration:
        finalResults.endTime!.getTime() - finalResults.startTime.getTime(),
      totalAdaptations: finalResults.summary.totalAdaptations,
    });

    return finalResults;
  }

  /**
   * Get current simulation status
   */
  getSimulationStatus(): {
    running: boolean;
    scenario?: string;
    currentPhase?: string;
    progress?: number;
    elapsedTime?: number;
    remainingTime?: number;
  } {
    if (!this.activeSimulation) {
      return { running: false };
    }

    const elapsed =
      (Date.now() - this.activeSimulation.startTime.getTime()) / 1000;
    const totalDuration = this.activeSimulation.scenario.duration;
    const progress = Math.min(elapsed / totalDuration, 1);
    const remainingTime = Math.max(totalDuration - elapsed, 0);

    const currentPhase =
      this.activeSimulation.scenario.phases[
        this.activeSimulation.currentPhaseIndex
      ];

    return {
      running: true,
      scenario: this.activeSimulation.scenario.name,
      currentPhase: currentPhase?.name,
      progress,
      elapsedTime: elapsed,
      remainingTime,
    };
  }

  /**
   * Get current simulation results (live)
   */
  getCurrentResults(): SimulationResults | null {
    return this.activeSimulation?.results || null;
  }

  /**
   * Run a quick demonstration
   */
  async runDemonstration(): Promise<void> {
    this.logger.log("Running adaptive consensus demonstration");

    // Enable adaptive consensus if not already enabled
    if (!this.adaptiveConsensusService.isEnabled()) {
      await this.adaptiveConsensusService.updateConfiguration({
        enabled: true,
      });
    }

    // Start network degradation scenario
    await this.startSimulation("network-degradation");

    // The simulation will run automatically
    this.logger.log("Demonstration started - network degradation scenario");
  }

  /**
   * Generate performance report
   */
  async generatePerformanceReport(): Promise<{
    timestamp: Date;
    adaptiveConsensusEnabled: boolean;
    clusterStatus: any;
    nodeMetrics: Record<string, any>;
    recommendations: string[];
  }> {
    const timestamp = new Date();
    const adaptiveConsensusEnabled = this.adaptiveConsensusService.isEnabled();
    const clusterStatus = this.adaptiveConsensusService.getPerformanceSummary();
    const nodeMetrics = this.adaptiveConsensusService.getAllAdaptationStats();

    // Generate recommendations based on current performance
    const recommendations: string[] = [];

    if (!adaptiveConsensusEnabled) {
      recommendations.push(
        "Consider enabling adaptive consensus for automatic performance optimization",
      );
    }

    if (clusterStatus.averagePerformanceScore < 0.7) {
      recommendations.push(
        "Cluster performance is below optimal - check network conditions",
      );
    }

    if (clusterStatus.nodesWithDegradedPerformance > 0) {
      recommendations.push(
        `${clusterStatus.nodesWithDegradedPerformance} nodes showing performance degradation`,
      );
    }

    if (clusterStatus.adaptationFrequency > 10) {
      recommendations.push(
        "High adaptation frequency detected - consider adjusting thresholds",
      );
    }

    if (clusterStatus.adaptationFrequency < 0.5 && adaptiveConsensusEnabled) {
      recommendations.push(
        "Low adaptation frequency - parameters may be too conservative",
      );
    }

    return {
      timestamp,
      adaptiveConsensusEnabled,
      clusterStatus,
      nodeMetrics,
      recommendations,
    };
  }

  /**
   * Start a specific phase of the simulation
   */
  private async startPhase(phaseIndex: number): Promise<void> {
    if (!this.activeSimulation) return;

    const phase = this.activeSimulation.scenario.phases[phaseIndex];
    if (!phase) {
      // Simulation complete
      await this.stopSimulation();
      return;
    }

    this.logger.log(`Starting phase: ${phase.name}`);

    // Update adaptive consensus configuration if specified
    if (phase.adaptiveConfig) {
      await this.adaptiveConsensusService.updateConfiguration(
        phase.adaptiveConfig,
      );
    }

    // Configure network simulator
    await this.networkSimulator.setConditions(phase.networkConditions);

    // Configure load generator
    await this.loadGenerator.setLoadPattern(phase.loadConditions);

    // Initialize phase results tracking
    this.activeSimulation.results.phases.push({
      name: phase.name,
      startTime: new Date(),
      metrics: {
        averageLatency: 0,
        throughput: 0,
        adaptationCount: 0,
        performanceScore: 0,
        parameterChanges: [],
      },
    });

    this.activeSimulation.currentPhaseIndex = phaseIndex;

    // Schedule next phase
    this.activeSimulation.phaseTimer = setTimeout(() => {
      this.startPhase(phaseIndex + 1);
    }, phase.duration * 1000);

    // Emit phase started event
    this.eventEmitter.emit("simulation.phase.started", {
      phaseName: phase.name,
      phaseIndex,
      timestamp: new Date(),
    });
  }

  /**
   * Calculate summary metrics for simulation results
   */
  private calculateSummaryMetrics(
    results: SimulationResults,
  ): SimulationResults["summary"] {
    const totalAdaptations = results.phases.reduce(
      (sum, phase) => sum + phase.metrics.adaptationCount,
      0,
    );

    const averagePerformanceScore =
      results.phases.length > 0
        ? results.phases.reduce(
            (sum, phase) => sum + phase.metrics.performanceScore,
            0,
          ) / results.phases.length
        : 0;

    // Simple performance improvement calculation (would be more sophisticated in real implementation)
    const firstPhaseScore = results.phases[0]?.metrics.performanceScore || 0;
    const lastPhaseScore =
      results.phases[results.phases.length - 1]?.metrics.performanceScore || 0;
    const performanceImprovement = lastPhaseScore - firstPhaseScore;

    // Adaptation effectiveness (simplified calculation)
    const adaptationEffectiveness =
      totalAdaptations > 0 ? performanceImprovement / totalAdaptations : 0;

    return {
      totalAdaptations,
      averagePerformanceScore,
      performanceImprovement,
      adaptationEffectiveness,
    };
  }

  /**
   * Handle adaptive consensus events during simulation
   */
  @OnEvent("adaptive.parameters.changed")
  private _handleParameterChange(event: any): void {
    if (!this.activeSimulation) return;

    const currentPhase =
      this.activeSimulation.results.phases[
        this.activeSimulation.currentPhaseIndex
      ];
    if (currentPhase) {
      currentPhase.metrics.adaptationCount++;
      currentPhase.metrics.parameterChanges.push({
        timestamp: new Date(),
        parameter: "mixed", // Would track specific parameters in real implementation
        oldValue: event.oldParameters,
        newValue: event.newParameters,
      });
    }
  }

  /**
   * Handle performance monitoring events
   */
  @OnEvent("adaptive.cycle.completed")
  private _handleCycleCompleted(event: any): void {
    if (!this.activeSimulation) return;

    const currentPhase =
      this.activeSimulation.results.phases[
        this.activeSimulation.currentPhaseIndex
      ];
    if (currentPhase) {
      // Update phase metrics with latest performance data
      currentPhase.metrics.performanceScore = event.performanceScore;
      // Would update other metrics based on event data
    }
  }

  /**
   * Scheduled health check for long-running simulations
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  private async _performHealthCheck(): Promise<void> {
    if (!this.activeSimulation) return;

    const elapsed =
      (Date.now() - this.activeSimulation.startTime.getTime()) / 1000;
    const totalDuration = this.activeSimulation.scenario.duration;

    // Check if simulation should have completed
    if (elapsed > totalDuration + 60) {
      // 1 minute grace period
      this.logger.warn("Simulation appears to be stuck - forcing stop");
      await this.stopSimulation();
    }
  }
}
