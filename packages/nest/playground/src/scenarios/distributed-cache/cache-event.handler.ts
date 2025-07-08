import { Injectable } from "@nestjs/common";
import {
  OnLogReplicated,
  OnLogCommitted,
  OnStateChange,
  OnLeaderElected,
} from "@usex/raft-nestjs";
import {
  DistributedCacheService,
  CacheOperation,
} from "./distributed-cache.service";
import { LoggerService } from "@/shared/services/logger.service";
import { MetricsService } from "@/shared/services/metrics.service";

@Injectable()
export class CacheEventHandler {
  constructor(
    private readonly cacheService: DistributedCacheService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  @OnLogReplicated()
  handleLogReplicated(entry: any) {
    // Apply cache operations when log entries are replicated
    if (this.isCacheOperation(entry.data)) {
      this.logger.debug(
        `Applying replicated cache operation: ${entry.data.type}`,
        "CacheEventHandler",
      );
      this.cacheService.applyOperation(entry.data);
      this.metrics.incrementCounter("cache_operations_replicated_total", {
        node: process.env.NODE_ID || "unknown",
        type: entry.data.type,
      });
    }
  }

  @OnLogCommitted()
  handleLogCommitted(entry: any) {
    // Log when cache operations are committed
    if (this.isCacheOperation(entry.data)) {
      this.logger.log(
        `Cache operation committed: ${entry.data.type} ${entry.data.key || "all"}`,
        "CacheEventHandler",
      );
      this.metrics.incrementCounter("cache_operations_committed_total", {
        node: process.env.NODE_ID || "unknown",
        type: entry.data.type,
      });
    }
  }

  @OnStateChange()
  handleStateChange(data: { from: string; to: string }) {
    this.logger.warn(
      `Cache node state changed from ${data.from} to ${data.to}`,
      "CacheEventHandler",
    );

    // If we became leader, log cache stats
    if (data.to === "leader") {
      this.cacheService.stats().then((stats) => {
        this.logger.log(
          `New leader cache stats: ${stats.size} entries, ${stats.memoryUsage} bytes`,
          "CacheEventHandler",
        );
      });
    }
  }

  @OnLeaderElected()
  handleLeaderElected(data: { leaderId: string }) {
    this.logger.log(
      `New cache cluster leader: ${data.leaderId}`,
      "CacheEventHandler",
    );
  }

  private isCacheOperation(data: any): data is CacheOperation {
    return (
      data &&
      typeof data.type === "string" &&
      ["SET", "DELETE", "CLEAR", "EXPIRE"].includes(data.type) &&
      typeof data.timestamp === "number"
    );
  }
}
