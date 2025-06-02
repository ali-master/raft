import { beforeAll, afterAll } from "vitest";
import { teardownGlobalRedis, setupGlobalRedis } from "./shared/test-setup";

// Setup Redis container before all tests
beforeAll(async () => {
  await setupGlobalRedis();
}, 120000); // 2 minute timeout for container startup

// Teardown Redis container after all tests
afterAll(async () => {
  await teardownGlobalRedis();
}, 30000);
