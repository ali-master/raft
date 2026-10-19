import { Get, Controller } from "@nestjs/common";
import { HealthCheckService, HealthCheck  } from "@nestjs/terminus";
import type { HealthCheckResult } from "@nestjs/terminus";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { KVStoreHealthIndicator } from "./indicators/kv-store.health";
import { RaftHealthIndicator } from "./indicators/raft.health";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private kvStore: KVStoreHealthIndicator,
    private raft: RaftHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: "Check system health" })
  async check(): Promise<HealthCheckResult> {
    return this.health.check([
      async () => this.kvStore.isHealthy("kv-store"),
      async () => this.raft.isHealthy("raft"),
    ]);
  }

  @Get("liveness")
  @HealthCheck()
  @ApiOperation({ summary: "Check system liveness" })
  async liveness(): Promise<{ status: string }> {
    return { status: "ok" };
  }

  @Get("readiness")
  @HealthCheck()
  @ApiOperation({ summary: "Check system readiness" })
  async readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      async () => this.kvStore.isHealthy("kv-store"),
      async () => this.raft.isHealthy("raft"),
    ]);
  }
}
