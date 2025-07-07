import { Injectable } from "@nestjs/common";
import type { StateMachine } from "@usex/raft";
import type { EncryptionService } from "../encryption/encryption.service";
import type { RedisConfig } from "../shared";
import { RedisConfigFactory } from "../shared";
import type { Redis } from "ioredis";

export interface KVOperation {
  type: "SET" | "DELETE";
  key: string;
  value?: string;
}

export interface KVSnapshot {
  data: Record<string, string>;
  timestamp: number;
}

@Injectable()
export class KVStateMachine implements StateMachine {
  private redis: Redis;

  constructor(
    private readonly encryptionService: EncryptionService,
    redisConfig: RedisConfig,
  ) {
    this.redis = RedisConfigFactory.createRedisInstance(redisConfig);
  }

  async apply(command: any): Promise<void> {
    const operation: KVOperation = JSON.parse(command);

    switch (operation.type) {
      case "SET": {
        if (!operation.value) {
          throw new Error("Value is required for SET operation");
        }
        const encryptedValue = this.encryptionService.encrypt(operation.value);
        await this.redis.set(operation.key, encryptedValue);
        break;
      }

      case "DELETE":
        await this.redis.del(operation.key);
        break;

      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  async getSnapshotData(): Promise<Buffer> {
    const keys = await this.redis.keys("*");
    const data: Record<string, string> = {};

    for (const key of keys) {
      const value = await this.redis.get(key);
      if (value) {
        data[key] = value;
      }
    }

    const snapshot: KVSnapshot = {
      data,
      timestamp: Date.now(),
    };

    return Buffer.from(JSON.stringify(snapshot));
  }

  async applySnapshot(data: Buffer): Promise<void> {
    const snapshot: KVSnapshot = JSON.parse(data.toString());

    await this.redis.flushdb();

    for (const [key, value] of Object.entries(snapshot.data)) {
      await this.redis.set(key, value);
    }
  }

  async getValue(key: string): Promise<string | null> {
    const encryptedValue = await this.redis.get(key);
    if (!encryptedValue) return null;
    return this.encryptionService.decrypt(encryptedValue);
  }

  async listKeys(): Promise<string[]> {
    return this.redis.keys("*");
  }

  async cleanup(): Promise<void> {
    await this.redis.quit();
  }
}
