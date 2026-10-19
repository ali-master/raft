import { it, expect, describe } from "vitest";
import { BaseHealthIndicator } from "../../src/shared/base/base-health-indicator";

class TestHealthIndicator extends BaseHealthIndicator {
  check(result: () => Promise<boolean>) {
    return this.checkHealth("test", result);
  }
}

describe("health indicator", () => {
  const indicator = new TestHealthIndicator();

  it.each([true, false])("reports health for %s", async (healthy) => {
    expect(await indicator.check(async () => healthy)).toEqual({
      test: {
        status: healthy ? "up" : "down",
        message: healthy ? "test is healthy" : "test is not healthy",
      },
    });
  });

  it("reports a failed check as down", async () => {
    const result = await indicator.check(async () => {
      throw new Error("unavailable");
    });
    expect(result).toEqual({
      test: { status: "down", message: "test health check failed: unavailable" },
    });
  });
});
