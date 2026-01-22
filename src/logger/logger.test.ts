/**
 * Logger Tests
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Logger, logger, log, type LogLevel } from "./index";

describe("Logger", () => {
  let testLogger: Logger;
  let consoleOutput: string[];

  beforeEach(() => {
    // Create a test logger
    testLogger = new Logger({
      level: "debug",
      isProduction: false,
      appName: "test",
    });

    // Capture console output
    consoleOutput = [];
    const originalLog = console.log;
    console.log = (...args) => {
      consoleOutput.push(args.join(" "));
    };
  });

  afterEach(() => {
    // Restore console
    console.log = console.log;
  });

  describe("Log Levels", () => {
    it("respects log level hierarchy", () => {
      const warnLogger = new Logger({ level: "warn", isProduction: false });

      warnLogger.debug("debug message");
      warnLogger.info("info message");
      warnLogger.warn("warn message");
      warnLogger.error("error message");

      // Only warn and error should be logged
      const warnCount = consoleOutput.filter((o) => o.includes("[WARN]")).length;
      const errorCount = consoleOutput.filter((o) => o.includes("[ERROR]")).length;
      const debugCount = consoleOutput.filter((o) => o.includes("[DEBUG]")).length;
      const infoCount = consoleOutput.filter((o) => o.includes("[INFO]")).length;

      expect(warnCount).toBe(1);
      expect(errorCount).toBe(1);
      expect(debugCount).toBe(0);
      expect(infoCount).toBe(0);
    });

    it("allows setting log level at runtime", () => {
      testLogger.setLevel("error");
      expect(testLogger.getLevel()).toBe("error");

      testLogger.info("should not appear");
      expect(consoleOutput.filter((o) => o.includes("should not appear")).length).toBe(0);

      testLogger.error("should appear");
      expect(consoleOutput.filter((o) => o.includes("should appear")).length).toBe(1);
    });
  });

  describe("Log Methods", () => {
    it("logs debug messages", () => {
      testLogger.debug("Debug message");
      expect(consoleOutput.some((o) => o.includes("[DEBUG]"))).toBe(true);
      expect(consoleOutput.some((o) => o.includes("Debug message"))).toBe(true);
    });

    it("logs info messages", () => {
      testLogger.info("Info message");
      expect(consoleOutput.some((o) => o.includes("[INFO]"))).toBe(true);
      expect(consoleOutput.some((o) => o.includes("Info message"))).toBe(true);
    });

    it("logs warn messages", () => {
      testLogger.warn("Warn message");
      expect(consoleOutput.some((o) => o.includes("[WARN]"))).toBe(true);
      expect(consoleOutput.some((o) => o.includes("Warn message"))).toBe(true);
    });

    it("logs error messages", () => {
      testLogger.error("Error message");
      expect(consoleOutput.some((o) => o.includes("[ERROR]"))).toBe(true);
      expect(consoleOutput.some((o) => o.includes("Error message"))).toBe(true);
    });

    it("logs error with Error object", () => {
      const error = new Error("Test error");
      testLogger.error("Something failed", error);

      expect(consoleOutput.some((o) => o.includes("Something failed"))).toBe(true);
    });
  });

  describe("Context", () => {
    it("includes operation in output", () => {
      testLogger.info("Processing", { operation: "create-diagram" });
      expect(consoleOutput.some((o) => o.includes("[create-diagram]"))).toBe(true);
    });

    it("includes additional context", () => {
      testLogger.info("Processing", {
        operation: "test",
        diagramId: "abc123",
        userId: "user1",
      });

      expect(consoleOutput.some((o) => o.includes("abc123"))).toBe(true);
      expect(consoleOutput.some((o) => o.includes("user1"))).toBe(true);
    });

    it("handles empty context", () => {
      testLogger.info("No context");
      expect(consoleOutput.length).toBe(1);
    });
  });

  describe("Timing", () => {
    it("times async operations", async () => {
      const result = await testLogger.time(
        "async-operation",
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "done";
        }
      );

      expect(result).toBe("done");
      expect(consoleOutput.some((o) => o.includes("Starting async-operation"))).toBe(true);
      expect(consoleOutput.some((o) => o.includes("Completed async-operation"))).toBe(true);
    });

    it("times sync operations", () => {
      const result = testLogger.timeSync(
        "sync-operation",
        () => {
          let sum = 0;
          for (let i = 0; i < 100; i++) sum += i;
          return sum;
        }
      );

      expect(result).toBe(4950);
      expect(consoleOutput.some((o) => o.includes("Completed sync-operation"))).toBe(true);
    });

    it("logs errors on failed timed operations", async () => {
      try {
        await testLogger.time(
          "failing-operation",
          async () => {
            throw new Error("Failed!");
          }
        );
      } catch (e) {
        // Expected
      }

      expect(consoleOutput.some((o) => o.includes("Failed failing-operation"))).toBe(true);
    });
  });

  describe("Child Logger", () => {
    it("creates child with preset context", () => {
      const child = testLogger.child({ requestId: "req-123" });

      child.info("Request started");
      expect(consoleOutput.some((o) => o.includes("req-123"))).toBe(true);
    });

    it("merges context from child and call", () => {
      const child = testLogger.child({ requestId: "req-123" });

      child.info("Processing", { diagramId: "diag-456" });
      expect(consoleOutput.some((o) => o.includes("req-123"))).toBe(true);
      expect(consoleOutput.some((o) => o.includes("diag-456"))).toBe(true);
    });

    it("supports nested children", () => {
      const child1 = testLogger.child({ requestId: "req-123" });
      const child2 = child1.child({ diagramId: "diag-456" });

      child2.info("Nested operation");
      expect(consoleOutput.some((o) => o.includes("req-123"))).toBe(true);
      expect(consoleOutput.some((o) => o.includes("diag-456"))).toBe(true);
    });
  });

  describe("Production Output", () => {
    it("outputs JSON in production mode", () => {
      const prodLogger = new Logger({
        level: "info",
        isProduction: true,
        appName: "prod-test",
      });

      prodLogger.info("Test message", { operation: "test", data: "value" });

      // Should be valid JSON
      expect(() => JSON.parse(consoleOutput[0])).not.toThrow();

      const parsed = JSON.parse(consoleOutput[0]);
      expect(parsed.level).toBe("info");
      expect(parsed.message).toBe("Test message");
      expect(parsed.app).toBe("prod-test");
      expect(parsed.context?.operation).toBe("test");
    });
  });

  describe("Singleton Logger", () => {
    it("provides singleton logger instance", () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");
    });

    it("provides convenience log functions", () => {
      expect(log.debug).toBeDefined();
      expect(log.info).toBeDefined();
      expect(log.warn).toBeDefined();
      expect(log.error).toBeDefined();
      expect(log.time).toBeDefined();
      expect(log.timeSync).toBeDefined();
    });
  });
});
