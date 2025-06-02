import { RedisContainer } from "@testcontainers/redis";
import type { StartedRedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RedisTestContext {
  container: StartedRedisContainer;
  redis: Redis;
  connectionString: string;
}

export async function setupRedisContainer(options?: {
  password?: string;
  persistence?: boolean;
  initialDataPath?: string;
}): Promise<RedisTestContext> {
  try {
    console.log("Starting Redis container...");

    let container = new RedisContainer("redis:8-alpine");

    if (options?.password) {
      container = container.withPassword(options.password);
    }

    if (options?.persistence) {
      const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "raft-redis-"));
      container = container.withPersistence(sourcePath);
    }

    if (options?.initialDataPath) {
      container = container.withInitialData(options.initialDataPath);
    }

    const startedContainer = await container.start();
    const connectionString = startedContainer.getConnectionUrl();
    console.log(`Redis container started at ${connectionString}`);

    const redis = new Redis(connectionString, {
      retryStrategy: () => null, // Don't retry in tests
      maxRetriesPerRequest: 1,
      connectTimeout: 10000,
    });

    // Wait for Redis to be ready
    await redis.ping();
    console.log("Redis is ready");

    return {
      container: startedContainer,
      redis,
      connectionString,
    };
  } catch (error) {
    console.error("Failed to setup Redis container:", error);
    throw error;
  }
}

export async function teardownRedisContainer(
  context: RedisTestContext,
): Promise<void> {
  if (context?.redis) {
    await context.redis.quit();
  }
  if (context?.container) {
    await context.container.stop();
  }
}

export async function setupRedisStackContainer(options?: {
  password?: string;
}): Promise<RedisTestContext> {
  try {
    console.log("Starting Redis Stack container...");

    let container = new RedisContainer("redis/redis-stack-server:7.4.0-v4");

    if (options?.password) {
      container = container.withPassword(options.password);
    }

    const startedContainer = await container.start();
    const connectionString = startedContainer.getConnectionUrl();
    console.log(`Redis Stack container started at ${connectionString}`);

    const redis = new Redis(connectionString, {
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      connectTimeout: 10000,
    });

    await redis.ping();
    console.log("Redis Stack is ready");

    return {
      container: startedContainer,
      redis,
      connectionString,
    };
  } catch (error) {
    console.error("Failed to setup Redis Stack container:", error);
    throw error;
  }
}
