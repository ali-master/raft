import { vi, it, expect, describe } from "vitest";
import { RaftLogger } from "../../src/services";
import { LogLevel } from "../../src";

describe("raftLogger", () => {
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
    expect(logOutput).toContain('"key":"value"');

    spy.mockRestore();
  });

  it("should respect log levels", () => {
    const debugSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(warnSpy).toHaveBeenCalledTimes(1); // warn
    expect(errorSpy).toHaveBeenCalledTimes(1); // error

    debugSpy.mockRestore();
    warnSpy.mockRestore();
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
    expect(logOutput).toContain('"nodeId":"test-node"');
    expect(logOutput).toContain('"term":5');
    expect(logOutput).toContain('"nested":{"value":42}');

    spy.mockRestore();
  });
});
