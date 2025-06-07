import type Redis from "ioredis";
import type { RaftConfiguration, RaftCommandType, LogEntry } from "../types";
import {
  RaftValidationException,
  RaftReplicationException,
} from "../exceptions";
import type { RaftLogger } from "../services";
import { WALRecovery, WALEngine } from "../persistence";
import type { WALOptions } from "../persistence";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { calculateChecksum } from "../utils";

export class RaftLog {
  private entries: LogEntry[] = [];
  private logStartIndex: number = 0; // Represents the index of entries[0] in the overall log
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

  public async appendEntry(
    term: number,
    commandType: RaftCommandType,
    commandPayload: any,
  ): Promise<number> {
    console.log(commandPayload);
    const index = this.logStartIndex + this.entries.length;
    const entry: LogEntry = {
      term,
      index,
      commandType,
      commandPayload,
      timestamp: new Date(),
      checksum: calculateChecksum(commandPayload), // Checksum is based on the payload
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
    if (
      index < this.logStartIndex ||
      index >= this.logStartIndex + this.entries.length
    ) {
      this.logger.info(
        "Attempted to get entry outside of in-memory log range",
        {
          requestedIndex: index,
          logStartIndex: this.logStartIndex,
          currentLogLength: this.entries.length,
        },
      );
      return undefined;
    }
    return this.entries[index - this.logStartIndex];
  }

  public getEntries(startIndex: number, endIndex?: number): LogEntry[] {
    const effectiveStartIndexInArray = Math.max(
      0,
      startIndex - this.logStartIndex,
    );
    const effectiveEndIndexInArray =
      endIndex !== undefined
        ? endIndex - this.logStartIndex
        : this.entries.length;

    if (effectiveStartIndexInArray >= effectiveEndIndexInArray) return [];
    return this.entries.slice(
      effectiveStartIndexInArray,
      effectiveEndIndexInArray,
    );
  }

  public getLastEntry(): LogEntry | undefined {
    if (this.entries.length === 0) {
      return undefined;
    }
    return this.entries[this.entries.length - 1];
  }

  public getLength(): number {
    // This should represent the number of entries *in memory*
    return this.entries.length;
  }

  public getTotalLogLength(): number {
    // This represents the logical length of the log, including what's covered by snapshots
    return this.logStartIndex + this.entries.length;
  }

  public getFirstIndex(): number {
    // Returns the first index available in the in-memory log (which is logStartIndex),
    // or the index *after* the last snapshot if the in-memory log is empty but a snapshot was loaded.
    return this.logStartIndex;
  }

  public setFirstIndex(index: number): void {
    this.logger.info(
      `Setting RaftLog first index to: ${index}. Current logStartIndex: ${this.logStartIndex}`,
      { nodeId: this.nodeId },
    );

    if (
      index <= this.logStartIndex &&
      this.entries.length > 0 &&
      this.entries[0]!.index < index
    ) {
      // This case implies an overlap or setting to an already covered index,
      // ensure in-memory entries are consistent.
      this.logger.debug(
        "New first index requires adjusting in-memory entries.",
        { newFirstIndex: index, oldLogStartIndex: this.logStartIndex },
      );
    }

    const newInMemoryEntries = [];
    let removedCount = 0;
    for (const entry of this.entries) {
      if (entry.index >= index) {
        newInMemoryEntries.push(entry);
      } else {
        removedCount++;
      }
    }
    if (removedCount > 0) {
      this.logger.info(
        `Removed ${removedCount} in-memory entries now covered by snapshot up to index ${index - 1}.`,
        { nodeId: this.nodeId },
      );
    }
    this.entries = newInMemoryEntries;
    this.logStartIndex = index;

    // Note: Persisted log entries (e.g., in Redis) older than `index` should also be cleaned up.
    // This is currently handled by `truncateBeforeIndex` when a new snapshot is created.
    // If `setFirstIndex` is called after loading a snapshot on startup, `loadFromStorage` might have
    // loaded entries that are now effectively truncated by the loaded snapshot.
    // The current implementation of `loadFromStorage` loads all matching keys then sorts.
    // It might be more efficient if `loadFromStorage` itself was aware of `logStartIndex`
    // after a snapshot is loaded by `RaftNode.loadLatestSnapshotFromDisk`.
    // For now, this adjustment primarily affects newly appended/replicated entries.
  }

  public getLastIndex(): number {
    // Returns the last index in the in-memory log.
    if (this.entries.length === 0) {
      // If log is empty, the last known index is one less than the starting index.
      // If logStartIndex is 0 (never snapshotted, or fresh), then -1 might be returned.
      // Raft typically expects lastLogIndex to be >= 0 for a non-empty log.
      // If logStartIndex is from a snapshot, e.g. 100, and entries is empty, last index is 99.
      return this.logStartIndex > 0 ? this.logStartIndex - 1 : 0;
    }
    return this.entries[this.entries.length - 1]!.index;
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
    // Note: WAL truncation logic might need to be more sophisticated,
    // ensuring that segments containing entries needed for snapshots are handled correctly.
    // For now, if `truncateBeforeIndex` is called after a snapshot, the WAL should
    // reflect that older entries are no longer primary.
    if (this.walEngine && entriesToRemove.length > 0) {
      // This assumes WAL's internal mechanism can handle truncation correctly based on log indices.
      // A direct mapping from log index to WAL sequence number might be needed for robust truncation.
      await this.walEngine.truncateLogEntriesBefore(index); // Assuming WALEngine has such a method or similar
    }

    this.logger.info(
      "Log truncated (before index), and old snapshots potentially removed.",
      {
        truncatedBeforeIndex: index,
        removedCount: entriesToRemove.length,
        nodeId: this.nodeId,
      },
    );

    // Clean up old on-disk snapshots
    // This is called after a *new* snapshot has been successfully created and persisted by RaftNode,
    // and RaftNode calls truncateBeforeIndex(newSnapshot.lastIncludedIndex + 1).
    // So, 'index' here is newSnapshot.lastIncludedIndex + 1. We want to delete snapshots
    // strictly older than newSnapshot.lastIncludedIndex.
    const deleteSnapshotsBeforeIndex = index - 1;
    const snapshotDir = this.config.persistence.dataDir;
    try {
      await fs.mkdir(snapshotDir, { recursive: true }); // Ensure dir exists
      const files = await fs.readdir(snapshotDir);
      const snapshotFiles = files.filter((file) =>
        file.match(/^snapshot-\d+-\d+\.snap$/),
      );

      for (const file of snapshotFiles) {
        const parts = file.replace(".snap", "").split("-");
        if (parts.length === 3) {
          // const snapTerm = parseInt(parts[1], 10); // Available if needed
          const snapIndex = parseInt(parts[2]!, 10);
          if (snapIndex < deleteSnapshotsBeforeIndex) {
            const filePathToDelete = path.join(snapshotDir, file);
            await fs.unlink(filePathToDelete);
            this.logger.info("Deleted old snapshot file", {
              filePath: filePathToDelete,
              deletedIndex: snapIndex,
              newSnapshotIndex: deleteSnapshotsBeforeIndex,
            });
          }
        }
      }
    } catch (error) {
      this.logger.error("Failed to clean up old snapshot files", {
        error,
        snapshotDir,
        deleteSnapshotsBeforeIndex,
      });
    }
  }

  public async truncateEntriesAfter(
    index: number,
    term: number,
  ): Promise<void> {
    let removedCount = 0;
    // Find the entry with the given index and term
    const existingEntryIndex = this.entries.findIndex(
      (e) => e.index === index && e.term === term,
    );

    if (existingEntryIndex !== -1) {
      // If an entry with the same index and term exists, retain log entries up to that point
      // and discard entries *after* it.
      const entriesToKeep = this.entries.slice(0, existingEntryIndex + 1);
      removedCount = this.entries.length - entriesToKeep.length;
      this.entries = entriesToKeep;
    } else {
      // If no such entry exists, discard the entire log.
      // This happens if the follower's log is completely inconsistent with the snapshot.
      removedCount = this.entries.length;
      this.entries = [];
    }

    // Update Redis: remove the discarded entries
    // This is simplified; in a real scenario, you might remove a range of keys.
    // For now, we'll re-persist the (potentially empty) current log or clear all.
    // This part needs to be efficient.
    const allKeysPattern = `${this.nodeId}:log:*`;
    const keys = await this.storage.keys(allKeysPattern);
    if (keys.length > 0) {
      await this.storage.del(keys);
    }
    for (const entry of this.entries) {
      await this.persistEntry(entry); // Re-persist remaining entries
    }

    // TODO: WAL truncation for entries *after* a certain point.
    // This might involve marking segments for deletion or more complex WAL management.
    // For now, new entries will go to new segments. If the entire log was discarded,
    // the WAL might also need to be reset or a new one started after snapshot installation.
    if (this.walEngine) {
      // This is a placeholder. WAL might need a more specific truncation here.
      // If the entire log is cleared, WAL might need to reflect this, perhaps by starting fresh
      // or creating a new snapshot marker.
      this.logger.warn(
        "WAL truncation after snapshot installation needs specific implementation.",
        { index, term },
      );
    }

    this.logger.info("Log truncated (after index due to snapshot)", {
      retainedUpToIndex: index,
      retainedUpToTerm: term,
      removedCount,
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
    // filePath is the location where RaftNode saved the snapshot.
    // The actual snapshot data Buffer is no longer passed here.
    snapshotFilePath?: string,
  ): Promise<void> {
    if (this.walEngine) {
      // WAL stores metadata about the snapshot event, not the full data.
      await this.walEngine.appendSnapshot({
        lastIncludedIndex,
        lastIncludedTerm,
        filePath: snapshotFilePath, // Store path or identifier in WAL.
        // Any other critical metadata for WAL recovery related to this snapshot event.
      });

      // Compacting the WAL after a snapshot metadata entry is crucial.
      // It allows old log segments, now covered by the snapshot, to be cleaned up.
      await this.walEngine.compact();
      this.logger.info("Snapshot metadata recorded in WAL and WAL compacted.", {
        lastIncludedIndex,
        lastIncludedTerm,
        filePath: snapshotFilePath,
        nodeId: this.nodeId,
      });
    } else {
      this.logger.info(
        "Snapshot event occurred, but WAL is not enabled. No WAL record written.",
        {
          lastIncludedIndex,
          lastIncludedTerm,
          filePath: snapshotFilePath,
        },
      );
    }
  }
}
