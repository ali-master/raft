# Testing Guide

This guide explains how to run tests for the RAFT library and how to use Testcontainers for integration testing.

## Running Tests

### Basic Test Commands

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Run specific test file
pnpm test peer-discovery.spec.ts
```

## Testcontainers Integration

The RAFT library uses [Testcontainers](https://testcontainers.com/) to provide real Redis instances for integration tests instead of mocks. This ensures tests run against actual Redis behavior.

### Prerequisites

- Docker must be installed and running
- The environment variable `TESTCONTAINERS_RYUK_DISABLED=true` is automatically set by the test script

### Writing Tests with Testcontainers

Here's an example of how to use Testcontainers in your tests:

```typescript
import { setupRedisContainer, teardownRedisContainer, type RedisTestContext } from "../shared/testcontainers";

describe("MyRedisTest", () => {
  let redisContext: RedisTestContext;
  let redis: Redis;

  // Setup single Redis container for all tests in the suite
  beforeAll(async () => {
    redisContext = await setupRedisContainer();
    redis = redisContext.redis;
  }, 30000); // 30 second timeout for container startup

  afterAll(async () => {
    if (redisContext) {
      await teardownRedisContainer(redisContext);
    }
  }, 30000);

  beforeEach(async () => {
    // Clear Redis before each test
    await redis.flushall();
  });

  it("should work with real Redis", async () => {
    await redis.set("key", "value");
    const result = await redis.get("key");
    expect(result).toBe("value");
  });
});
```

### Benefits of Testcontainers

1. **Real Redis Behavior**: Tests run against actual Redis, catching issues that mocks might miss
2. **Isolation**: Each test suite gets its own Redis container
3. **Consistency**: Same Redis version across all environments
4. **No External Dependencies**: No need to install Redis locally

### Troubleshooting

#### Container Startup Timeout

If tests fail with timeout errors, ensure Docker is running:

```bash
docker version
```

#### Port Conflicts

Testcontainers automatically assigns random ports to avoid conflicts.

#### Debugging Container Issues

Enable debug logging:

```bash
DEBUG=testcontainers* pnpm test
```

### Performance Considerations

- Use `beforeAll`/`afterAll` to share containers across tests in a suite
- Clear Redis state with `flushall()` in `beforeEach` instead of creating new containers
- Group related tests to minimize container creation

## Migration from Mocks to Testcontainers

If you're migrating tests from mocks to real Redis:

1. Remove `createMockRedis()` usage
2. Replace with `setupRedisContainer()` in `beforeAll`
3. Use the real Redis client from the container context
4. Adjust test expectations for real Redis behavior (e.g., timing, persistence)

## Example: Peer Discovery Service

See `/test/services/peer-discovery.spec.ts` for a complete example of testing a service that uses Redis for peer discovery with Testcontainers.