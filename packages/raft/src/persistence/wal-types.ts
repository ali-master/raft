import type { LogEntry } from "../types/log";

export interface WALEntry {
  sequence: number;
  timestamp: number;
  type: WALEntryType;
  data: LogEntry | WALSnapshot | WALMetadata;
  checksum: string;
}

export enum WALEntryType {
  LOG_ENTRY = "LOG_ENTRY",
  SNAPSHOT = "SNAPSHOT",
  METADATA = "METADATA",
}

export interface WALSnapshot {
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  data: Buffer;
  stateData?: Record<string, unknown>;
  filePath?: string;
}

export interface WALMetadata {
  term: number;
  votedFor: string | null;
  commitIndex: number;
}

export interface WALSegment {
  id: string;
  startSequence: number;
  endSequence: number;
  size: number;
  createdAt: Date;
  status: WALSegmentStatus;
}

export enum WALSegmentStatus {
  ACTIVE = "ACTIVE",
  SEALED = "SEALED",
  COMPACTED = "COMPACTED",
}

export interface WALOptions {
  dataDir: string;
  maxSegmentSize: number;
  maxWalSize: number;
  syncInterval: number;
  compressionEnabled: boolean;
  checksumEnabled: boolean;
}

export interface WALStats {
  totalEntries: number;
  totalSize: number;
  segmentCount: number;
  oldestSequence: number;
  newestSequence: number;
  lastCompaction: Date | null;
}
