/**
 * Structured Logging Module Tests
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  logger,
  createLogger,
  createRequestLogger,
  createRequestContext,
  getRequestCorrelationId,
  generateCorrelationId,
  withCorrelationId,
  withCorrelationIdAsync,
  getCorrelationId,
  setCorrelationId,
  LOG_CONFIG,
  type LogEntry,
} from "./index";

// Helper to capture log output
function captureLogOutput(): { logs: LogEntry[]; restore: () => void } {
  const logs: LogEntry[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (output: string) => {
    try {
      logs.push(JSON.parse(output));
    } catch {
      // Not JSON, ignore
    }
  };
  console.warn = (output: string) => {
    try {
      logs.push(JSON.parse(output));
    } catch {
      // Not JSON, ignore
    }
  };
  console.error = (output: string) => {
    try {
      logs.push(JSON.parse(output));
    } catch {
      // Not JSON, ignore
    }
  };

  return {
    logs,
    restore: () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}

describe("Structured Logging", () => {
  let capture: ReturnType<typeof captureLogOutput>;

  beforeEach(() => {
    capture = captureLogOutput();
    setCorrelationId(undefined);
  });

  afterEach(() => {
    capture.restore();
  });

  describe("logger", () => {
    it("logs info messages with required fields", () => {
      logger.info("Test message");

      expect(capture.logs).toHaveLength(1);
      const log = capture.logs[0];
      expect(log.level).toBe("info");
      expect(log.message).toBe("Test message");
      expect(log.service).toBe(LOG_CONFIG.service);
      expect(log.timestamp).toBeDefined();
    });

    it("logs with metadata", () => {
      logger.info("User action", { userId: "user-123", action: "login" });

      const log = capture.logs[0];
      expect(log.userId).toBe("user-123");
      expect(log.action).toBe("login");
    });

    it("logs warn messages", () => {
      logger.warn("Warning message");

      expect(capture.logs[0].level).toBe("warn");
    });

    it("logs error messages", () => {
      logger.error("Error occurred");

      expect(capture.logs[0].level).toBe("error");
    });

    it("logs Error objects with details", () => {
      const error = new Error("Something failed");
      logger.error("Operation failed", error);

      const log = capture.logs[0];
      expect(log.errorName).toBe("Error");
      expect(log.errorMessage).toBe("Something failed");
    });

    it("logs Error in metadata object", () => {
      const error = new Error("Nested error");
      logger.error("Failed", { operation: "save", error });

      const log = capture.logs[0];
      expect(log.operation).toBe("save");
      expect(log.errorMessage).toBe("Nested error");
    });

    it("produces valid JSON", () => {
      logger.info("Test", { nested: { deep: { value: 123 } } });

      // If we got here, the JSON was parseable
      expect(capture.logs[0].nested).toEqual({ deep: { value: 123 } });
    });
  });

  describe("createLogger", () => {
    it("creates module-scoped logger", () => {
      const dbLogger = createLogger("db");
      dbLogger.info("Query executed");

      expect(capture.logs[0].module).toBe("db");
    });

    it("preserves module through child loggers", () => {
      const dbLogger = createLogger("db");
      const childLogger = dbLogger.child({ table: "diagrams" });
      childLogger.info("Insert");

      const log = capture.logs[0];
      expect(log.module).toBe("db");
      expect(log.table).toBe("diagrams");
    });
  });

  describe("createRequestLogger", () => {
    it("creates logger with correlation ID", () => {
      const reqLogger = createRequestLogger("req-abc-123");
      reqLogger.info("Request received");

      expect(capture.logs[0].correlationId).toBe("req-abc-123");
    });

    it("creates logger with correlation ID and module", () => {
      const reqLogger = createRequestLogger("req-xyz", "api");
      reqLogger.info("Endpoint called");

      const log = capture.logs[0];
      expect(log.correlationId).toBe("req-xyz");
      expect(log.module).toBe("api");
    });
  });

  describe("Correlation ID functions", () => {
    it("withCorrelationId sets ID for sync functions", () => {
      withCorrelationId("sync-123", () => {
        logger.info("Inside context");
      });

      expect(capture.logs[0].correlationId).toBe("sync-123");
    });

    it("withCorrelationId restores previous ID after execution", () => {
      setCorrelationId("outer");

      withCorrelationId("inner", () => {
        expect(getCorrelationId()).toBe("inner");
      });

      expect(getCorrelationId()).toBe("outer");
    });

    it("withCorrelationIdAsync sets ID for async functions", async () => {
      await withCorrelationIdAsync("async-456", async () => {
        await Promise.resolve();
        logger.info("Async operation");
      });

      expect(capture.logs[0].correlationId).toBe("async-456");
    });

    it("generateCorrelationId produces unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateCorrelationId());
      }
      expect(ids.size).toBe(100);
    });

    it("getCorrelationId returns current ID", () => {
      expect(getCorrelationId()).toBeUndefined();

      setCorrelationId("test-id");
      expect(getCorrelationId()).toBe("test-id");

      setCorrelationId(undefined);
      expect(getCorrelationId()).toBeUndefined();
    });
  });

  describe("getRequestCorrelationId", () => {
    it("extracts x-correlation-id header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-correlation-id": "corr-from-header" },
      });

      expect(getRequestCorrelationId(req)).toBe("corr-from-header");
    });

    it("falls back to x-request-id header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-request-id": "req-from-header" },
      });

      expect(getRequestCorrelationId(req)).toBe("req-from-header");
    });

    it("prefers x-correlation-id over x-request-id", () => {
      const req = new Request("http://localhost/", {
        headers: {
          "x-correlation-id": "corr-id",
          "x-request-id": "req-id",
        },
      });

      expect(getRequestCorrelationId(req)).toBe("corr-id");
    });

    it("generates new ID if no header present", () => {
      const req = new Request("http://localhost/");

      const id = getRequestCorrelationId(req);
      expect(id).toBeDefined();
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe("createRequestContext", () => {
    it("creates complete request context", () => {
      const req = new Request("http://localhost/api/diagrams", {
        method: "POST",
        headers: { "x-correlation-id": "ctx-123" },
      });

      const ctx = createRequestContext(req);

      expect(ctx.correlationId).toBe("ctx-123");
      expect(ctx.method).toBe("POST");
      expect(ctx.path).toBe("/api/diagrams");
      expect(ctx.logger).toBeDefined();
    });

    it("logger in context has correlation ID", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-correlation-id": "ctx-456" },
      });

      const ctx = createRequestContext(req);
      ctx.logger.info("Request processed");

      expect(capture.logs[0].correlationId).toBe("ctx-456");
    });
  });

  describe("child loggers", () => {
    it("inherits parent context", () => {
      const parent = createLogger("parent").child({ requestId: "r-1" });
      const child = parent.child({ userId: "u-1" });

      child.info("Child log");

      const log = capture.logs[0];
      expect(log.module).toBe("parent");
      expect(log.requestId).toBe("r-1");
      expect(log.userId).toBe("u-1");
    });

    it("child can override parent context", () => {
      const parent = createLogger("parent").child({ operation: "read" });
      const child = parent.child({ operation: "write" });

      child.info("Operation");

      expect(capture.logs[0].operation).toBe("write");
    });
  });

  describe("LOG_CONFIG", () => {
    it("has expected configuration fields", () => {
      expect(LOG_CONFIG).toHaveProperty("level");
      expect(LOG_CONFIG).toHaveProperty("pretty");
      expect(LOG_CONFIG).toHaveProperty("includeStack");
      expect(LOG_CONFIG).toHaveProperty("service");
    });
  });

  describe("sensitive data sanitization", () => {
    it("redacts common sensitive key names", () => {
      logger.info("Test", {
        password: "super-secret-123",
        apiKey: "sk-abc123",
        token: "bearer-xyz",
        regularField: "safe-value",
      });

      expect(capture.logs[0].password).toBe("[REDACTED]");
      expect(capture.logs[0].apiKey).toBe("[REDACTED]");
      expect(capture.logs[0].token).toBe("[REDACTED]");
      expect(capture.logs[0].regularField).toBe("safe-value");
    });

    it("redacts values that look like API keys", () => {
      logger.info("Test", {
        someKey: "sk-1234567890abcdefghij1234567890abcdefgh",
        awsKey: "AKIAIOSFODNN7EXAMPLE",
        normal: "this is just a normal string",
      });

      // OpenAI-style key should be partially redacted
      expect(capture.logs[0].someKey).toContain("[REDACTED");
      expect(capture.logs[0].someKey).not.toContain("1234567890abcdefghij");

      // Short normal strings should pass through
      expect(capture.logs[0].normal).toBe("this is just a normal string");
    });

    it("redacts nested sensitive fields", () => {
      logger.info("Test", {
        config: {
          database: "mydb",
          // "credentials" is a sensitive key, so whole object is redacted
          credentials: {
            apiKey: "secret-key-here",
            username: "admin",
          },
          // Non-sensitive parent with sensitive child
          settings: {
            timeout: 30,
            apiKey: "should-be-redacted",
          },
        },
      });

      const config = capture.logs[0].config as Record<string, unknown>;

      expect(config.database).toBe("mydb");
      // Entire credentials object is redacted because key name is sensitive
      expect(config.credentials).toBe("[REDACTED]");
      // Settings is not sensitive, but apiKey inside is
      const settings = config.settings as Record<string, unknown>;
      expect(settings.timeout).toBe(30);
      expect(settings.apiKey).toBe("[REDACTED]");
    });

    it("handles arrays with sensitive data", () => {
      logger.info("Test", {
        tokens: ["token1", "token2"],
        items: [{ name: "item1", secret: "hidden" }],
      });

      // tokens key is sensitive, so array is redacted
      expect(capture.logs[0].tokens).toBe("[REDACTED]");

      // items array with nested secret
      const items = capture.logs[0].items as Array<Record<string, unknown>>;
      expect(items[0].name).toBe("item1");
      expect(items[0].secret).toBe("[REDACTED]");
    });

    it("preserves non-sensitive data exactly", () => {
      const testData = {
        id: 123,
        name: "test",
        active: true,
        tags: ["a", "b", "c"],
        nested: { count: 42 },
      };

      logger.info("Test", testData);

      expect(capture.logs[0].id).toBe(123);
      expect(capture.logs[0].name).toBe("test");
      expect(capture.logs[0].active).toBe(true);
      expect(capture.logs[0].tags).toEqual(["a", "b", "c"]);
      expect((capture.logs[0].nested as Record<string, number>).count).toBe(42);
    });

    it("handles JWT tokens in values", () => {
      const jwtToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

      logger.info("Test", {
        authHeader: jwtToken,
      });

      // JWT should be partially redacted
      expect(capture.logs[0].authHeader).toContain("[REDACTED");
      expect(capture.logs[0].authHeader).not.toContain("eyJzdWIiOiIxMjM0NTY3ODkwIn0");
    });
  });
});
