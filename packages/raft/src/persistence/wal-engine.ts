import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type { LogEntry } from "../types/log";
import type {
  WALStats,
  WALSnapshot,
  WALSegment,
  WALOptions,
  WALMetadata,
  WALEntry,
} from "./wal-types";
import { WALSegmentStatus, WALEntryType } from "./wal-types";
import type { RaftLogger } from "../services/logger";

export class WALEngine extends EventEmitter {
  private readonly options: WALOptions;
  private readonly logger: RaftLogger;
  private segments: Map<string, WALSegment> = new Map();
  private activeSegment: WALSegment | null = null;
  private sequence = 0;
  private fileHandles: Map<string, fs.FileHandle> = new Map();
  private syncTimer: NodeJS.Timeout | null = null;
  private readonly pendingWrites: WALEntry[] = [];

  constructor(options: WALOptions, logger: RaftLogger) {
    super();
    this.options = options;
    this.logger = logger;
  }

  public async initialize(): Promise<void> {
    await this.ensureDirectoryExists();
    await this.loadSegments();
    await this.recoverSequence();
    this.startSyncTimer();
  }

  public async appendLogEntry(entry: LogEntry): Promise<void> {
    const walEntry: WALEntry = {
      sequence: ++this.sequence,
      timestamp: Date.now(),
      type: WALEntryType.LOG_ENTRY,
      data: entry,
      checksum: this.calculateChecksum(entry),
    };

    await this.writeEntry(walEntry);
  }

  public async appendSnapshot(snapshot: WALSnapshot): Promise<void> {
    const walEntry: WALEntry = {
      sequence: ++this.sequence,
      timestamp: Date.now(),
      type: WALEntryType.SNAPSHOT,
      data: snapshot,
      checksum: this.calculateChecksum(snapshot),
    };

    await this.writeEntry(walEntry);
  }

  public async appendMetadata(metadata: WALMetadata): Promise<void> {
    const walEntry: WALEntry = {
      sequence: ++this.sequence,
      timestamp: Date.now(),
      type: WALEntryType.METADATA,
      data: metadata,
      checksum: this.calculateChecksum(metadata),
    };

    await this.writeEntry(walEntry);
  }

  public async readEntries(
    startSequence: number,
    endSequence?: number,
  ): Promise<WALEntry[]> {
    const entries: WALEntry[] = [];
    const segments = this.getSegmentsInRange(startSequence, endSequence);

    for (const segment of segments) {
      const segmentEntries = await this.readSegment(segment);
      entries.push(
        ...segmentEntries.filter(
          (entry) =>
            entry.sequence >= startSequence &&
            (!endSequence || entry.sequence <= endSequence),
        ),
      );
    }

    return entries.sort((a, b) => a.sequence - b.sequence);
  }

  public async truncate(beforeSequence: number): Promise<void> {
    const segmentsToRemove: string[] = [];

    for (const [id, segment] of this.segments) {
      if (segment.endSequence < beforeSequence) {
        segmentsToRemove.push(id);
      }
    }

    for (const id of segmentsToRemove) {
      await this.removeSegment(id);
    }

    this.logger.info("WAL truncated", {
      beforeSequence,
      removedSegments: segmentsToRemove.length,
    });
  }

  public async compact(): Promise<void> {
    const totalSize = await this.getTotalSize();
    if (totalSize < this.options.maxWalSize) {
      return;
    }

    const segments = Array.from(this.segments.values())
      .filter((s) => s.status === WALSegmentStatus.SEALED)
      .sort((a, b) => a.startSequence - b.startSequence);

    const segmentsToCompact = segments.slice(
      0,
      Math.floor(segments.length / 2),
    );

    for (const segment of segmentsToCompact) {
      segment.status = WALSegmentStatus.COMPACTED;
      await this.updateSegmentMetadata(segment);
    }

    this.emit("compaction", { segments: segmentsToCompact.length });
  }

  public async sync(): Promise<void> {
    if (this.pendingWrites.length === 0) {
      return;
    }

    const entriesToWrite = [...this.pendingWrites];
    this.pendingWrites.length = 0;

    for (const entry of entriesToWrite) {
      await this.persistEntry(entry);
    }

    await this.fsync();
  }

  public async close(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    await this.sync();

    for (const [, handle] of this.fileHandles) {
      await handle.close();
    }
    this.fileHandles.clear();
  }

  public async getStats(): Promise<WALStats> {
    const totalSize = await this.getTotalSize();
    const entries = await this.countEntries();

    return {
      totalEntries: entries,
      totalSize,
      segmentCount: this.segments.size,
      oldestSequence: Math.min(
        ...Array.from(this.segments.values()).map((s) => s.startSequence),
      ),
      newestSequence: this.sequence,
      lastCompaction: null,
    };
  }

  private async ensureDirectoryExists(): Promise<void> {
    await fs.mkdir(this.options.dataDir, { recursive: true });
  }

  private async loadSegments(): Promise<void> {
    const files = await fs.readdir(this.options.dataDir);
    const segmentFiles = files.filter((f) => f.endsWith(".wal"));

    for (const file of segmentFiles) {
      const metadata = await this.readSegmentMetadata(file);
      if (metadata) {
        this.segments.set(metadata.id, metadata);
      }
    }
  }

  private async recoverSequence(): Promise<void> {
    let maxSequence = 0;

    for (const segment of this.segments.values()) {
      if (segment.endSequence > maxSequence) {
        maxSequence = segment.endSequence;
      }
    }

    this.sequence = maxSequence;
  }

  private async writeEntry(entry: WALEntry): Promise<void> {
    if (!this.activeSegment || (await this.shouldRotate())) {
      await this.rotateSegment();
    }

    this.pendingWrites.push(entry);

    if (this.options.syncInterval === 0) {
      await this.sync();
    }
  }

