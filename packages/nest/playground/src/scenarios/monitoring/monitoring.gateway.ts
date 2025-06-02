import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { MonitoringService } from "./monitoring.service";
import { EventBusService } from "@/shared/services/event-bus.service";
import { LoggerService } from "@/shared/services/logger.service";
import { UseFilters } from "@nestjs/common";
import { WsExceptionFilter } from "@/shared/filters/ws-exception.filter";

@WebSocketGateway({
  namespace: "/monitoring",
  cors: {
    origin: "*",
  },
})
@UseFilters(new WsExceptionFilter())
export class MonitoringGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private connectedClients = new Set<string>();
  private metricsInterval: NodeJS.Timeout;

  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly eventBus: EventBusService,
    private readonly logger: LoggerService,
  ) {
    this.startRealtimeUpdates();
    this.subscribeToEvents();
  }

  handleConnection(client: Socket) {
    this.logger.log(
      `Monitoring client connected: ${client.id}`,
      "MonitoringGateway",
    );
    this.connectedClients.add(client.id);

    // Send initial data
    this.sendInitialData(client);
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
    this.logger.log(
      `Monitoring client disconnected: ${client.id}`,
      "MonitoringGateway",
    );
  }

  @SubscribeMessage("request_dashboard")
  async handleRequestDashboard(client: Socket) {
    const data = await this.monitoringService.getDashboardData();
    client.emit("dashboard_data", data);
  }

  @SubscribeMessage("request_metrics")
  async handleRequestMetrics(client: Socket) {
    const [nodeHealth, appMetrics] = await Promise.all([
      this.monitoringService.getNodeHealth(),
      this.monitoringService.getApplicationMetrics(),
    ]);

    client.emit("metrics_update", { nodeHealth, appMetrics });
  }

  private async sendInitialData(client: Socket) {
    try {
      const dashboardData = await this.monitoringService.getDashboardData();
      client.emit("initial_data", dashboardData);
    } catch (error) {
      this.logger.error(
        "Failed to send initial data",
        error.stack,
        "MonitoringGateway",
      );
    }
  }

  private startRealtimeUpdates() {
    // Send metrics updates every 5 seconds
    this.metricsInterval = setInterval(async () => {
      if (this.connectedClients.size === 0) return;

      try {
        const [nodeHealth, clusterHealth, appMetrics] = await Promise.all([
          this.monitoringService.getNodeHealth(),
          this.monitoringService.getClusterHealth(),
          this.monitoringService.getApplicationMetrics(),
        ]);

        this.server.emit("realtime_update", {
          timestamp: Date.now(),
          nodeHealth,
          clusterHealth,
          appMetrics,
        });
      } catch (error) {
        this.logger.error(
          "Failed to send realtime updates",
          error.stack,
          "MonitoringGateway",
        );
      }
    }, 5000);
  }

  private subscribeToEvents() {
    // Forward all events to monitoring clients
    this.eventBus.getAllEvents().subscribe((event) => {
      if (this.connectedClients.size === 0) return;

      this.server.emit("event", {
        ...event,
        timestamp: Date.now(),
      });
    });

    // Forward alerts
    this.eventBus.on("monitoring.alert").subscribe((event) => {
      if (this.connectedClients.size === 0) return;

      this.server.emit("alert", event.data);
    });

    // Raft events
    this.eventBus.onPattern(/^raft\./).subscribe((event) => {
      if (this.connectedClients.size === 0) return;

      this.server.emit("raft_event", {
        type: event.type,
        nodeId: event.nodeId,
        timestamp: event.timestamp,
        data: event.data,
      });
    });
  }

  onModuleDestroy() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}
