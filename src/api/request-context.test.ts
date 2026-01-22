/**
 * Request Context Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import {
  requestContext,
  getRequestContext,
  getRequestId,
  getElapsedMs,
  runWithContext,
  createRequestContext,
  formatLogMessage,
  ctxLogger,
  getContextSummary,
  REQUEST_ID_HEADER,
  RESPONSE_TIME_HEADER,
} from "./request-context";

describe("Request Context", () => {
  describe("createRequestContext", () => {
    it("creates context with all fields", () => {
      const ctx = createRequestContext(
        "req-123",
        "/api/test",
        "GET",
        "Mozilla/5.0",
        "192.168.1.1"
      );

      expect(ctx.requestId).toBe("req-123");
      expect(ctx.path).toBe("/api/test");
      expect(ctx.method).toBe("GET");
      expect(ctx.userAgent).toBe("Mozilla/5.0");
      expect(ctx.clientIP).toBe("192.168.1.1");
      expect(ctx.startTime).toBeGreaterThan(0);
    });

    it("creates context without optional fields", () => {
      const ctx = createRequestContext("req-456", "/test", "POST");

      expect(ctx.requestId).toBe("req-456");
      expect(ctx.userAgent).toBeUndefined();
      expect(ctx.clientIP).toBeUndefined();
    });
  });

  describe("runWithContext", () => {
    it("makes context available inside the function", () => {
      const ctx = createRequestContext("test-req", "/test", "GET");

      runWithContext(ctx, () => {
        const current = getRequestContext();
        expect(current).toBeDefined();
        expect(current?.requestId).toBe("test-req");
      });
    });

    it("context is not available outside", () => {
      const ctx = createRequestContext("test-req", "/test", "GET");

      runWithContext(ctx, () => {
        // Context available here
        expect(getRequestContext()).toBeDefined();
      });

      // Context not available outside
      expect(getRequestContext()).toBeUndefined();
    });

    it("returns the function result", () => {
      const ctx = createRequestContext("test-req", "/test", "GET");

      const result = runWithContext(ctx, () => {
        return "hello";
      });

      expect(result).toBe("hello");
    });

    it("preserves context through async operations", async () => {
      const ctx = createRequestContext("async-req", "/async", "GET");

      await runWithContext(ctx, async () => {
        expect(getRequestContext()?.requestId).toBe("async-req");

        await new Promise((r) => setTimeout(r, 10));

        expect(getRequestContext()?.requestId).toBe("async-req");
      });
    });
  });

  describe("getRequestId", () => {
    it("returns request ID when in context", () => {
      const ctx = createRequestContext("my-id", "/test", "GET");

      runWithContext(ctx, () => {
        expect(getRequestId()).toBe("my-id");
      });
    });

    it("returns fallback when not in context", () => {
      const id = getRequestId();
      expect(id).toMatch(/^no-ctx-/);
    });
  });

  describe("getElapsedMs", () => {
    it("returns elapsed time when in context", async () => {
      const ctx = createRequestContext("time-test", "/test", "GET");

      await runWithContext(ctx, async () => {
        await new Promise((r) => setTimeout(r, 50));
        const elapsed = getElapsedMs();
        expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some variance
      });
    });

    it("returns 0 when not in context", () => {
      expect(getElapsedMs()).toBe(0);
    });
  });

  describe("Middleware", () => {
    it("sets X-Request-ID header in response", async () => {
      const app = new Hono();
      app.use("*", requestContext());
      app.get("/test", (c) => c.text("OK"));

      const res = await app.request("/test");
      expect(res.headers.get(REQUEST_ID_HEADER)).toBeDefined();
      expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^req-/);
    });

    it("uses provided X-Request-ID", async () => {
      const app = new Hono();
      app.use("*", requestContext());
      app.get("/test", (c) => c.text("OK"));

      const res = await app.request("/test", {
        headers: { "X-Request-ID": "custom-123" },
      });
      expect(res.headers.get(REQUEST_ID_HEADER)).toBe("custom-123");
    });

    it("sets X-Response-Time header", async () => {
      const app = new Hono();
      app.use("*", requestContext());
      app.get("/test", (c) => c.text("OK"));

      const res = await app.request("/test");
      const responseTime = res.headers.get(RESPONSE_TIME_HEADER);
      expect(responseTime).toBeDefined();
      expect(responseTime).toMatch(/^\d+\.\d+ms$/);
    });

    it("makes context available in handlers", async () => {
      const app = new Hono();
      app.use("*", requestContext());
      app.get("/test", (c) => {
        const ctx = getRequestContext();
        return c.json({
          requestId: ctx?.requestId,
          path: ctx?.path,
          method: ctx?.method,
        });
      });

      const res = await app.request("/test");
      const data = await res.json();

      expect(data.path).toBe("/test");
      expect(data.method).toBe("GET");
      expect(data.requestId).toMatch(/^req-/);
    });
  });

  describe("formatLogMessage", () => {
    it("formats message without context", () => {
      const msg = formatLogMessage("info", "Test message");
      expect(msg).toContain("[INFO]");
      expect(msg).toContain("Test message");
    });

    it("formats message with context", () => {
      const ctx = createRequestContext("log-test", "/api/log", "POST");

      runWithContext(ctx, () => {
        const msg = formatLogMessage("warn", "Warning!");
        expect(msg).toContain("[WARN]");
        expect(msg).toContain("[log-test]");
        expect(msg).toContain("[POST /api/log]");
        expect(msg).toContain("Warning!");
      });
    });

    it("includes extra data", () => {
      const msg = formatLogMessage("error", "Error occurred", {
        code: "ERR_001",
        details: "Something went wrong",
      });
      expect(msg).toContain("ERR_001");
      expect(msg).toContain("Something went wrong");
    });
  });

  describe("ctxLogger", () => {
    it("has info method", () => {
      expect(typeof ctxLogger.info).toBe("function");
    });

    it("has warn method", () => {
      expect(typeof ctxLogger.warn).toBe("function");
    });

    it("has error method", () => {
      expect(typeof ctxLogger.error).toBe("function");
    });

    it("has debug method", () => {
      expect(typeof ctxLogger.debug).toBe("function");
    });
  });

  describe("getContextSummary", () => {
    it("returns empty object without context", () => {
      const summary = getContextSummary();
      expect(summary).toEqual({});
    });

    it("returns summary with context", () => {
      const ctx = createRequestContext("summary-test", "/api/test", "GET");

      runWithContext(ctx, () => {
        const summary = getContextSummary();
        expect(summary.requestId).toBe("summary-test");
        expect(summary.path).toBe("/api/test");
        expect(summary.method).toBe("GET");
        expect(summary.elapsedMs).toBeDefined();
      });
    });
  });
});
