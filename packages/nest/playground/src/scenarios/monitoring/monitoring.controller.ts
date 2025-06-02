import { Controller, Get, Query, Header } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { MonitoringService } from "./monitoring.service";

@ApiTags("monitoring")
@Controller("monitoring")
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get("health")
  @ApiOperation({ summary: "Get node health status" })
  @ApiResponse({ status: 200, description: "Node health information" })
  async getNodeHealth() {
    return this.monitoringService.getNodeHealth();
  }

  @Get("cluster/health")
  @ApiOperation({ summary: "Get cluster health status" })
  @ApiResponse({ status: 200, description: "Cluster health information" })
  async getClusterHealth() {
    return this.monitoringService.getClusterHealth();
  }

  @Get("raft/metrics")
  @ApiOperation({ summary: "Get Raft consensus metrics" })
  @ApiResponse({ status: 200, description: "Raft metrics" })
  async getRaftMetrics() {
    return this.monitoringService.getRaftMetrics();
  }

  @Get("app/metrics")
  @ApiOperation({ summary: "Get application metrics" })
  @ApiResponse({ status: 200, description: "Application metrics" })
  async getApplicationMetrics() {
    return this.monitoringService.getApplicationMetrics();
  }

  @Get("metrics")
  @Header("Content-Type", "text/plain")
  @ApiOperation({ summary: "Get Prometheus metrics" })
  @ApiResponse({
    status: 200,
    description: "Prometheus formatted metrics",
    content: {
      "text/plain": {
        schema: { type: "string" },
      },
    },
  })
  async getPrometheusMetrics() {
    return this.monitoringService.getPrometheusMetrics();
  }

  @Get("history/metrics")
  @ApiOperation({ summary: "Get metrics history" })
  @ApiQuery({
    name: "minutes",
    required: false,
    type: Number,
    description: "History duration in minutes",
  })
  @ApiResponse({ status: 200, description: "Metrics history" })
  async getMetricsHistory(@Query("minutes") minutes?: string) {
    const duration = minutes ? parseInt(minutes, 10) : 60;
    return this.monitoringService.getMetricsHistory(duration);
  }

  @Get("history/events")
  @ApiOperation({ summary: "Get event history" })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Maximum number of events",
  })
  @ApiResponse({ status: 200, description: "Event history" })
  async getEventHistory(@Query("limit") limit?: string) {
    const maxEvents = limit ? parseInt(limit, 10) : 100;
    return this.monitoringService.getEventHistory(maxEvents);
  }

  @Get("history/alerts")
  @ApiOperation({ summary: "Get alert history" })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Maximum number of alerts",
  })
  @ApiResponse({ status: 200, description: "Alert history" })
  async getAlertHistory(@Query("limit") limit?: string) {
    const maxAlerts = limit ? parseInt(limit, 10) : 50;
    return this.monitoringService.getAlertHistory(maxAlerts);
  }

  @Get("dashboard")
  @ApiOperation({ summary: "Get complete dashboard data" })
  @ApiResponse({
    status: 200,
    description: "Dashboard data including all metrics and status",
  })
  async getDashboardData() {
    return this.monitoringService.getDashboardData();
  }
}
