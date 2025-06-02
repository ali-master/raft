import type Redis from "ioredis";
import { createHash } from "node:crypto";
import type { RaftConfiguration, LogEntry } from "../types";
import {
  RaftValidationException,
  RaftReplicationException,
} from "../exceptions";
import type { RaftLogger } from "../services";
import { WALRecovery, WALEngine } from "../persistence";
import type { WALOptions } from "../persistence";

export class RaftLog {
  private entries: LogEntry[] = [];
  private readonly storage: Redis;
  private readonly nodeId: string;
  private readonly logger: RaftLogger;
  private walEngine?: WALEngine;
  private walRecovery?: WALRecovery;
  private readonly config: RaftConfiguration;

  constructor(
    storage: Redis,
    nodeId: string,
    logger: RaftLogger,
    config: RaftConfiguration,
  ) {
    this.storage = storage;
    this.nodeId = nodeId;
    this.logger = logger;
    this.config = config;

    if (config.persistence.walEnabled) {
      this.initializeWAL();
    }
  }

  public async appendEntry(term: number, command: any): Promise<number> {
    const entry: LogEntry = {
      term,
      index: this.entries.length,
      command,
      timestamp: new Date(),
      checksum: this.calculateChecksum(command),
    };

    this.entries.push(entry);

    // Persist to WAL first if enabled
    if (this.walEngine) {
      await this.walEngine.appendLogEntry(entry);
    }

    await this.persistEntry(entry);

    this.logger.debug("Log entry appended", {
      index: entry.index,
      term: entry.term,
      nodeId: this.nodeId,
    });

    return entry.index;
  }

  public async appendEntries(
    entries: LogEntry[],
    prevLogIndex: number,
    prevLogTerm?: number,
  ): Promise<boolean> {
    try {
      // Validate previous log entry
      if (
        prevLogIndex >= 0 &&
        !this.isValidPreviousEntry(prevLogIndex, prevLogTerm)
      ) {
        throw new RaftValidationException(
          "Previous log entry validation failed",
        );
      }

      // Remove conflicting entries
      this.entries = this.entries.slice(0, prevLogIndex + 1);

      // Append new entries
      for (const entry of entries) {
        this.entries.push(entry);

        // Persist to WAL first if enabled
        if (this.walEngine) {
          await this.walEngine.appendLogEntry(entry);
        }

        await this.persistEntry(entry);
      }

      this.logger.debug("Multiple log entries appended", {
        count: entries.length,
        startIndex: prevLogIndex + 1,
        nodeId: this.nodeId,
      });

      return true;
    } catch (error) {
      // Re-throw validation errors as-is
      if (error instanceof RaftValidationException) {
        throw error;
      }

      this.logger.error("Failed to append entries", {
        error,
        nodeId: this.nodeId,
      });
      throw new RaftReplicationException(`Failed to append entries: ${error}`);
    }
  }

  public getEntry(index: number): LogEntry | undefined {
    return this.entries[index];
  }

  public getEntries(startIndex: number, endIndex?: number): LogEntry[] {
    return this.entries.slice(startIndex, endIndex);
  }

  public getLastEntry(): LogEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  public getLength(): number {
    return this.entries.length;
  }

  public getLastIndex(): number {
    return this.entries.length - 1;
  }

  public getLastTerm(): number {
    const lastEntry = this.getLastEntry();
    return lastEntry ? lastEntry.term : 0;
  }

  private isValidPreviousEntry(
    prevLogIndex: number,
    prevLogTerm?: number,
  ): boolean {
    if (prevLogIndex < 0) {
      return true;
    }

    if (prevLogIndex >= this.entries.length) {
      return false;
    }

    // If prevLogTerm is provided, validate it matches
    if (prevLogTerm !== undefined) {
      const entry = this.entries[prevLogIndex];
      return entry !== undefined && entry.term === prevLogTerm;
    }

    return true;
  }

