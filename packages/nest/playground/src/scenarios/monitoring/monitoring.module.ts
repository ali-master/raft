import { Module } from "@nestjs/common";
import { MonitoringController } from "./monitoring.controller";
import { MonitoringService } from "./monitoring.service";
import { MonitoringEventHandler } from "./monitoring-event.handler";
import { MonitoringGateway } from "./monitoring.gateway";

@Module({
  controllers: [MonitoringController],
  providers: [MonitoringService, MonitoringEventHandler, MonitoringGateway],
  exports: [MonitoringService],
})
export class MonitoringModule {}
