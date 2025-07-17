import type { StateMachine } from "@usex/raft";
import Redis from "ioredis";
import { PlaygroundLogger } from "../utils/logger";
import type { UnknownCommand } from "../types/common";

export interface KVCommand {
  type: "set" | "delete" | "clear";
  key?: string;
  value?: string;
  ttl?: number;
  clientId?: string;
}

export interface KVSnapshot {
  data: Record<string, string>;
  timestamp: number;
  version: number;
}

export class KVStateMachine implements StateMachine {
  private redis: Redis;
  private version = 0;
  private logger: PlaygroundLogger;

  constructor(
    private nodeId: string,
    redisConfig: {
      host: string;
      port: number;
      db?: number;
      keyPrefix?: string;
    },
  ) {
    this.logger = new PlaygroundLogger();
    this.redis = new Redis({
      ...redisConfig,
      keyPrefix: `${redisConfig.keyPrefix || "playground:"}${nodeId}:`,
    });
  }

  async apply(commandData: any): Promise<void> {
    const command: KVCommand =
      typeof commandData === "string" ? JSON.parse(commandData) : commandData;

    this.logger.debug(
      `Applying KV command: ${command.type}`,
      this.nodeId,
      command,
    );

    switch (command.type) {
      case "set":
        if (!command.key || command.value === undefined) {
          throw new Error("Set command requires key and value");
        }
        if (command.ttl) {
          await this.redis.setex(command.key, command.ttl, command.value);
        } else {
          await this.redis.set(command.key, command.value);
        }
        break;

      case "delete":
        if (!command.key) {
          throw new Error("Delete command requires key");
        }
        await this.redis.del(command.key);
        break;

      case "clear":
        await this.redis.flushdb();
        break;

      default:
        throw new Error(
          `Unknown KV command type: ${(command as UnknownCommand).type}`,
        );
    }

    this.version++;

    this.logger.info(`KV operation completed: ${command.type}`, this.nodeId, {
      key: command.key,
      version: this.version,
    });
  }

  async getSnapshotData(): Promise<Buffer> {
    const keys = await this.redis.keys("*");
    const data: Record<string, string> = {};

    for (const key of keys) {
      const value = await this.redis.get(key);
      if (value !== null) {
        data[key] = value;
      }
    }

    const snapshot: KVSnapshot = {
      data,
      timestamp: Date.now(),
      version: this.version,
    };

    this.logger.info(
      `Creating KV snapshot with ${keys.length} keys`,
      this.nodeId,
    );
    return Buffer.from(JSON.stringify(snapshot));
  }

  async applySnapshot(data: Buffer): Promise<void> {
    const snapshot: KVSnapshot = JSON.parse(data.toString());

    // Clear existing data
    await this.redis.flushdb();

    // Restore data from snapshot
    for (const [key, value] of Object.entries(snapshot.data)) {
      await this.redis.set(key, value);
    }

    this.version = snapshot.version;

    this.logger.info(
      `Applied KV snapshot with ${Object.keys(snapshot.data).length} keys`,
      this.nodeId,
      { version: this.version },
    );
  }

  // Public methods for playground demonstrations
  async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) === 1;
  }

  async keys(pattern: string = "*"): Promise<string[]> {
    return await this.redis.keys(pattern);
  }

  async size(): Promise<number> {
    return await this.redis.dbsize();
  }

  getVersion(): number {
    return this.version;
  }

  async getState() {
    const keys = await this.keys();
    const data: Record<string, string> = {};

    for (const key of keys) {
      const value = await this.get(key);
      if (value !== null) {
        data[key] = value;
      }
    }

    return {
      data,
      keyCount: keys.length,
      version: this.version,
      nodeId: this.nodeId,
    };
  }

  // Helper methods for creating commands
  createSetCommand(
    key: string,
    value: string,
    ttl?: number,
    clientId?: string,
  ): KVCommand {
    const command: KVCommand = { type: "set", key, value };
    if (ttl !== undefined) {
      command.ttl = ttl;
    }
    if (clientId !== undefined) {
      command.clientId = clientId;
    }
    return command;
  }

  createDeleteCommand(key: string, clientId?: string): KVCommand {
    const command: KVCommand = { type: "delete", key };
    if (clientId !== undefined) {
      command.clientId = clientId;
    }
    return command;
  }

  createClearCommand(clientId?: string): KVCommand {
    const command: KVCommand = { type: "clear" };
    if (clientId !== undefined) {
      command.clientId = clientId;
    }
    return command;
  }

  async cleanup(): Promise<void> {
    await this.redis.quit();
  }
}
