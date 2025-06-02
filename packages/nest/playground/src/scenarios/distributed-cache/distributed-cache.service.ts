import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { RaftService } from "@usex/raft-nestjs";
import { EventBusService } from "@/shared/services/event-bus.service";
import { MetricsService } from "@/shared/services/metrics.service";
import { LoggerService } from "@/shared/services/logger.service";

export interface CacheEntry {
  key: string;
  value: any;
  ttl?: number;
  createdAt: Date;
  expiresAt?: Date;
  version: number;
}

export interface CacheOperation {
  type: "SET" | "DELETE" | "CLEAR" | "EXPIRE";
  key?: string;
  value?: any;
  ttl?: number;
  timestamp: number;
}

@Injectable()
export class DistributedCacheService {
  private cache = new Map<string, CacheEntry>();
  private readonly nodeId: string;

  constructor(
    private readonly raftService: RaftService,
    private readonly eventBus: EventBusService,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
  ) {
    this.nodeId = process.env.NODE_ID || "unknown";
    this.startExpirationChecker();
  }

  async get(key: string): Promise<any> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.metrics.incrementCounter("cache_misses_total", {
        node: this.nodeId,
      });
      return null;
    }

    // Check if expired
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.cache.delete(key);
      this.metrics.incrementCounter("cache_misses_total", {
        node: this.nodeId,
      });
      return null;
    }

    this.metrics.incrementCounter("cache_hits_total", { node: this.nodeId });
    this.eventBus.emitCacheEvent("hit", key, entry.value);

    return entry.value;
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can write. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const operation: CacheOperation = {
      type: "SET",
      key,
      value,
      ttl,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(`Cache SET proposed: ${key}`, "DistributedCache");
  }

  async delete(key: string): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can delete. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const operation: CacheOperation = {
      type: "DELETE",
      key,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(`Cache DELETE proposed: ${key}`, "DistributedCache");
  }

  async clear(): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can clear. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const operation: CacheOperation = {
      type: "CLEAR",
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log("Cache CLEAR proposed", "DistributedCache");
  }

  async keys(pattern?: string): Promise<string[]> {
    const keys = Array.from(this.cache.keys());

    if (pattern) {
      const regex = new RegExp(pattern.replace("*", ".*"));
      return keys.filter((key) => regex.test(key));
    }

    return keys;
  }

  async size(): Promise<number> {
    return this.cache.size;
  }

  async stats(): Promise<any> {
    const entries = Array.from(this.cache.values());
    const now = new Date();

    return {
      nodeId: this.nodeId,
      isLeader: this.raftService.isLeader(),
      size: this.cache.size,
      memoryUsage: this.calculateMemoryUsage(),
      expiredCount: entries.filter((e) => e.expiresAt && e.expiresAt < now)
        .length,
      ttlCount: entries.filter((e) => e.expiresAt).length,
      oldestEntry: entries.reduce(
        (oldest, entry) =>
          !oldest || entry.createdAt < oldest.createdAt ? entry : oldest,
        null,
      ),
      newestEntry: entries.reduce(
        (newest, entry) =>
          !newest || entry.createdAt > newest.createdAt ? entry : newest,
        null,
      ),
    };
  }

  // Internal method called by event handler to apply operations
  applyOperation(operation: CacheOperation) {
    switch (operation.type) {
      case "SET":
        this.applySet(operation);
        break;
      case "DELETE":
        this.applyDelete(operation);
        break;
      case "CLEAR":
        this.applyClear();
        break;
      case "EXPIRE":
        this.applyExpire(operation);
        break;
    }
  }

  private applySet(operation: CacheOperation) {
    const { key, value, ttl } = operation;
    const now = new Date();

    const entry: CacheEntry = {
      key: key!,
      value,
      ttl,
      createdAt: now,
      expiresAt: ttl ? new Date(now.getTime() + ttl * 1000) : undefined,
      version: (this.cache.get(key!)?.version || 0) + 1,
    };

    this.cache.set(key!, entry);
    this.eventBus.emitCacheEvent("set", key!, value);
    this.logger.debug(`Cache SET applied: ${key}`, "DistributedCache");
  }

  private applyDelete(operation: CacheOperation) {
    const { key } = operation;

    if (this.cache.delete(key!)) {
      this.eventBus.emitCacheEvent("delete", key!);
      this.logger.debug(`Cache DELETE applied: ${key}`, "DistributedCache");
    }
  }

  private applyClear() {
    const size = this.cache.size;
    this.cache.clear();
    this.eventBus.emitCacheEvent("clear", "all", { previousSize: size });
    this.logger.debug(
      `Cache CLEAR applied: ${size} entries removed`,
      "DistributedCache",
    );
  }

  private applyExpire(operation: CacheOperation) {
    const { key } = operation;

    if (this.cache.delete(key!)) {
      this.eventBus.emitCacheEvent("expire", key!);
      this.logger.debug(`Cache EXPIRE applied: ${key}`, "DistributedCache");
    }
  }

  private startExpirationChecker() {
    setInterval(() => {
      const now = new Date();
      const expiredKeys: string[] = [];

      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt && entry.expiresAt < now) {
          expiredKeys.push(key);
        }
      }

      expiredKeys.forEach((key) => {
        if (this.raftService.isLeader()) {
          // Only leader proposes expiration
          this.raftService.propose({
            type: "EXPIRE",
            key,
            timestamp: Date.now(),
          });
        } else {
          // Followers just remove locally
          this.cache.delete(key);
        }
      });

      if (expiredKeys.length > 0) {
        this.logger.debug(
          `Expired ${expiredKeys.length} cache entries`,
          "DistributedCache",
        );
      }
    }, 10000); // Check every 10 seconds
  }

  private calculateMemoryUsage(): number {
    let size = 0;

    for (const [key, entry] of this.cache.entries()) {
      size += key.length * 2; // Rough estimate for string
      size += JSON.stringify(entry.value).length * 2;
      size += 100; // Overhead for entry object
    }

    return size;
  }
}
