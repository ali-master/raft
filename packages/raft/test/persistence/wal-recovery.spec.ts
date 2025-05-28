import { it, expect, describe, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import { WALRecovery, WALEngine } from "../../src/persistence";
import type {
  WALSnapshot,
  WALOptions,
  WALMetadata,
} from "../../src/persistence";
import type { LogEntry } from "../../src/types";
import { RaftLogger } from "../../src/services";
import { LogLevel } from "../../src/constants";

describe("walRecovery", () => {
  let walEngine: WALEngine;
  let walRecovery: WALRecovery;
  let logger: RaftLogger;
  const testDataDir = "/tmp/raft-wal-recovery-test";

  const walOptions: WALOptions = {
    dataDir: testDataDir,
    maxSegmentSize: 1024 * 1024,
    maxWalSize: 10 * 1024 * 1024,
    syncInterval: 0, // Sync immediately for tests
    compressionEnabled: false,
    checksumEnabled: true,
  };

  beforeEach(async () => {
    logger = new RaftLogger({
      level: LogLevel.ERROR,
      enableConsole: false,
    });
    walEngine = new WALEngine(walOptions, logger);
    await walEngine.initialize();
    walRecovery = new WALRecovery(walEngine, logger);
  });

  afterEach(async () => {
    await walEngine.close();
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("recover", () => {
    it("should recover log entries", async () => {
      // Write some log entries
      const entries: LogEntry[] = [];
      for (let i = 1; i <= 5; i++) {
        const entry: LogEntry = {
          index: i,
          term: 1,
          command: { type: "SET", key: `k${i}`, value: `v${i}` },
          timestamp: new Date(),
          checksum: `checksum${i}`,
        };
        entries.push(entry);
        await walEngine.appendLogEntry(entry);
      }

      const state = await walRecovery.recover();

      expect(state.logs).toHaveLength(5);
      expect(state.logs).toEqual(entries);
      expect(state.term).toBe(0); // No metadata written
      expect(state.votedFor).toBe(null);
      expect(state.commitIndex).toBe(0);
    });

    it("should recover metadata", async () => {
      const metadata: WALMetadata = {
        term: 3,
        votedFor: "node-1",
        commitIndex: 10,
      };

      await walEngine.appendMetadata(metadata);

      const state = await walRecovery.recover();

      expect(state.term).toBe(3);
      expect(state.votedFor).toBe("node-1");
      expect(state.commitIndex).toBe(10);
    });

    it("should apply latest metadata", async () => {
      // Write multiple metadata entries
      await walEngine.appendMetadata({
        term: 1,
        votedFor: "node-1",
        commitIndex: 5,
      });

      await walEngine.appendMetadata({
        term: 2,
        votedFor: null,
        commitIndex: 8,
      });

      await walEngine.appendMetadata({
        term: 2,
        votedFor: "node-2",
        commitIndex: 10,
      });

      const state = await walRecovery.recover();

      expect(state.term).toBe(2);
      expect(state.votedFor).toBe("node-2");
      expect(state.commitIndex).toBe(10);
    });

    it("should recover from snapshot", async () => {
      // Add some logs
      for (let i = 1; i <= 10; i++) {
        await walEngine.appendLogEntry({
          index: i,
          term: 1,
          command: { index: i },
          timestamp: new Date(),
          checksum: `checksum${i}`,
        });
      }

      // Create snapshot at index 8
      const snapshot: WALSnapshot = {
        lastIncludedIndex: 8,
        lastIncludedTerm: 1,
        data: Buffer.from("snapshot-data"),
        stateData: {
          term: 1,
          votedFor: "node-1",
          commitIndex: 8,
          lastApplied: 8,
        },
      };
      await walEngine.appendSnapshot(snapshot);

      // Add more logs after snapshot
      for (let i = 9; i <= 12; i++) {
        await walEngine.appendLogEntry({
          index: i,
          term: 2,
          command: { index: i },
          timestamp: new Date(),
          checksum: `checksum${i}`,
        });
      }

      const state = await walRecovery.recover();

      expect(state.lastSnapshot).toEqual(snapshot);
      expect(state.logs).toHaveLength(4); // Only logs after snapshot
      expect(state.logs[0]?.index).toBe(9);
      expect(state.logs[3]?.index).toBe(12);
      expect(state.term).toBe(1);
      expect(state.votedFor).toBe("node-1");
      expect(state.commitIndex).toBe(8);
    });

    it("should handle conflicting log entries", async () => {
      // Add logs with conflicting terms
      await walEngine.appendLogEntry({
        index: 1,
        term: 1,
        command: { value: "a" },
        timestamp: new Date(),
        checksum: "checksum1",
      });

      await walEngine.appendLogEntry({
        index: 2,
        term: 1,
        command: { value: "b" },
        timestamp: new Date(),
        checksum: "checksum2",
      });

      // Conflicting entry at same index with different term
      await walEngine.appendLogEntry({
        index: 2,
        term: 2,
        command: { value: "c" },
        timestamp: new Date(),
        checksum: "checksum3",
      });

      await walEngine.appendLogEntry({
        index: 3,
        term: 2,
        command: { value: "d" },
        timestamp: new Date(),
        checksum: "checksum4",
      });

      const state = await walRecovery.recover();

      expect(state.logs).toHaveLength(3);
      expect(state.logs[1]?.term).toBe(2); // Should use the later term
      expect(state.logs[1]?.command).toEqual({ value: "c" });
    });

    it("should validate recovered state", async () => {
      // Add non-contiguous logs to trigger validation error
      await walEngine.appendLogEntry({
        index: 1,
        term: 1,
        command: { value: "a" },
        timestamp: new Date(),
        checksum: "checksum1",
      });

      await walEngine.appendLogEntry({
        index: 3, // Gap at index 2
        term: 1,
        command: { value: "c" },
        timestamp: new Date(),
        checksum: "checksum3",
      });

      await expect(walRecovery.recover()).rejects.toThrow(
        "Non-contiguous logs detected",
      );
    });

    it("should adjust invalid commitIndex", async () => {
      // Write metadata with commitIndex higher than last log
      await walEngine.appendMetadata({
        term: 1,
        votedFor: null,
        commitIndex: 100, // No logs exist at this index
      });

      const state = await walRecovery.recover();

      expect(state.commitIndex).toBe(0); // Adjusted to last log index
    });
  });

  describe("replayFromSequence", () => {
    it("should replay entries from given sequence", async () => {
      // Add multiple entries
      for (let i = 1; i <= 5; i++) {
        await walEngine.appendLogEntry({
          index: i,
          term: 1,
          command: { index: i },
          timestamp: new Date(),
          checksum: `checksum${i}`,
        });
      }

      const replayedEntries: any[] = [];
      await walRecovery.replayFromSequence(3, async (entry) => {
        replayedEntries.push(entry);
      });

      expect(replayedEntries).toHaveLength(3); // Sequences 3, 4, 5
      expect(replayedEntries[0]?.sequence).toBe(3);
      expect(replayedEntries[2]?.sequence).toBe(5);
    });

    it("should handle replay errors", async () => {
      await walEngine.appendLogEntry({
        index: 1,
        term: 1,
        command: { value: "test" },
        timestamp: new Date(),
        checksum: "checksum",
      });

      const failingCallback = async () => {
        throw new Error("Replay failed");
      };

      await expect(
        walRecovery.replayFromSequence(1, failingCallback),
      ).rejects.toThrow("Replay failed");
    });
  });
});