  private calculateChecksum(command: any): string {
    return createHash("sha256").update(JSON.stringify(command)).digest("hex");
  }

  private async persistEntry(entry: LogEntry): Promise<void> {
    const key = `${this.nodeId}:log:${entry.index}`;
    await this.storage.set(key, JSON.stringify(entry));
  }

  public async loadFromStorage(): Promise<void> {
    try {
      // Try to recover from WAL first if enabled
      if (this.walRecovery) {
        const recoveryState = await this.walRecovery.recover();
        this.entries = recoveryState.logs;
        this.logger.info("Log recovered from WAL", {
          entryCount: this.entries.length,
          nodeId: this.nodeId,
        });
        return;
      }

      // Fallback to Redis storage
      const pattern = `${this.nodeId}:log:*`;
      const keys = await this.storage.keys(pattern);

      const entries: LogEntry[] = [];
      for (const key of keys) {
        const data = await this.storage.get(key);
        if (data) {
          entries.push(JSON.parse(data));
        }
      }

      this.entries = entries.sort((a, b) => a.index - b.index);
      this.logger.info("Log loaded from storage", {
        entryCount: this.entries.length,
        nodeId: this.nodeId,
      });
    } catch (error) {
      this.logger.error("Failed to load log from storage", {
        error,
        nodeId: this.nodeId,
      });
      // Don't throw on storage errors during loading - just log and continue with empty log
      this.entries = [];
    }
  }

  private initializeWAL(): void {
    const walOptions: WALOptions = {
      dataDir: this.config.persistence.dataDir,
      maxSegmentSize: 10 * 1024 * 1024, // 10MB
      maxWalSize: this.config.persistence.walSizeLimit,
      syncInterval: 100, // 100ms
      compressionEnabled: false,
      checksumEnabled: true,
    };

    this.walEngine = new WALEngine(walOptions, this.logger);
    this.walRecovery = new WALRecovery(this.walEngine, this.logger);
  }

  public async initializeWALEngine(): Promise<void> {
    if (this.walEngine) {
      await this.walEngine.initialize();
    }
  }

  public async closeWAL(): Promise<void> {
    if (this.walEngine) {
      await this.walEngine.close();
    }
  }

  public async compactWAL(): Promise<void> {
    if (this.walEngine) {
      await this.walEngine.compact();
    }
  }

  public async truncateBeforeIndex(index: number): Promise<void> {
    // Remove entries before the given index
    const entriesToRemove = this.entries.filter((e) => e.index < index);
    this.entries = this.entries.filter((e) => e.index >= index);

    // Remove from Redis
    for (const entry of entriesToRemove) {
      const key = `${this.nodeId}:log:${entry.index}`;
      await this.storage.del(key);
    }

    // Truncate WAL if enabled
    if (this.walEngine && entriesToRemove.length > 0) {
      // Find the sequence number for truncation
      // This is a simplified approach - in production, we'd track sequence numbers
      await this.walEngine.truncate(index);
    }

    this.logger.info("Log truncated", {
      beforeIndex: index,
      removedCount: entriesToRemove.length,
      nodeId: this.nodeId,
    });
  }

  public async persistMetadata(
    term: number,
    votedFor: string | null,
    commitIndex: number,
  ): Promise<void> {
    if (this.walEngine) {
      await this.walEngine.appendMetadata({
        term,
        votedFor,
        commitIndex,
      });
    }
  }

  public async createSnapshot(
    lastIncludedIndex: number,
    lastIncludedTerm: number,
    data: Buffer,
    stateData?: Record<string, unknown>,
  ): Promise<void> {
    if (this.walEngine) {
      await this.walEngine.appendSnapshot({
        lastIncludedIndex,
        lastIncludedTerm,
        data,
        stateData,
      });

      // Compact WAL after snapshot
      await this.walEngine.compact();
    }

    this.logger.info("Snapshot created", {
      lastIncludedIndex,
      lastIncludedTerm,
      size: data.length,
      nodeId: this.nodeId,
    });
  }
}
