import { it, expect, describe, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WALEngine } from "../../src/persistence/wal-engine";
import type {
  WALSnapshot,
  WALOptions,
  WALMetadata,
} from "../../src/persistence";
import type { LogEntry } from "../../src/types";
import { RaftCommandType } from "../../src/types";
import { RaftLogger } from "../../src/services";
import { LogLevel } from "../../src/constants";

describe("wALEngine", () => {
  let walEngine: WALEngine;
  let logger: RaftLogger;
  const testDataDir = "/tmp/raft-wal-test";

  const walOptions: WALOptions = {
    dataDir: testDataDir,
    maxSegmentSize: 1024 * 1024, // 1MB
    maxWalSize: 10 * 1024 * 1024, // 10MB
    syncInterval: 100,
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
  });

  afterEach(async () => {
    await walEngine.close();
    // Clean up test directory
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe("appendLogEntry", () => {
    it("should append log entries successfully", async () => {
      const logEntry: LogEntry = {
        index: 1,
        term: 1,
        commandType: RaftCommandType.APPLICATION,
        commandPayload: { type: "SET", key: "foo", value: "bar" },
        timestamp: new Date(),
        checksum: "test-checksum",
      };

      await walEngine.appendLogEntry(logEntry);

      const entries = await walEngine.readEntries(0);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.data).toEqual(logEntry);
    });

    it("should preserve order of multiple entries", async () => {
      const entries: LogEntry[] = [];
      for (let i = 0; i < 5; i++) {
        const entry: LogEntry = {
          index: i,
          term: 1,
          commandType: RaftCommandType.APPLICATION,
          commandPayload: { type: "SET", key: `key${i}`, value: `value${i}` },
          timestamp: new Date(),
          checksum: `checksum${i}`,
        };
        entries.push(entry);
        await walEngine.appendLogEntry(entry);
      }

      const readEntries = await walEngine.readEntries(0);
      expect(readEntries).toHaveLength(5);

      for (let i = 0; i < 5; i++) {
        expect(readEntries[i]!.data).toEqual(entries[i]);
        expect(readEntries[i]!.sequence).toBe(i + 1);
      }
    });
  });

  describe("appendSnapshot", () => {
    it("should append snapshot successfully", async () => {
      const snapshot: WALSnapshot = {
        lastIncludedIndex: 100,
        lastIncludedTerm: 5,
        data: Buffer.from("snapshot-data"),
        stateData: {
          term: 5,
          votedFor: "node-1",
          commitIndex: 100,
        },
      };

      await walEngine.appendSnapshot(snapshot);

      const entries = await walEngine.readEntries(0);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.data).toEqual(snapshot);
    });
  });

  describe("appendMetadata", () => {
    it("should append metadata successfully", async () => {
      const metadata: WALMetadata = {
        term: 3,
        votedFor: "node-2",
        commitIndex: 50,
      };

      await walEngine.appendMetadata(metadata);

      const entries = await walEngine.readEntries(0);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.data).toEqual(metadata);
    });
  });

  describe("readEntries", () => {
    it("should read entries within range", async () => {
      // Append 10 entries
      for (let i = 0; i < 10; i++) {
        const entry: LogEntry = {
          index: i,
          term: 1,
          commandType: RaftCommandType.APPLICATION,
          commandPayload: { index: i },
          timestamp: new Date(),
          checksum: `checksum${i}`,
        };
        await walEngine.appendLogEntry(entry);
      }

      // Read middle range
      const entries = await walEngine.readEntries(3, 7);
      expect(entries).toHaveLength(5);
      expect(entries[0]!.sequence).toBe(3);
      expect(entries[4]!.sequence).toBe(7);
    });

    it("should return empty array for out of range", async () => {
      const entries = await walEngine.readEntries(100, 200);
      expect(entries).toHaveLength(0);
    });
  });

  describe("truncate", () => {
    it("should truncate entries before given sequence", async () => {
      // Append 10 entries
      for (let i = 0; i < 10; i++) {
        const entry: LogEntry = {
          index: i,
          term: 1,
          commandType: RaftCommandType.APPLICATION,
          commandPayload: { index: i },
          timestamp: new Date(),
          checksum: `checksum${i}`,
        };
        await walEngine.appendLogEntry(entry);
      }

      await walEngine.sync();
      await walEngine.truncate(5);

      const remainingEntries = await walEngine.readEntries(0);
      expect(remainingEntries.every((e) => e.sequence >= 5)).toBe(true);
    });
  });

  describe("truncateLogEntriesBefore", () => {
    it("should truncate log entries before given index", async () => {
      // Append 10 entries with different indices
      for (let i = 0; i < 10; i++) {
        const entry: LogEntry = {
          index: i + 100, // Using offset to distinguish from sequence
          term: 1,
          commandType: RaftCommandType.APPLICATION,
          commandPayload: { index: i },
          timestamp: new Date(),
          checksum: `checksum${i}`,
        };
        await walEngine.appendLogEntry(entry);
      }

      await walEngine.sync();
      await walEngine.truncateLogEntriesBefore(105); // Should remove entries with index < 105

      const remainingEntries = await walEngine.readEntries(0);
      // Filter to only get LOG_ENTRY type entries
      const logEntries = remainingEntries.filter((e) => e.type === "LOG_ENTRY");

      // Verify all remaining log entries have index >= 105
      expect(logEntries.every((e) => (e.data as LogEntry).index >= 105)).toBe(
        true,
      );
      // Verify entries with index < 105 were removed
      expect(logEntries.some((e) => (e.data as LogEntry).index < 105)).toBe(
        false,
      );
    });
  });

  describe("sync", () => {
    it("should persist pending writes", async () => {
      const entry: LogEntry = {
        index: 1,
        term: 1,
        commandType: RaftCommandType.APPLICATION,
        commandPayload: { data: "x".repeat(50) }, // Large enough to trigger rotation
        timestamp: new Date(),
        checksum: "checksum",
      };

      await walEngine.appendLogEntry(entry);
      await walEngine.sync();

      // Create new instance to verify persistence
      const newEngine = new WALEngine(walOptions, logger);
      await newEngine.initialize();

      const entries = await newEngine.readEntries(0);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.data).toEqual(entry);

      await newEngine.close();
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", async () => {
      // Append some entries
      for (let i = 0; i < 5; i++) {
        const entry: LogEntry = {
          index: i,
          term: 1,
          commandType: RaftCommandType.APPLICATION,
          commandPayload: { index: i },
          timestamp: new Date(),
          checksum: `checksum${i}`,
        };
        await walEngine.appendLogEntry(entry);
      }

      await walEngine.sync();
      const stats = await walEngine.getStats();

      expect(stats.totalEntries).toBe(5);
      expect(stats.segmentCount).toBeGreaterThan(0);
      expect(stats.oldestSequence).toBe(1);
      expect(stats.newestSequence).toBe(5);
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });

  describe("segment rotation", () => {
    it("should rotate segments when size limit is reached", async () => {
      // Use small segment size for testing
      const smallWalOptions: WALOptions = {
        ...walOptions,
        maxSegmentSize: 100, // Very small for testing
      };

      const smallEngine = new WALEngine(smallWalOptions, logger);
      await smallEngine.initialize();

      // Append entries until rotation happens
      for (let i = 0; i < 10; i++) {
        const entry: LogEntry = {
          index: i,
          term: 1,
          commandType: RaftCommandType.APPLICATION,
          commandPayload: { data: "x".repeat(50) }, // Large enough to trigger rotation
          timestamp: new Date(),
          checksum: `checksum${i}`,
        };
        await smallEngine.appendLogEntry(entry);
      }

      await smallEngine.sync();
      const stats = await smallEngine.getStats();

      expect(stats.segmentCount).toBeGreaterThan(1);

      await smallEngine.close();
    });
  });

  describe("checksum validation", () => {
    it("should validate checksums when enabled", async () => {
      const entry: LogEntry = {
        index: 1,
        term: 1,
        commandType: RaftCommandType.APPLICATION,
        commandPayload: { type: "SET" },
        timestamp: new Date(),
        checksum: "valid-checksum",
      };

      await walEngine.appendLogEntry(entry);
      await walEngine.sync();

      // Manually corrupt the WAL file
      const files = await fs.readdir(testDataDir);
      const walFile = files.find((f) => f.endsWith(".wal"));
      if (walFile) {
        const filePath = path.join(testDataDir, walFile);
        let content = await fs.readFile(filePath, "utf-8");
        content = content.replace("valid-checksum", "invalid-checksum");
        await fs.writeFile(filePath, content);
      }

      // Create new engine to read corrupted data
      const newEngine = new WALEngine(walOptions, logger);
      await newEngine.initialize();

      const entries = await newEngine.readEntries(0);
      // Should skip entries with invalid checksums
      expect(entries).toHaveLength(0);

      await newEngine.close();
    });
  });
});
