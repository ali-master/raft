import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { AdaptiveConsensusEvents } from "@usex/raft-nestjs";

/**
 * Event handler for adaptive consensus events
 *
 * Logs and processes events emitted by the adaptive consensus system
 */
@Injectable()
export class AdaptiveConsensusEventHandler {
  private readonly logger = new Logger(AdaptiveConsensusEventHandler.name);

  @OnEvent("adaptive.parameters.changed")
  handleParametersChanged(
    event: AdaptiveConsensusEvents["adaptive.parameters.changed"],
  ) {
    this.logger.log("Adaptive parameters changed", {
      nodeId: event.nodeId,
      reason: event.reason,
      oldElectionTimeout: event.oldParameters.electionTimeout,
      newElectionTimeout: event.newParameters.electionTimeout,
      oldHeartbeat: event.oldParameters.heartbeatInterval,
      newHeartbeat: event.newParameters.heartbeatInterval,
    });
  }

  @OnEvent("adaptive.cycle.completed")
  handleCycleCompleted(
    event: AdaptiveConsensusEvents["adaptive.cycle.completed"],
  ) {
    this.logger.debug("Adaptive cycle completed", {
      nodeId: event.nodeId,
      performanceScore: event.performanceScore.toFixed(3),
      adapted: event.adapted,
      networkLatency: event.networkMetrics.averageLatency,
      throughput: event.networkMetrics.throughput,
    });
  }

  @OnEvent("adaptive.performance.degraded")
  handlePerformanceDegraded(
    event: AdaptiveConsensusEvents["adaptive.performance.degraded"],
  ) {
    this.logger.warn("Performance degradation detected", {
      nodeId: event.nodeId,
      currentScore: event.currentScore.toFixed(3),
      previousScore: event.previousScore.toFixed(3),
      threshold: event.threshold,
    });
  }

  @OnEvent("adaptive.learning.reset")
  handleLearningReset(
    event: AdaptiveConsensusEvents["adaptive.learning.reset"],
  ) {
    this.logger.log("Learning state reset", {
      nodeId: event.nodeId,
      reason: event.reason,
    });
  }

  @OnEvent("adaptive.configuration.updated")
  handleConfigurationUpdated(event: any) {
    this.logger.log("Adaptive consensus configuration updated", {
      changes: Object.keys(event.newConfig).filter(
        (key) => event.oldConfig[key] !== event.newConfig[key],
      ),
    });
  }

  @OnEvent("adaptive.forced")
  handleForcedAdaptation(event: any) {
    this.logger.log("Forced adaptation triggered", {
      nodeId: event.nodeId,
    });
  }

  @OnEvent("simulation.started")
  handleSimulationStarted(event: any) {
    this.logger.log("Simulation started", {
      scenario: event.scenario.name,
      duration: `${event.scenario.duration}s`,
      phases: event.scenario.phases.length,
    });
  }

  @OnEvent("simulation.phase.started")
  handlePhaseStarted(event: any) {
    this.logger.log("Simulation phase started", {
      phase: event.phaseName,
      index: event.phaseIndex,
    });
  }

  @OnEvent("simulation.completed")
  handleSimulationCompleted(event: any) {
    this.logger.log("Simulation completed", {
      scenario: event.results.scenarioName,
      totalAdaptations: event.results.summary.totalAdaptations,
      performanceImprovement:
        event.results.summary.performanceImprovement.toFixed(3),
    });
  }

  @OnEvent("network.conditions.changed")
  handleNetworkConditionsChanged(event: any) {
    this.logger.debug("Network conditions changed", {
      latency: `${event.conditions.latency.min}-${event.conditions.latency.max}ms`,
      packetLoss: `${event.conditions.packetLoss * 100}%`,
    });
  }

  @OnEvent("load.pattern.changed")
  handleLoadPatternChanged(event: any) {
    this.logger.debug("Load pattern changed", {
      requestRate: `${event.pattern.requestRate} req/s`,
      burstProbability: `${event.pattern.burstProbability * 100}%`,
    });
  }
}
