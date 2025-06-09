import { Get, Controller } from "@nestjs/common";
import type { HealthCheckService} from "@nestjs/terminus";
import { HealthCheck } from "@nestjs/terminus";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import type { KVStoreHealthIndicator } from "./indicators/kv-store.health";
import type { RaftHealthIndicator } from "./indicators/raft.health";

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
  async check() {
    return this.health.check([
      async () => this.kvStore.isHealthy("kv-store"),
      async () => this.raft.isHealthy("raft"),
    ]);
  }

  @Get("liveness")
  @HealthCheck()
  @ApiOperation({ summary: "Check system liveness" })
  async liveness() {
    return { status: "ok" };
  }

  @Get("readiness")
  @HealthCheck()
  @ApiOperation({ summary: "Check system readiness" })
  async readiness() {
    return this.health.check([
      async () => this.kvStore.isHealthy("kv-store"),
      async () => this.raft.isHealthy("raft"),
    ]);
  }
}
