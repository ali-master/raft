import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller";
import { KVStoreHealthIndicator } from "./indicators/kv-store.health";
import { RaftHealthIndicator } from "./indicators/raft.health";
import { KVStoreModule } from "../kv-store/kv-store.module";
import { RaftModule } from "../raft/raft.module";

@Module({
  imports: [TerminusModule, KVStoreModule, RaftModule],
  controllers: [HealthController],
  providers: [KVStoreHealthIndicator, RaftHealthIndicator],
})
export class HealthModule {}
