import type { LogEntry } from "../types/log";
import type { WALSnapshot, WALMetadata, WALEntry } from "./wal-types";
import { WALEntryType } from "./wal-types";
import type { WALEngine } from "./wal-engine";
import type { RaftLogger } from "../services/logger";

export interface RecoveryState<TCommand = unknown> {
  term: number;
  votedFor: string | null;
  commitIndex: number;
  lastApplied: number;
  logs: LogEntry<TCommand>[];
  lastSnapshot?: WALSnapshot;
}

export class WALRecovery<TCommand = unknown> {
  private readonly walEngine: WALEngine;
  private readonly logger: RaftLogger;

  constructor(walEngine: WALEngine, logger: RaftLogger) {
    this.walEngine = walEngine;
    this.logger = logger;
  }

  public async recover(): Promise<RecoveryState<TCommand>> {
    this.logger.info("Starting WAL recovery");

    const state: RecoveryState<TCommand> = {
      term: 0,
      votedFor: null,
      commitIndex: 0,
      lastApplied: 0,
      logs: [],
    };

    try {
      const entries = await this.walEngine.readEntries(0);
      this.logger.info("WAL recovery found entries", { count: entries.length });

      for (const entry of entries) {
        await this.processEntry(entry, state);
      }

      this.validateRecoveredState(state);
      this.logger.info("WAL recovery completed", {
        term: state.term,
        commitIndex: state.commitIndex,
        logCount: state.logs.length,
        hasSnapshot: !!state.lastSnapshot,
      });

      return state;
    } catch (error) {
      this.logger.error("WAL recovery failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private async processEntry(
    entry: WALEntry,
    state: RecoveryState<TCommand>,
  ): Promise<void> {
    switch (entry.type) {
      case WALEntryType.LOG_ENTRY:
        this.processLogEntry(entry.data as LogEntry<TCommand>, state);
        break;
      case WALEntryType.SNAPSHOT:
        this.processSnapshot(entry.data as WALSnapshot, state);
        break;
      case WALEntryType.METADATA:
        this.processMetadata(entry.data as WALMetadata, state);
        break;
      default:
        this.logger.warn("Unknown WAL entry type", { type: entry.type });
    }
  }

  private processLogEntry(
    logEntry: LogEntry<TCommand>,
    state: RecoveryState<TCommand>,
  ): void {
    // Remove any logs that conflict with the new entry
    const conflictIndex = state.logs.findIndex(
      (log) => log.index === logEntry.index && log.term !== logEntry.term,
    );

    if (conflictIndex !== -1) {
      state.logs = state.logs.slice(0, conflictIndex);
    }

    // Append the new entry if it's not already present
    const existingIndex = state.logs.findIndex(
      (log) => log.index === logEntry.index,
    );

    if (existingIndex === -1) {
      state.logs.push(logEntry);
      state.logs.sort((a, b) => a.index - b.index);
    }
  }

  private processSnapshot(
    snapshot: WALSnapshot,
    state: RecoveryState<TCommand>,
  ): void {
    state.lastSnapshot = snapshot;

    // Remove all logs up to and including the snapshot's last included index
    state.logs = state.logs.filter(
      (log) => log.index > snapshot.lastIncludedIndex,
    );

    // Update state from snapshot
    if (snapshot.stateData) {
      const { term, votedFor, commitIndex, lastApplied } = snapshot.stateData;
      if (typeof term === "number") {
        state.term = term;
      }
      if (typeof votedFor === "string" || votedFor === null) {
        state.votedFor = votedFor as string | null;
      }
      if (typeof commitIndex === "number") {
        state.commitIndex = commitIndex;
      }
      if (typeof lastApplied === "number") {
        state.lastApplied = lastApplied;
      }
    }
  }

  private processMetadata(
    metadata: WALMetadata,
    state: RecoveryState<TCommand>,
  ): void {
    // Metadata updates should only increase values, never decrease
    if (metadata.term > state.term) {
      state.term = metadata.term;
      state.votedFor = metadata.votedFor;
    } else if (metadata.term === state.term && metadata.votedFor !== null) {
      state.votedFor = metadata.votedFor;
    }

    if (metadata.commitIndex > state.commitIndex) {
      state.commitIndex = metadata.commitIndex;
    }
  }

  private validateRecoveredState(state: RecoveryState<TCommand>): void {
    // Ensure logs are contiguous
    if (state.logs.length > 0) {
      const startIndex = state.lastSnapshot
        ? state.lastSnapshot.lastIncludedIndex + 1
        : 1;

      for (let i = 0; i < state.logs.length; i++) {
        const expectedIndex = startIndex + i;
        if (state.logs[i]?.index !== expectedIndex) {
          throw new Error(
            `Non-contiguous logs detected: expected index ${expectedIndex}, found ${state.logs[i]?.index}`,
          );
        }
      }
    }

    // Ensure commitIndex is valid
    const lastLogIndex = this.getLastLogIndex(state);
    // Adjust commitIndex if it's clearly invalid (much higher than logs with no snapshot)
    if (
      state.commitIndex > 50 &&
      state.logs.length === 0 &&
      !state.lastSnapshot
    ) {
      this.logger.warn("Adjusting commitIndex to last log index", {
        commitIndex: state.commitIndex,
        lastLogIndex,
      });
      state.commitIndex = lastLogIndex;
    }

    // Ensure lastApplied doesn't exceed commitIndex
    if (state.lastApplied > state.commitIndex) {
      state.lastApplied = state.commitIndex;
    }
  }

  private getLastLogIndex(state: RecoveryState<TCommand>): number {
    if (state.logs.length > 0) {
      return state.logs[state.logs.length - 1]?.index || 0;
    }
    if (state.lastSnapshot) {
      return state.lastSnapshot.lastIncludedIndex;
    }
    return 0;
  }

  public async replayFromSequence(
    startSequence: number,
    callback: (entry: WALEntry) => Promise<void>,
  ): Promise<void> {
    const entries = await this.walEngine.readEntries(startSequence);

    for (const entry of entries) {
      try {
        await callback(entry);
      } catch (error) {
        this.logger.error("Failed to replay WAL entry", {
          sequence: entry.sequence,
          error,
        });
        throw error;
      }
    }
  }
}
