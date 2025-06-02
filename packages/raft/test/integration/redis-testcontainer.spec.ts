import { it, expect, describe, beforeEach, beforeAll, afterAll } from "vitest";
import type Redis from "ioredis";
import {
  teardownRedisContainer,
  setupRedisContainer,
} from "../shared/testcontainers";
import type { RedisTestContext } from "../shared/testcontainers";

describe("redis container integration", { timeout: 60_000 }, () => {
  describe("basic redis operations", () => {
    let redisContext: RedisTestContext;
    let redis: Redis;

    beforeAll(async () => {
      redisContext = await setupRedisContainer();
      redis = redisContext.redis;
    });

    afterAll(async () => {
      await teardownRedisContainer(redisContext);
    });

    beforeEach(async () => {
      await redis.flushall();
    });

    it("should handle basic key-value operations", async () => {
      await redis.set("test-key", "test-value");
      const result = await redis.get("test-key");
      expect(result).toBe("test-value");
    });

    it("should handle lists", async () => {
      await redis.lpush("mylist", "world", "hello");
      const list = await redis.lrange("mylist", 0, -1);
      expect(list).toEqual(["hello", "world"]);
    });

    it("should handle sets", async () => {
      await redis.sadd("myset", "member1", "member2", "member3");
      const members = await redis.smembers("myset");
      expect(members).toContain("member1");
      expect(members).toContain("member2");
      expect(members).toContain("member3");
    });

    it("should handle sorted sets", async () => {
      await redis.zadd("myzset", 1, "one", 2, "two", 3, "three");
      const range = await redis.zrange("myzset", 0, -1);
      expect(range).toEqual(["one", "two", "three"]);
    });

    it("should handle hashes", async () => {
      await redis.hset("myhash", "field1", "value1", "field2", "value2");
      const value = await redis.hget("myhash", "field1");
      expect(value).toBe("value1");

      const all = await redis.hgetall("myhash");
      expect(all).toEqual({ field1: "value1", field2: "value2" });
    });

    it("should handle TTL", async () => {
      await redis.setex("expiring-key", 2, "will-expire");
      const ttl = await redis.ttl("expiring-key");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(2);
    });

    it("should handle pub/sub", async () => {
      const subscriber = redis.duplicate();
      const messages: string[] = [];

      await subscriber.subscribe("test-channel");
      subscriber.on("message", (channel, message) => {
        messages.push(message);
      });

      await redis.publish("test-channel", "test-message");
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages).toContain("test-message");
      await subscriber.quit();
    });

    it("should handle transactions", async () => {
      const multi = redis.multi();
      multi.set("key1", "value1");
      multi.set("key2", "value2");
      multi.get("key1");
      multi.get("key2");

      const results = await multi.exec();
      expect(results).toBeDefined();
      expect(results![2]![1]).toBe("value1");
      expect(results![3]![1]).toBe("value2");
    });

    it("should handle pipeline", async () => {
      const pipeline = redis.pipeline();
      pipeline.set("pipe1", "value1");
      pipeline.set("pipe2", "value2");
      pipeline.get("pipe1");
      pipeline.get("pipe2");

      const results = await pipeline.exec();
      expect(results).toBeDefined();
      expect(results![2]![1]).toBe("value1");
      expect(results![3]![1]).toBe("value2");
    });

    it("should handle Lua scripting", async () => {
      const script = `
        local key = KEYS[1]
        local value = ARGV[1]
        redis.call('set', key, value)
        return redis.call('get', key)
      `;

      const result = await redis.eval(script, 1, "script-key", "script-value");
      expect(result).toBe("script-value");
    });
  });

  describe("Redis with Authentication", () => {
    let redisContext: RedisTestContext;
    let redis: Redis;

    beforeAll(async () => {
      redisContext = await setupRedisContainer({ password: "secure-password" });
      redis = redisContext.redis;
    });

    afterAll(async () => {
      await teardownRedisContainer(redisContext);
    });

    it("should connect with authentication", async () => {
      await redis.set("auth-key", "auth-value");
      const result = await redis.get("auth-key");
      expect(result).toBe("auth-value");
    });

    it("should have password in connection string", () => {
      expect(redisContext.connectionString).toContain(":secure-password@");
    });
  });

  describe("redis CLI Commands", () => {
    let redisContext: RedisTestContext;

    beforeAll(async () => {
      redisContext = await setupRedisContainer();
    });

    afterAll(async () => {
      await teardownRedisContainer(redisContext);
    });

    it("should execute INFO command", async () => {
      const result = await redisContext.container.executeCliCmd("INFO", [
        "server",
      ]);
      expect(result).toContain("redis_version:");
      expect(result).toContain("tcp_port:6379");
    });

    it("should execute CONFIG GET command", async () => {
      const result = await redisContext.container.executeCliCmd("CONFIG", [
        "GET",
        "maxmemory",
      ]);
      expect(result).toContain("maxmemory");
    });
  });

  describe("Raft-specific Redis Patterns", () => {
    let redisContext: RedisTestContext;
    let redis: Redis;

    beforeAll(async () => {
      redisContext = await setupRedisContainer();
      redis = redisContext.redis;
    });

    afterAll(async () => {
      await teardownRedisContainer(redisContext);
    });

    beforeEach(async () => {
      await redis.flushall();
    });

    it("should handle log entries with sorted sets", async () => {
      const entries = [
        { term: 1, index: 1, command: "SET x 1", timestamp: Date.now() },
        { term: 1, index: 2, command: "SET y 2", timestamp: Date.now() + 1 },
        { term: 2, index: 3, command: "SET z 3", timestamp: Date.now() + 2 },
      ];

      for (const entry of entries) {
        await redis.zadd("raft:node1:log", entry.index, JSON.stringify(entry));
      }

      const logs = await redis.zrange("raft:node1:log", 0, -1);
      expect(logs.length).toBe(3);

      const lastEntry = JSON.parse(logs[2]!);
      expect(lastEntry.term).toBe(2);
      expect(lastEntry.command).toBe("SET z 3");
    });

    it("should handle term voting with atomic operations", async () => {
      const nodeId = "node1";
      const term = 5;
      const voteKey = `raft:term:${term}:votedFor`;

      // First vote (should succeed)
      const firstVote = await redis.set(voteKey, nodeId, "NX");
      expect(firstVote).toBe("OK");

      // Second vote attempt (should fail)
      const secondVote = await redis.set(voteKey, "node2", "NX");
      expect(secondVote).toBeNull();

      // Check who got the vote
      const votedFor = await redis.get(voteKey);
      expect(votedFor).toBe(nodeId);
    });

    it("should handle cluster membership with sets", async () => {
      const members = ["node1", "node2", "node3"];

      for (const member of members) {
        await redis.sadd("raft:cluster:members", member);
      }

      const allMembers = await redis.smembers("raft:cluster:members");
      expect(allMembers).toHaveLength(3);
      expect(allMembers).toContain("node1");
      expect(allMembers).toContain("node2");
      expect(allMembers).toContain("node3");

      // Remove a member
      await redis.srem("raft:cluster:members", "node3");
      const remainingMembers = await redis.smembers("raft:cluster:members");
      expect(remainingMembers).toHaveLength(2);
      expect(remainingMembers).not.toContain("node3");
    });

    it("should handle distributed locks for configuration changes", async () => {
      const lockKey = "raft:config:lock";
      const lockValue = `${Date.now()}:${Math.random()}`;
      const ttlMs = 5000;

      // Acquire lock atomically
      const acquired = await redis.set(lockKey, lockValue, "PX", ttlMs, "NX");
      expect(acquired).toBe("OK");

      // Try to acquire again (should fail)
      const secondAttempt = await redis.set(
        lockKey,
        "other-value",
        "PX",
        ttlMs,
        "NX",
      );
      expect(secondAttempt).toBeNull();

      // Release lock with Lua script (only if we own it)
      const releaseLockScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      const released = await redis.eval(
        releaseLockScript,
        1,
        lockKey,
        lockValue,
      );
      expect(released).toBe(1);

      // Verify lock is released
      const lockCheck = await redis.get(lockKey);
      expect(lockCheck).toBeNull();
    });

    it("should handle heartbeat tracking with expiring keys", async () => {
      const nodeId = "node1";
      const heartbeatKey = `raft:heartbeat:${nodeId}`;
      const heartbeatTTL = 2; // seconds

      // Set heartbeat with expiry
      await redis.setex(heartbeatKey, heartbeatTTL, Date.now().toString());

      // Check if node is alive
      const isAlive = await redis.exists(heartbeatKey);
      expect(isAlive).toBe(1);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Check if heartbeat expired
      const isExpired = await redis.exists(heartbeatKey);
      expect(isExpired).toBe(0);
    });
  });
});
