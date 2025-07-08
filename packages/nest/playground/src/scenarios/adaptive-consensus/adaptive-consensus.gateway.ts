import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { OnEvent } from "@nestjs/event-emitter";
import { AdaptiveConsensusService } from "@usex/raft-nestjs";
import { AdaptiveConsensusPlaygroundService } from "./adaptive-consensus-playground.service";

/**
 * WebSocket Gateway for real-time adaptive consensus monitoring
 *
 * Provides real-time updates for adaptive consensus events and metrics
 */
@WebSocketGateway({
  namespace: "adaptive-consensus",
  cors: {
    origin: "*",
  },
})
export class AdaptiveConsensusGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AdaptiveConsensusGateway.name);

  constructor(
    private readonly adaptiveConsensusService: AdaptiveConsensusService,
    private readonly playgroundService: AdaptiveConsensusPlaygroundService,
  ) {}

  afterInit(_server: Server) {
    this.logger.log("Adaptive Consensus WebSocket Gateway initialized");
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);

    // Send initial state
    this.sendInitialState(client);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Send initial state to newly connected client
   */
  private async sendInitialState(client: Socket) {
    const status = {
      enabled: this.adaptiveConsensusService.isEnabled(),
      configuration: this.adaptiveConsensusService.getConfiguration(),
      performanceSummary: this.adaptiveConsensusService.getPerformanceSummary(),
      adaptationStats: this.adaptiveConsensusService.getAllAdaptationStats(),
      simulationStatus: this.playgroundService.getSimulationStatus(),
    };

    client.emit("initial-state", status);
  }

  /**
   * Handle subscription to specific node metrics
   */
  @SubscribeMessage("subscribe-node")
  async handleSubscribeNode(
    @MessageBody() nodeId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`node-${nodeId}`);

    const parameters =
      this.adaptiveConsensusService.getCurrentParameters(nodeId);
    const stats = this.adaptiveConsensusService.getAdaptationStats(nodeId);

    client.emit("node-state", {
      nodeId,
      parameters,
      stats,
    });
  }

  /**
   * Handle unsubscription from node metrics
   */
  @SubscribeMessage("unsubscribe-node")
  async handleUnsubscribeNode(
    @MessageBody() nodeId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`node-${nodeId}`);
  }

  /**
   * Get performance report
   */
  @SubscribeMessage("get-performance-report")
  async handleGetPerformanceReport(@ConnectedSocket() client: Socket) {
    const report = await this.playgroundService.generatePerformanceReport();
    client.emit("performance-report", report);
  }

  /**
   * Start simulation
   */
  @SubscribeMessage("start-simulation")
  async handleStartSimulation(
    @MessageBody() data: { scenarioId: string; customConfig?: any },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.playgroundService.startSimulation(
        data.scenarioId,
        data.customConfig,
      );
      client.emit("simulation-started", { success: true });
    } catch (error) {
      client.emit("simulation-error", {
        error: error.message || "Failed to start simulation",
      });
    }
  }

  /**
   * Stop simulation
   */
  @SubscribeMessage("stop-simulation")
  async handleStopSimulation(@ConnectedSocket() client: Socket) {
    const results = await this.playgroundService.stopSimulation();
    client.emit("simulation-stopped", { results });
  }

  /**
   * Force adaptation
   */
  @SubscribeMessage("force-adaptation")
  async handleForceAdaptation(
    @MessageBody() nodeId: string | undefined,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      if (nodeId) {
        await this.adaptiveConsensusService.forceAdaptation(nodeId);
      } else {
        await this.adaptiveConsensusService.forceAdaptationAll();
      }
      client.emit("adaptation-forced", { success: true, nodeId });
    } catch (error) {
      client.emit("adaptation-error", {
        error: error.message || "Failed to force adaptation",
      });
    }
  }

  // Event handlers for broadcasting updates

  @OnEvent("adaptive.parameters.changed")
  handleParametersChanged(event: any) {
    this.server.to(`node-${event.nodeId}`).emit("parameters-changed", event);
    this.server.emit("cluster-update", {
      type: "parameters-changed",
      nodeId: event.nodeId,
      timestamp: event.timestamp,
    });
  }

  @OnEvent("adaptive.cycle.completed")
  handleCycleCompleted(event: any) {
    this.server.to(`node-${event.nodeId}`).emit("cycle-completed", event);

    // Broadcast performance update
    this.server.emit("performance-update", {
      nodeId: event.nodeId,
      performanceScore: event.performanceScore,
      networkMetrics: event.networkMetrics,
      clusterMetrics: event.clusterMetrics,
      timestamp: event.timestamp,
    });
  }

  @OnEvent("adaptive.performance.degraded")
  handlePerformanceDegraded(event: any) {
    this.server.emit("performance-alert", event);
  }

  @OnEvent("simulation.phase.started")
  handlePhaseStarted(event: any) {
    this.server.emit("simulation-phase-update", event);
  }

  @OnEvent("simulation.completed")
  handleSimulationCompleted(event: any) {
    this.server.emit("simulation-completed", event);
  }

  @OnEvent("network.conditions.changed")
  handleNetworkConditionsChanged(event: any) {
    this.server.emit("network-conditions-update", event);
  }

  @OnEvent("load.pattern.changed")
  handleLoadPatternChanged(event: any) {
    this.server.emit("load-pattern-update", event);
  }

  /**
   * Periodic broadcast of cluster status
   */
  @OnEvent("cluster.status.update")
  handleClusterStatusUpdate() {
    const summary = this.adaptiveConsensusService.getPerformanceSummary();
    this.server.emit("cluster-status", {
      summary,
      timestamp: new Date(),
    });
  }
}
