/**
 * Logger Module Tests
 * Tests for structured logging with levels, context, and timing
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Logger, ChildLogger, logger, log } from "./index";

describe("Logger", () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let testLogger: Logger;

  beforeEach(() => {
    // Spy on console.log to capture output
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    // Create a logger with debug level to capture all logs
    testLogger = new Logger({ level: "debug", isProduction: false });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("log levels", () => {
    it("logs debug messages when level is debug", () => {
      testLogger.debug("test message");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("logs info messages when level is info or lower", () => {
      testLogger.info("test message");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("logs warn messages when level is warn or lower", () => {
      testLogger.warn("test message");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("logs error messages when level is error or lower", () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      testLogger.error("test message", new Error("test error"));
      expect(consoleSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("respects log level filtering", () => {
      const warnLogger = new Logger({ level: "warn", isProduction: false });

      warnLogger.debug("debug message");
      expect(consoleSpy).not.toHaveBeenCalled();

      warnLogger.info("info message");
      expect(consoleSpy).not.toHaveBeenCalled();

      warnLogger.warn("warn message");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("can change log level at runtime", () => {
      testLogger.setLevel("error");

      testLogger.warn("should not log");
      expect(consoleSpy).not.toHaveBeenCalled();

      testLogger.setLevel("debug");
      testLogger.warn("should log now");
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("getLevel returns current level", () => {
      expect(testLogger.getLevel()).toBe("debug");
      testLogger.setLevel("warn");
      expect(testLogger.getLevel()).toBe("warn");
    });
  });

  describe("context", () => {
    it("includes context in log output", () => {
      testLogger.info("test message", { requestId: "req-123" });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain("req-123");
    });

    it("includes operation in log output", () => {
      testLogger.info("test message", { operation: "create_diagram" });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain("create_diagram");
    });

    it("handles empty context gracefully", () => {
      testLogger.info("test message", {});
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("handles undefined context gracefully", () => {
      testLogger.info("test message");
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe("error logging", () => {
    it("includes error details in log", () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const testError = new Error("Test error message");

      testLogger.error("Something failed", testError);

      expect(consoleSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("handles non-Error objects in catch blocks", () => {
      testLogger.error("Something failed");
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe("production mode", () => {
    it("outputs JSON in production mode", () => {
      const prodLogger = new Logger({ level: "info", isProduction: true });

      prodLogger.info("test message", { requestId: "req-123" });

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;

      const parsed = JSON.parse(output);
      expect(parsed.message).toBe("test message");
      expect(parsed.level).toBe("info");
      expect(parsed.app).toBe("vizcraft");
      expect(parsed.context.requestId).toBe("req-123");
    });

    it("includes timestamp in production JSON", () => {
      const prodLogger = new Logger({ level: "info", isProduction: true });

      prodLogger.info("test");

      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.timestamp).toBeDefined();
      expect(new Date(parsed.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe("timing utilities", () => {
    it("time() logs async operation duration", async () => {
      const result = await testLogger.time("test_operation", async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "result";
      });

      expect(result).toBe("result");
      expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("time() logs error on failure", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      await expect(
        testLogger.time("failing_operation", async () => {
          throw new Error("Test failure");
        })
      ).rejects.toThrow("Test failure");

      expect(consoleSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("timeSync() logs sync operation duration", () => {
      const result = testLogger.timeSync("sync_operation", () => {
        return "sync result";
      });

      expect(result).toBe("sync result");
      expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("timeSync() logs error on failure", () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        testLogger.timeSync("failing_sync_operation", () => {
          throw new Error("Sync failure");
        });
      }).toThrow("Sync failure");

      expect(consoleSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("time() includes context", async () => {
      const prodLogger = new Logger({ level: "debug", isProduction: true });

      await prodLogger.time("contexted_op", async () => "done", {
        diagramId: "diag-123",
      });

      const calls = consoleSpy.mock.calls;
      const completionLog = calls.find((call) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.level === "info" && parsed.message.includes("Completed");
      });

      expect(completionLog).toBeDefined();
      const parsed = JSON.parse(completionLog![0] as string);
      expect(parsed.context.diagramId).toBe("diag-123");
    });
  });
});

describe("ChildLogger", () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let parentLogger: Logger;

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    parentLogger = new Logger({ level: "debug", isProduction: true });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("inherits parent context", () => {
    const child = parentLogger.child({ requestId: "req-abc" });

    child.info("child message");

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.context.requestId).toBe("req-abc");
  });

  it("merges additional context", () => {
    const child = parentLogger.child({ requestId: "req-abc" });

    child.info("child message", { userId: "user-123" });

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.context.requestId).toBe("req-abc");
    expect(parsed.context.userId).toBe("user-123");
  });

  it("additional context overrides parent context", () => {
    const child = parentLogger.child({ requestId: "parent-req" });

    child.info("child message", { requestId: "child-req" });

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.context.requestId).toBe("child-req");
  });

  it("can create nested child loggers", () => {
    const child1 = parentLogger.child({ requestId: "req-1" });
    const child2 = child1.child({ diagramId: "diag-1" });

    child2.info("nested message");

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.context.requestId).toBe("req-1");
    expect(parsed.context.diagramId).toBe("diag-1");
  });

  it("supports all log levels", () => {
    const child = parentLogger.child({ requestId: "req-1" });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    child.debug("debug");
    child.info("info");
    child.warn("warn");
    child.error("error");

    expect(consoleSpy.mock.calls.length).toBe(4);
    errorSpy.mockRestore();
  });

  it("supports timing with child context", async () => {
    const child = parentLogger.child({ requestId: "req-timing" });

    await child.time("child_operation", async () => "result");

    const completionLog = consoleSpy.mock.calls.find((call) => {
      const parsed = JSON.parse(call[0] as string);
      return parsed.level === "info" && parsed.message.includes("Completed");
    });

    expect(completionLog).toBeDefined();
    const parsed = JSON.parse(completionLog![0] as string);
    expect(parsed.context.requestId).toBe("req-timing");
  });
});

describe("singleton logger", () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("logger singleton is an instance of Logger", () => {
    expect(logger).toBeInstanceOf(Logger);
  });

  it("log convenience functions work", () => {
    logger.setLevel("debug");

    log.debug("debug message");
    log.info("info message");
    log.warn("warn message");

    expect(consoleSpy.mock.calls.length).toBe(3);
  });

  it("log.error convenience function works", () => {
    logger.setLevel("debug");
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    log.error("error message", new Error("test"));

    expect(consoleSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("log.time convenience function works", async () => {
    logger.setLevel("debug");

    const result = await log.time("convenience_op", async () => "done");

    expect(result).toBe("done");
  });

  it("log.timeSync convenience function works", () => {
    logger.setLevel("debug");

    const result = log.timeSync("sync_convenience_op", () => 42);

    expect(result).toBe(42);
  });
});

describe("log level priority", () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("debug level shows all logs", () => {
    const testLogger = new Logger({ level: "debug", isProduction: false });

    testLogger.debug("debug");
    testLogger.info("info");
    testLogger.warn("warn");
    testLogger.error("error");

    expect(consoleSpy.mock.calls.length).toBe(4);
  });

  it("info level hides debug", () => {
    const testLogger = new Logger({ level: "info", isProduction: false });

    testLogger.debug("debug");
    testLogger.info("info");
    testLogger.warn("warn");
    testLogger.error("error");

    expect(consoleSpy.mock.calls.length).toBe(3);
  });

  it("warn level hides debug and info", () => {
    const testLogger = new Logger({ level: "warn", isProduction: false });

    testLogger.debug("debug");
    testLogger.info("info");
    testLogger.warn("warn");
    testLogger.error("error");

    expect(consoleSpy.mock.calls.length).toBe(2);
  });

  it("error level only shows errors", () => {
    const testLogger = new Logger({ level: "error", isProduction: false });

    testLogger.debug("debug");
    testLogger.info("info");
    testLogger.warn("warn");
    testLogger.error("error");

    expect(consoleSpy.mock.calls.length).toBe(1);
  });
});
