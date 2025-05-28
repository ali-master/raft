import { vi, it, expect, describe, beforeEach } from "vitest";
import { RaftLogger } from "../../src/services";
import { LogLevel } from "../../src/constants";
import { createTestConfig } from "../shared/test-utils";

describe("raftLogger", () => {
  let logger: RaftLogger;

  beforeEach(() => {
    const config = createTestConfig();
    logger = new RaftLogger(config.logging);
  });

  it("should format log messages correctly", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const testLogger = new RaftLogger({
      level: LogLevel.INFO,
      enableConsole: true,
      enableFile: false,
      filePath: "",
    });

    testLogger.info("Test message", { key: "value" });

    expect(spy).toHaveBeenCalled();
    const logOutput = spy.mock.calls[0]![0];
    expect(logOutput).toContain("INFO");
    expect(logOutput).toContain("Test message");
    expect(logOutput).toContain("\"key\":\"value\"");

    spy.mockRestore();
  });

  it("should respect log levels", () => {
    const debugSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const warnLogger = new RaftLogger({
      level: LogLevel.WARN,
      enableConsole: true,
      enableFile: false,
      filePath: "",
    });

    warnLogger.debug("Debug message");
    warnLogger.info("Info message");
    warnLogger.warn("Warn message");
    warnLogger.error("Error message");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(2); // warn and error

    debugSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("should handle context objects", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const testLogger = new RaftLogger({
      level: LogLevel.INFO,
      enableConsole: true,
      enableFile: false,
      filePath: "",
    });

    testLogger.info("Test with context", {
      nodeId: "test-node",
      term: 5,
      nested: { value: 42 },
    });

    expect(spy).toHaveBeenCalled();
    const logOutput = spy.mock.calls[0]![0];
    expect(logOutput).toContain("\"nodeId\":\"test-node\"");
    expect(logOutput).toContain("\"term\":5");
    expect(logOutput).toContain("\"nested\":{\"value\":42}");

    spy.mockRestore();
  });
});
