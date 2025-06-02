import { Module } from "@nestjs/common";
import { LockServiceController } from "./lock-service.controller";
import { LockService } from "./lock-service.service";
import { LockEventHandler } from "./lock-event.handler";

@Module({
  controllers: [LockServiceController],
  providers: [LockService, LockEventHandler],
  exports: [LockService],
})
export class LockServiceModule {}
