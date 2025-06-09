import { teardownRedisContainer, setupRedisContainer } from "./testcontainers";
import type { RedisTestContext } from "./testcontainers";

// Global Redis container that will be shared across all tests
let globalRedisContext: RedisTestContext | null = null;

/**
 * Setup a global Redis container for all tests
 * This will be called once before all tests run
 */
export async function setupGlobalRedis(): Promise<RedisTestContext> {
  if (!globalRedisContext) {
    console.log("Setting up global Redis container for tests...");

    try {
      globalRedisContext = await setupRedisContainer();

      // Set environment variables for the Redis connection
      const host = globalRedisContext.container.getHost();
      const port = globalRedisContext.container.getMappedPort(6379);

      process.env.REDIS_HOST = host;
      process.env.REDIS_PORT = port.toString();

      console.log(`Redis container started at ${host}:${port}`);
    } catch (error) {
      console.warn(
        "Failed to setup Redis container:",
        (error as Error).message,
      );

      // Set up minimal mock for unit tests that don't actually need Redis
      process.env.REDIS_HOST = "localhost";
      process.env.REDIS_PORT = "6379";

      globalRedisContext = {
        redis: null as any,
        container: null as any,
        connectionString: null as any,
      };

      console.log("Using mock Redis configuration for unit tests");
    }
  }
  return globalRedisContext;
}

/**
 * Teardown the global Redis container
 * This will be called once after all tests complete
 */
export async function teardownGlobalRedis(): Promise<void> {
  if (globalRedisContext) {
    console.log("Tearing down global Redis container...");

    if (globalRedisContext.container) {
      // Proper Docker container teardown
      await teardownRedisContainer(globalRedisContext);
    }

    globalRedisContext = null;
  }
}

/**
 * Get the global Redis context
 * Throws if Redis is not set up
 */
export function getGlobalRedisContext(): RedisTestContext {
  if (!globalRedisContext) {
    throw new Error(
      "Global Redis container not initialized. Call setupGlobalRedis() first.",
    );
  }
  return globalRedisContext;
}

/**
 * Clear all Redis data between tests
 */
export async function clearRedisData(): Promise<void> {
  const context = getGlobalRedisContext();
  if (context.redis && typeof context.redis.flushall === "function") {
    await context.redis.flushall();
  }
}
