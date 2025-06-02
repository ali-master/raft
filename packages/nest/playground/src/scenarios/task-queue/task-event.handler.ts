import { Injectable } from "@nestjs/common";
import {
  OnRaftLogReplicated,
  OnRaftLogCommitted,
  OnRaftStateChange,
} from "@usex/raft-nestjs";
import { TaskQueueService, TaskOperation } from "./task-queue.service";
import { LoggerService } from "@/shared/services/logger.service";
import { MetricsService } from "@/shared/services/metrics.service";

@Injectable()
export class TaskEventHandler {
  constructor(
    private readonly taskQueueService: TaskQueueService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  @OnRaftLogReplicated()
  handleLogReplicated(entry: any) {
    if (this.isTaskOperation(entry.data)) {
      this.logger.debug(
        `Applying task operation: ${entry.data.type} ${entry.data.taskId || "new"}`,
        "TaskEventHandler",
      );

      const startTime = Date.now();
      this.taskQueueService.applyOperation(entry.data);

      this.metrics.observeHistogram(
        "task_operation_apply_duration_seconds",
        (Date.now() - startTime) / 1000,
        {
          node: process.env.NODE_ID || "unknown",
          type: entry.data.type,
        },
      );
    }
  }

  @OnRaftLogCommitted()
  handleLogCommitted(entry: any) {
    if (this.isTaskOperation(entry.data)) {
      this.logger.log(
        `Task operation committed: ${entry.data.type} ${entry.data.taskId || "new"}`,
        "TaskEventHandler",
      );

      this.metrics.incrementCounter("task_operations_committed_total", {
        node: process.env.NODE_ID || "unknown",
        type: entry.data.type,
      });
    }
  }

  @OnRaftStateChange()
  handleStateChange(data: { from: string; to: string }) {
    this.logger.warn(
      `Task queue node state changed from ${data.from} to ${data.to}`,
      "TaskEventHandler",
    );

    if (data.to === "leader") {
      this.taskQueueService.getQueueStats().then((stats) => {
        this.logger.log(
          `New leader task queue stats: ${stats.totalTasks} total tasks`,
          "TaskEventHandler",
        );

        Object.entries(stats.tasksByStatus).forEach(([status, count]) => {
          this.logger.log(`  ${status}: ${count}`, "TaskEventHandler");
        });
      });
    }
  }

  private isTaskOperation(data: any): data is TaskOperation {
    return (
      data &&
      typeof data.type === "string" &&
      [
        "CREATE",
        "ASSIGN",
        "UPDATE_STATUS",
        "COMPLETE",
        "FAIL",
        "CANCEL",
        "CLEANUP",
      ].includes(data.type) &&
      typeof data.timestamp === "number"
    );
  }
}
