import { Module } from "@nestjs/common";
import { TaskQueueController } from "./task-queue.controller";
import { TaskQueueService } from "./task-queue.service";
import { TaskEventHandler } from "./task-event.handler";

@Module({
  controllers: [TaskQueueController],
  providers: [TaskQueueService, TaskEventHandler],
  exports: [TaskQueueService],
})
export class TaskQueueModule {}
