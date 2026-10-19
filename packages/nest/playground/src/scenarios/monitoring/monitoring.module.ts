import { Module } from "@nestjs/common";
import { MonitoringController } from "./monitoring.controller";
import { MonitoringService } from "./monitoring.service";
import { MonitoringEventHandler } from "./monitoring-event.handler";
import { MonitoringGateway } from "./monitoring.gateway";
import { DistributedCacheModule } from "../distributed-cache/distributed-cache.module";
import { TaskQueueModule } from "../task-queue/task-queue.module";
import { LockServiceModule } from "../lock-service/lock-service.module";
import { GameServerModule } from "../game-server/game-server.module";

@Module({
  imports: [DistributedCacheModule, TaskQueueModule, LockServiceModule, GameServerModule],
  controllers: [MonitoringController],
  providers: [MonitoringService, MonitoringEventHandler, MonitoringGateway],
  exports: [MonitoringService],
})
export class MonitoringModule {}