  private async persistEntry(entry: WALEntry): Promise<void> {
    if (!this.activeSegment) {
      throw new Error("No active segment");
    }

    const segmentPath = this.getSegmentPath(this.activeSegment.id);
    const handle = await this.getFileHandle(segmentPath);

    const data = `${JSON.stringify(entry)}\n`;
    const buffer = Buffer.from(data, "utf-8");

    await handle.appendFile(buffer);

    this.activeSegment.endSequence = entry.sequence;
    this.activeSegment.size += buffer.length;
  }

  private async rotateSegment(): Promise<void> {
    if (this.activeSegment) {
      this.activeSegment.status = WALSegmentStatus.SEALED;
      await this.updateSegmentMetadata(this.activeSegment);
    }

    const newSegment: WALSegment = {
      id: `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      startSequence: this.sequence + 1,
      endSequence: this.sequence + 1,
      size: 0,
      createdAt: new Date(),
      status: WALSegmentStatus.ACTIVE,
    };

    this.segments.set(newSegment.id, newSegment);
    this.activeSegment = newSegment;

    // Create empty WAL file
    const segmentPath = this.getSegmentPath(newSegment.id);
    await fs.writeFile(segmentPath, "");

    await this.writeSegmentMetadata(newSegment);
  }

  private async shouldRotate(): Promise<boolean> {
    if (!this.activeSegment) {
      return true;
    }

    return this.activeSegment.size >= this.options.maxSegmentSize;
  }

  private async readSegment(segment: WALSegment): Promise<WALEntry[]> {
    const segmentPath = this.getSegmentPath(segment.id);

    try {
      const content = await fs.readFile(segmentPath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());

      const entries: WALEntry[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as WALEntry;
          if (this.options.checksumEnabled && !this.verifyChecksum(entry)) {
            this.logger.warn("Checksum verification failed", {
              sequence: entry.sequence,
            });
            continue;
          }
          entries.push(entry);
        } catch (error) {
          this.logger.error("Failed to parse WAL entry", { error, line });
        }
      }

      return entries;
    } catch (error) {
      // File doesn't exist yet - return empty array
      if ((error as any).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async removeSegment(segmentId: string): Promise<void> {
    const segment = this.segments.get(segmentId);
    if (!segment) {
      return;
    }

    const segmentPath = this.getSegmentPath(segmentId);
    const metadataPath = this.getMetadataPath(segmentId);

    try {
      await fs.unlink(segmentPath);
      await fs.unlink(metadataPath);
      this.segments.delete(segmentId);

      const handle = this.fileHandles.get(segmentPath);
      if (handle) {
        await handle.close();
        this.fileHandles.delete(segmentPath);
      }
    } catch (error) {
      this.logger.error("Failed to remove segment", { error, segmentId });
    }
  }

  private async getFileHandle(filePath: string): Promise<fs.FileHandle> {
    let handle = this.fileHandles.get(filePath);
    if (!handle) {
      handle = await fs.open(filePath, "a");
      this.fileHandles.set(filePath, handle);
    }
    return handle;
  }

  private async fsync(): Promise<void> {
    for (const handle of this.fileHandles.values()) {
      await handle.sync();
    }
  }

  private getSegmentPath(segmentId: string): string {
    return path.join(this.options.dataDir, `${segmentId}.wal`);
  }

  private getMetadataPath(segmentId: string): string {
    return path.join(this.options.dataDir, `${segmentId}.meta`);
  }

  private async writeSegmentMetadata(segment: WALSegment): Promise<void> {
    const metadataPath = this.getMetadataPath(segment.id);
    await fs.writeFile(metadataPath, JSON.stringify(segment, null, 2));
  }

  private async updateSegmentMetadata(segment: WALSegment): Promise<void> {
    await this.writeSegmentMetadata(segment);
  }

  private async readSegmentMetadata(
    filename: string,
  ): Promise<WALSegment | null> {
    try {
      const segmentId = filename.replace(".wal", "");
      const metadataPath = this.getMetadataPath(segmentId);
      const content = await fs.readFile(metadataPath, "utf-8");
      return JSON.parse(content) as WALSegment;
    } catch (error) {
      this.logger.error("Failed to read segment metadata", { error, filename });
      return null;
    }
  }

  private getSegmentsInRange(
    startSequence: number,
    endSequence?: number,
  ): WALSegment[] {
    return Array.from(this.segments.values()).filter((segment) => {
      const overlapsStart = segment.endSequence >= startSequence;
      const overlapsEnd = !endSequence || segment.startSequence <= endSequence;
      return overlapsStart && overlapsEnd;
    });
  }

  private async getTotalSize(): Promise<number> {
    let totalSize = 0;
    for (const segment of this.segments.values()) {
      totalSize += segment.size;
    }
    return totalSize;
  }

  private async countEntries(): Promise<number> {
    let count = 0;
    for (const segment of this.segments.values()) {
      const entries = await this.readSegment(segment);
      count += entries.length;
    }
    return count;
  }

  private calculateChecksum(data: unknown): string {
    if (!this.options.checksumEnabled) {
      return "";
    }
    const hash = crypto.createHash("sha256");
    hash.update(JSON.stringify(data));
    return hash.digest("hex");
  }

  private verifyChecksum(entry: WALEntry): boolean {
    if (!this.options.checksumEnabled) {
      return true;
    }
    const calculatedChecksum = this.calculateChecksum(entry.data);
    return calculatedChecksum === entry.checksum;
  }

  private startSyncTimer(): void {
    if (this.options.syncInterval > 0) {
      this.syncTimer = setInterval(() => {
        this.sync().catch((error) => {
          this.logger.error("WAL sync failed", { error });
        });
      }, this.options.syncInterval);
    }
  }
}
