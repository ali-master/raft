import { Injectable } from "@nestjs/common";
import {
  OnRaftLogReplicated,
  OnRaftLogCommitted,
  OnRaftStateChange,
  OnRaftLeaderElected,
} from "@usex/raft-nestjs";
import { LockService, LockOperation } from "./lock-service.service";
import { LoggerService } from "@/shared/services/logger.service";
import { MetricsService } from "@/shared/services/metrics.service";

@Injectable()
export class LockEventHandler {
  constructor(
    private readonly lockService: LockService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  @OnRaftLogReplicated()
  handleLogReplicated(entry: any) {
    if (this.isLockOperation(entry.data)) {
      this.logger.debug(
        `Applying lock operation: ${entry.data.type} ${entry.data.resource}`,
        "LockEventHandler",
      );

      this.lockService.applyOperation(entry.data);

      this.metrics.incrementCounter("lock_operations_replicated_total", {
        node: process.env.NODE_ID || "unknown",
        type: entry.data.type,
      });
    }
  }

  @OnRaftLogCommitted()
  handleLogCommitted(entry: any) {
    if (this.isLockOperation(entry.data)) {
      this.logger.log(
        `Lock operation committed: ${entry.data.type} ${entry.data.resource}`,
        "LockEventHandler",
      );

      this.metrics.incrementCounter("lock_operations_committed_total", {
        node: process.env.NODE_ID || "unknown",
        type: entry.data.type,
      });
    }
  }

  @OnRaftStateChange()
  handleStateChange(data: { from: string; to: string }) {
    this.logger.warn(
      `Lock service node state changed from ${data.from} to ${data.to}`,
      "LockEventHandler",
    );

    if (data.to === "leader") {
      this.lockService.getStats().then((stats) => {
        this.logger.log(
          `New leader lock stats: ${stats.activeLocks} active locks`,
          "LockEventHandler",
        );
      });
    }
  }

  @OnRaftLeaderElected()
  handleLeaderElected(data: { leaderId: string }) {
    this.logger.log(
      `New lock service leader: ${data.leaderId}`,
      "LockEventHandler",
    );
  }

  private isLockOperation(data: any): data is LockOperation {
    return (
      data &&
      typeof data.type === "string" &&
      ["ACQUIRE", "RELEASE", "RENEW", "EXPIRE"].includes(data.type) &&
      typeof data.resource === "string" &&
      typeof data.timestamp === "number"
    );
  }
}
