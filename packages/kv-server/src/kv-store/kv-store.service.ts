import { Injectable, Logger } from '@nestjs/common';
import { StateMachine, LogEntry, RaftCommandType } from '@usex/raft';
import { KvCommandType, SetCommandPayload, DeleteCommandPayload, KvLogEntryApplicationPayload } from '../raft/kv-commands';
import { Buffer } from 'buffer'; // Explicit import for Buffer

@Injectable()
export class KvStoreService implements StateMachine {
  private readonly logger = new Logger(KvStoreService.name);
  private store = new Map<string, string>(); // Key: string, Value: (eventually encrypted) string

  constructor() {
    this.logger.log('KvStoreService initialized');
  }

  // --- StateMachine Implementation ---

  async apply(logEntry: LogEntry): Promise<void> {
    this.logger.debug(`Applying log entry: Index=${logEntry.index}, Type=${logEntry.commandType}`);

    if (logEntry.commandType !== RaftCommandType.APPLICATION) {
      this.logger.warn(`KvStoreService received non-application command type: ${logEntry.commandType} for entry index ${logEntry.index}. Ignoring.`);
      return;
    }

    // Assuming commandPayload for APPLICATION type is KvLogEntryApplicationPayload
    const appPayload = logEntry.commandPayload as KvLogEntryApplicationPayload;

    if (!appPayload || !appPayload.type || appPayload.payload === undefined) {
        this.logger.error(`Invalid application payload structure for entry index ${logEntry.index}`, { payload: appPayload });
        return;
    }

    switch (appPayload.type) {
      case KvCommandType.SET:
        const setPayload = appPayload.payload as SetCommandPayload;
        if (setPayload.key === undefined || setPayload.value === undefined) {
            this.logger.error(`Invalid SET command payload for entry index ${logEntry.index}`, { payload: setPayload });
            return;
        }
        this.store.set(setPayload.key, setPayload.value);
        this.logger.log(`Applied SET: key=${setPayload.key}, index=${logEntry.index}`);
        break;
      case KvCommandType.DELETE:
        const deletePayload = appPayload.payload as DeleteCommandPayload;
        if (deletePayload.key === undefined) {
            this.logger.error(`Invalid DELETE command payload for entry index ${logEntry.index}`, { payload: deletePayload });
            return;
        }
        this.store.delete(deletePayload.key);
        this.logger.log(`Applied DELETE: key=${deletePayload.key}, index=${logEntry.index}`);
        break;
      default:
        // This should ideally be caught by type checking if appPayload.type is strictly KvCommandType
        // However, to be safe with 'any' type from logEntry.commandPayload:
        const unknownType = appPayload.type as string;
        this.logger.warn(`Unknown KvCommandType: ${unknownType} for entry index ${logEntry.index}`);
    }
  }

  async getSnapshotData(): Promise<Buffer> {
    this.logger.log('Creating snapshot of KV store');
    // Sort entries by key to ensure deterministic snapshots if order matters (it does for string comparison of snapshots)
    const sortedEntries = Array.from(this.store.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const data = JSON.stringify(sortedEntries);
    return Buffer.from(data);
  }

  async applySnapshot(data: Buffer): Promise<void> {
    this.logger.log('Applying snapshot to KV store');
    try {
      const snapshotString = data.toString();
      if (!snapshotString) {
          this.logger.warn("Received empty snapshot data. Initializing with an empty store.");
          this.store = new Map<string, string>();
          return;
      }
      const snapshotArray: [string, string][] = JSON.parse(snapshotString);
      this.store = new Map<string, string>(snapshotArray);
      this.logger.log(`Snapshot applied, store now has ${this.store.size} entries.`);
    } catch (error) {
      this.logger.error('Failed to parse or apply snapshot data.', { error: error.message, dataPreview: data.toString().substring(0, 100) });
      // Depending on policy, might re-throw or initialize to empty state
      this.store = new Map<string, string>(); // Initialize to empty on error to prevent corruption
      // throw new Error("Failed to apply snapshot: invalid data format");
    }
  }

  // --- Public KV Store Methods (to be called by AppController/Service later) ---

  get(key: string): string | undefined {
    // Value will be decrypted here eventually
    this.logger.debug(`Getting value for key: ${key}`);
    return this.store.get(key);
  }

  // The actual set and delete operations will be initiated via Raft proposal,
  // not by direct calls to these methods modifying the store.
  // These public methods (set/delete) will be added later and will interact with RaftNode.appendLog().
}
