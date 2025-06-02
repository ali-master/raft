import {
  Injectable,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { RaftService } from "@usex/raft-nestjs";
import { EventBusService } from "@/shared/services/event-bus.service";
import { MetricsService } from "@/shared/services/metrics.service";
import { LoggerService } from "@/shared/services/logger.service";

export interface Lock {
  resource: string;
  owner: string;
  acquiredAt: Date;
  expiresAt?: Date;
  ttl?: number;
  metadata?: any;
  renewCount: number;
}

export interface LockOperation {
  type: "ACQUIRE" | "RELEASE" | "RENEW" | "EXPIRE";
  resource: string;
  owner?: string;
  ttl?: number;
  metadata?: any;
  timestamp: number;
}

export interface LockRequest {
  resource: string;
  owner: string;
  ttl?: number;
  metadata?: any;
}

@Injectable()
export class LockService {
  private locks = new Map<string, Lock>();
  private locksByOwner = new Map<string, Set<string>>();
  private readonly nodeId: string;
  private expirationInterval: NodeJS.Timeout;

  constructor(
    private readonly raftService: RaftService,
    private readonly eventBus: EventBusService,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
  ) {
    this.nodeId = process.env.NODE_ID || "unknown";
    this.startExpirationChecker();
  }

  async acquireLock(request: LockRequest): Promise<Lock> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can manage locks. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    // Check if lock already exists
    const existingLock = this.locks.get(request.resource);
    if (
      existingLock &&
      (!existingLock.expiresAt || existingLock.expiresAt > new Date())
    ) {
      throw new ConflictException(
        `Resource ${request.resource} is already locked by ${existingLock.owner}`,
      );
    }

    const operation: LockOperation = {
      type: "ACQUIRE",
      resource: request.resource,
      owner: request.owner,
      ttl: request.ttl,
      metadata: request.metadata,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(
      `Lock acquired: ${request.resource} by ${request.owner}`,
      "LockService",
    );

    // Return the lock that will be created
    const now = new Date();
    return {
      resource: request.resource,
      owner: request.owner,
      acquiredAt: now,
      expiresAt: request.ttl
        ? new Date(now.getTime() + request.ttl * 1000)
        : undefined,
      ttl: request.ttl,
      metadata: request.metadata,
      renewCount: 0,
    };
  }

  async releaseLock(resource: string, owner: string): Promise<void> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can release locks. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const lock = this.locks.get(resource);
    if (!lock) {
      throw new BadRequestException(`Lock not found: ${resource}`);
    }

    if (lock.owner !== owner) {
      throw new BadRequestException(
        `Cannot release lock owned by ${lock.owner}. Requested by ${owner}`,
      );
    }

    const operation: LockOperation = {
      type: "RELEASE",
      resource,
      owner,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(`Lock released: ${resource} by ${owner}`, "LockService");
  }

  async renewLock(
    resource: string,
    owner: string,
    ttl?: number,
  ): Promise<Lock> {
    if (!this.raftService.isLeader()) {
      throw new BadRequestException(
        `Only leader can renew locks. Current leader: ${this.raftService.getLeaderId()}`,
      );
    }

    const lock = this.locks.get(resource);
    if (!lock) {
      throw new BadRequestException(`Lock not found: ${resource}`);
    }

    if (lock.owner !== owner) {
      throw new BadRequestException(
        `Cannot renew lock owned by ${lock.owner}. Requested by ${owner}`,
      );
    }

    const operation: LockOperation = {
      type: "RENEW",
      resource,
      owner,
      ttl: ttl || lock.ttl,
      timestamp: Date.now(),
    };

    await this.raftService.propose(operation);
    this.logger.log(`Lock renewed: ${resource} by ${owner}`, "LockService");

    // Return updated lock
    return {
      ...lock,
      expiresAt: ttl ? new Date(Date.now() + ttl * 1000) : lock.expiresAt,
      ttl: ttl || lock.ttl,
      renewCount: lock.renewCount + 1,
    };
  }

  getLock(resource: string): Lock | undefined {
    const lock = this.locks.get(resource);

    // Check if expired
    if (lock && lock.expiresAt && lock.expiresAt < new Date()) {
      return undefined;
    }

    return lock;
  }

  getLocksByOwner(owner: string): Lock[] {
    const resources = this.locksByOwner.get(owner) || new Set();
    return Array.from(resources)
      .map((resource) => this.locks.get(resource))
      .filter(
        (lock): lock is Lock =>
          lock !== undefined &&
          (!lock.expiresAt || lock.expiresAt > new Date()),
      );
  }

  getAllLocks(): Lock[] {
    return Array.from(this.locks.values()).filter(
      (lock) => !lock.expiresAt || lock.expiresAt > new Date(),
    );
  }

  async getStats() {
    const locks = Array.from(this.locks.values());
    const now = new Date();

    const activeLocks = locks.filter(
      (lock) => !lock.expiresAt || lock.expiresAt > now,
    );

    const expiredLocks = locks.filter(
      (lock) => lock.expiresAt && lock.expiresAt <= now,
    );

    const ownerStats = new Map<string, number>();
    for (const lock of activeLocks) {
      ownerStats.set(lock.owner, (ownerStats.get(lock.owner) || 0) + 1);
    }

    return {
      nodeId: this.nodeId,
      isLeader: this.raftService.isLeader(),
      totalLocks: locks.length,
      activeLocks: activeLocks.length,
      expiredLocks: expiredLocks.length,
      locksByOwner: Object.fromEntries(ownerStats),
      oldestLock: activeLocks.reduce(
        (oldest, lock) =>
          !oldest || lock.acquiredAt < oldest.acquiredAt ? lock : oldest,
        null as Lock | null,
      ),
      mostRenewedLock: activeLocks.reduce(
        (most, lock) =>
          !most || lock.renewCount > most.renewCount ? lock : most,
        null as Lock | null,
      ),
    };
  }

  // Internal method called by event handler
  applyOperation(operation: LockOperation) {
    switch (operation.type) {
      case "ACQUIRE":
        this.applyAcquire(operation);
        break;
      case "RELEASE":
        this.applyRelease(operation);
        break;
      case "RENEW":
        this.applyRenew(operation);
        break;
      case "EXPIRE":
        this.applyExpire(operation);
        break;
    }
  }

  private applyAcquire(operation: LockOperation) {
    const now = new Date();
    const lock: Lock = {
      resource: operation.resource,
      owner: operation.owner!,
      acquiredAt: now,
      expiresAt: operation.ttl
        ? new Date(now.getTime() + operation.ttl * 1000)
        : undefined,
      ttl: operation.ttl,
      metadata: operation.metadata,
      renewCount: 0,
    };

    this.locks.set(operation.resource, lock);

    // Track by owner
    if (!this.locksByOwner.has(operation.owner!)) {
      this.locksByOwner.set(operation.owner!, new Set());
    }
    this.locksByOwner.get(operation.owner!)?.add(operation.resource);

    this.eventBus.emitLockEvent(
      "acquired",
      operation.resource,
      operation.owner!,
    );
    this.metrics.incrementCounter("locks_acquired_total", {
      node: this.nodeId,
    });
    this.logger.debug(
      `Lock acquired: ${operation.resource} by ${operation.owner}`,
      "LockService",
    );
  }

  private applyRelease(operation: LockOperation) {
    const lock = this.locks.get(operation.resource);
    if (!lock) return;

    this.locks.delete(operation.resource);
    this.locksByOwner.get(lock.owner)?.delete(operation.resource);

    if (this.locksByOwner.get(lock.owner)?.size === 0) {
      this.locksByOwner.delete(lock.owner);
    }

    this.eventBus.emitLockEvent("released", operation.resource, lock.owner);
    this.metrics.incrementCounter("locks_released_total", {
      node: this.nodeId,
    });
    this.logger.debug(
      `Lock released: ${operation.resource} by ${lock.owner}`,
      "LockService",
    );
  }

  private applyRenew(operation: LockOperation) {
    const lock = this.locks.get(operation.resource);
    if (!lock) return;

    lock.expiresAt = operation.ttl
      ? new Date(Date.now() + operation.ttl * 1000)
      : undefined;
    lock.ttl = operation.ttl;
    lock.renewCount++;

    this.eventBus.emitLockEvent("renewed", operation.resource, lock.owner);
    this.logger.debug(
      `Lock renewed: ${operation.resource} by ${lock.owner} (count: ${lock.renewCount})`,
      "LockService",
    );
  }

  private applyExpire(operation: LockOperation) {
    const lock = this.locks.get(operation.resource);
    if (!lock) return;

    this.locks.delete(operation.resource);
    this.locksByOwner.get(lock.owner)?.delete(operation.resource);

    if (this.locksByOwner.get(lock.owner)?.size === 0) {
      this.locksByOwner.delete(lock.owner);
    }

    this.eventBus.emitLockEvent("expired", operation.resource, lock.owner);
    this.logger.debug(
      `Lock expired: ${operation.resource} (was owned by ${lock.owner})`,
      "LockService",
    );
  }

  private startExpirationChecker() {
    this.expirationInterval = setInterval(() => {
      const now = new Date();
      const expiredLocks: string[] = [];

      for (const [resource, lock] of this.locks.entries()) {
        if (lock.expiresAt && lock.expiresAt < now) {
          expiredLocks.push(resource);
        }
      }

      expiredLocks.forEach((resource) => {
        if (this.raftService.isLeader()) {
          // Only leader proposes expiration
          this.raftService.propose({
            type: "EXPIRE",
            resource,
            timestamp: Date.now(),
          });
        } else {
          // Followers just track locally
          const lock = this.locks.get(resource);
          if (lock) {
            this.locks.delete(resource);
            this.locksByOwner.get(lock.owner)?.delete(resource);
          }
        }
      });

      if (expiredLocks.length > 0) {
        this.logger.debug(
          `Expired ${expiredLocks.length} locks`,
          "LockService",
        );
      }
    }, 5000); // Check every 5 seconds
  }

  onModuleDestroy() {
    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
    }
  }
}
