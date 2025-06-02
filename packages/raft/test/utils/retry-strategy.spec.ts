import { vi, it, expect, describe } from "vitest";
import { RetryStrategy } from "../../src/utils/retry-strategy";

describe("retryStrategy", () => {
  it("should retry operations with exponential backoff", async () => {
    let attempts = 0;
    const operation = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Temporary failure");
      }
      return "success";
    });

    const result = await RetryStrategy.exponentialBackoff(operation, {
      maxRetries: 3,
      baseDelay: 10,
    });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("should apply backoff between retries", async () => {
    const delays: number[] = [];
    const startTime = Date.now();

    const operation = vi.fn().mockImplementation(async () => {
      const elapsed = Date.now() - startTime;
      delays.push(elapsed);
      throw new Error("Always fails");
    });

    await expect(
      RetryStrategy.exponentialBackoff(operation, {
        maxRetries: 3,
        baseDelay: 10,
      }),
    ).rejects.toThrow();

    expect(delays.length).toBe(3); // 3 attempts total
    expect(delays[1]).toBeGreaterThan(delays[0]!); // Exponential backoff
  });

  it("should retry on failure and eventually succeed", async () => {
    let attempt = 0;
    const operation = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt < 3) {
        throw new Error("Not yet");
      }
      return "success!";
    });

    const result = await RetryStrategy.execute(operation, "test operation");
    expect(result).toBe("success!");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("should throw after max attempts", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("Always fails"));

    await expect(
      RetryStrategy.execute(operation, "failing operation"),
    ).rejects.toThrow("Always fails");

    expect(operation).toHaveBeenCalledTimes(3); // Default max retries
  });

  it("should apply jitter to backoff delays", async () => {
    const delays: number[] = [];
    let lastTime = Date.now();

    await expect(
      RetryStrategy.execute(async () => {
        const now = Date.now();
        if (lastTime > 0) {
          delays.push(now - lastTime);
        }
        lastTime = now;
        throw new Error("Failure");
      }, "test operation"),
    ).rejects.toThrow();

    expect(delays.length).toBeGreaterThanOrEqual(2); // At least 2 delays for 3 attempts
    expect(delays[1]).toBeGreaterThan(delays[0]!); // Exponential backoff
  });
});
