import { it, expect, describe, beforeEach } from "vitest";
import { RaftLog } from "../../src/core/raft-log";
import { RaftValidationException } from "../../src/exceptions";
import type { LogEntry } from "../../src/types";
import { createTestConfig, createMockRedis } from "../shared/test-utils";
import { RaftLogger } from "../../src/services/logger";
import { LogLevel } from "../../src/constants";

describe("raftLog", () => {
  let raftLog: RaftLog;
  let mockRedis: any;
  let logger: RaftLogger;
  let config: any;

  beforeEach(() => {
    mockRedis = createMockRedis();
    logger = new RaftLogger({
      level: LogLevel.ERROR,
      enableConsole: false,
    });
    config = createTestConfig({
      persistence: {
        walEnabled: false,
        enableSnapshots: false,
        snapshotInterval: 1000,
        dataDir: "/tmp/test",
        walSizeLimit: 1000000,
      },
    });
    raftLog = new RaftLog(mockRedis, "test-node", logger, config);
  });

  describe("appendEntry", () => {
    it("should append entries with correct index", async () => {
      await raftLog.appendEntry(1, { cmd: "set", key: "a", value: "1" });
      await raftLog.appendEntry(1, { cmd: "set", key: "b", value: "2" });

      expect(raftLog.getLength()).toBe(2);
      expect(raftLog.getEntry(0)?.command).toEqual({
        cmd: "set",
        key: "a",
        value: "1",
      });
      expect(raftLog.getEntry(1)?.command).toEqual({
        cmd: "set",
        key: "b",
        value: "2",
      });
    });

    it("should calculate checksum for entries", async () => {
      await raftLog.appendEntry(1, { cmd: "set", key: "a", value: "1" });
      const entry = raftLog.getEntry(0);

      expect(entry).toBeDefined();
      expect(entry?.checksum).toBeDefined();
      expect(entry?.checksum).toHaveLength(64); // SHA256 hex length
    });

    it("should persist entries to storage", async () => {
      await raftLog.appendEntry(1, { cmd: "set", key: "a", value: "1" });

      expect(mockRedis.set).toHaveBeenCalledWith(
        "test-node:log:0",
        expect.stringContaining("\"term\":1"),
      );
    });
  });

  describe("appendEntries", () => {
    it("should append multiple entries", async () => {
      const entries: LogEntry[] = [
        {
          term: 1,
          index: 0,
          command: { cmd: "set", key: "a", value: "1" },
          timestamp: new Date(),
          checksum: "hash1",
        },
        {
          term: 1,
          index: 1,
          command: { cmd: "set", key: "b", value: "2" },
          timestamp: new Date(),
          checksum: "hash2",
        },
      ];

      await raftLog.appendEntries(entries, -1);
      expect(raftLog.getLength()).toBe(2);
    });

    it("should handle conflicting entries", async () => {
      await raftLog.appendEntry(1, { cmd: "set", key: "a", value: "1" });
      await raftLog.appendEntry(1, { cmd: "set", key: "b", value: "2" });

      const newEntries: LogEntry[] = [
        {
          term: 2,
          index: 1,
          command: { cmd: "set", key: "c", value: "3" },
          timestamp: new Date(),
          checksum: "hash3",
        },
      ];

      await raftLog.appendEntries(newEntries, 0);
      expect(raftLog.getLength()).toBe(2);
      expect(raftLog.getEntry(1)?.command).toEqual({
        cmd: "set",
        key: "c",
        value: "3",
      });
    });

    it("should validate previous log entry", async () => {
      await raftLog.appendEntry(1, { cmd: "set", key: "a", value: "1" });

      const newEntries: LogEntry[] = [
        {
          term: 2,
          index: 1,
          command: { cmd: "set", key: "b", value: "2" },
          timestamp: new Date(),
          checksum: "hash2",
        },
      ];

      await expect(raftLog.appendEntries(newEntries, 0)).rejects.toThrow(
        RaftValidationException,
      );
    });
  });

  describe("getters", () => {
    it("should get entry by index", async () => {
      await raftLog.appendEntry(1, { cmd: "set", key: "a", value: "1" });
      const entry = raftLog.getEntry(0);

      expect(entry).toBeDefined();
      expect(entry?.term).toBe(1);
      expect(entry?.command).toEqual({ cmd: "set", key: "a", value: "1" });
    });

    it("should get entries range", async () => {
      await raftLog.appendEntry(1, { cmd: "set", key: "a", value: "1" });
      await raftLog.appendEntry(1, { cmd: "set", key: "b", value: "2" });
      await raftLog.appendEntry(2, { cmd: "set", key: "c", value: "3" });

      const entries = raftLog.getEntries(1, 3);
      expect(entries).toHaveLength(2);
      expect(entries[0]?.command).toEqual({ cmd: "set", key: "b", value: "2" });
      expect(entries[1]?.command).toEqual({ cmd: "set", key: "c", value: "3" });
    });

    it("should get last entry", async () => {
      await raftLog.appendEntry(1, { cmd: "set", key: "a", value: "1" });
      await raftLog.appendEntry(2, { cmd: "set", key: "b", value: "2" });

      const lastEntry = raftLog.getLastEntry();
      expect(lastEntry?.term).toBe(2);
      expect(lastEntry?.command).toEqual({ cmd: "set", key: "b", value: "2" });
    });

    it("should get last index and term", async () => {
      await raftLog.appendEntry(1, { cmd: "set", key: "a", value: "1" });
      await raftLog.appendEntry(2, { cmd: "set", key: "b", value: "2" });

      expect(raftLog.getLastIndex()).toBe(1);
      expect(raftLog.getLastTerm()).toBe(2);
    });
  });

  describe("loadFromStorage", () => {
    it("should load entries from storage", async () => {
      const storedEntries = [
        JSON.stringify({
          term: 1,
          index: 0,
          command: { cmd: "set", key: "a", value: "1" },
          timestamp: new Date(),
          checksum: "hash1",
        }),
        JSON.stringify({
          term: 1,
          index: 1,
          command: { cmd: "set", key: "b", value: "2" },
          timestamp: new Date(),
          checksum: "hash2",
        }),
      ];

      mockRedis.keys.mockResolvedValue(["test-node:log:0", "test-node:log:1"]);
      mockRedis.mget.mockResolvedValue(storedEntries);

      await raftLog.loadFromStorage();
      expect(raftLog.getLength()).toBe(2);
      // Logger functionality is tested by verifying the log was loaded correctly
    });

    it("should handle storage errors", async () => {
      mockRedis.keys.mockRejectedValue(new Error("Storage error"));

      await raftLog.loadFromStorage();
      expect(raftLog.getLength()).toBe(0);
      // Error handling is tested by verifying the log remains empty
    });
  });
});
