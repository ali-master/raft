import { ConfigService } from "@nestjs/config";
import { vi, it, expect, describe, afterEach } from "vitest";
import { RedisConfigFactory } from "../../src/shared/config/redis.config";

describe("Raft Redis namespace", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    [undefined, "raft:cluster-a:"],
    ["custom:", "custom:"],
    ["", ""],
  ])("preserves the configured prefix %s", (prefix, expected) => {
    vi.stubEnv("RAFT_REDIS_KEY_PREFIX", prefix);
    const config = new ConfigService();
    expect(
      RedisConfigFactory.createRaftConfig(config, "cluster-a").keyPrefix,
    ).toBe(expected);
  });
});
