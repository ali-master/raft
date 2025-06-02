import { Global, Module } from "@nestjs/common";
import { LoggerService } from "./services/logger.service";
import { MetricsService } from "./services/metrics.service";
import { EventBusService } from "./services/event-bus.service";
import { UtilsService } from "./services/utils.service";

@Global()
@Module({
  providers: [LoggerService, MetricsService, EventBusService, UtilsService],
  exports: [LoggerService, MetricsService, EventBusService, UtilsService],
})
export class SharedModule {}
