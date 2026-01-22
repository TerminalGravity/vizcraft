/**
 * Timeout Utility Tests
 */

import { describe, it, expect } from "bun:test";
import {
  TimeoutError,
  TIMEOUTS,
  withTimeout,
  withTimeoutResult,
  createTimeoutWrapper,
  withLayoutTimeout,
  withAgentTimeout,
  withExportTimeout,
} from "./timeout";

describe("TimeoutError", () => {
  it("creates error with operation and timeout info", () => {
    const err = new TimeoutError("Test operation", 5000);

    expect(err.name).toBe("TimeoutError");
    expect(err.operation).toBe("Test operation");
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toBe("Test operation timed out after 5000ms");
  });
});

describe("TIMEOUTS", () => {
  it("has sensible default values", () => {
    expect(TIMEOUTS.STANDARD).toBeGreaterThan(0);
    expect(TIMEOUTS.LAYOUT).toBeGreaterThan(TIMEOUTS.STANDARD);
    expect(TIMEOUTS.AGENT).toBeGreaterThan(TIMEOUTS.LAYOUT);
  });

  it("has all expected timeout types", () => {
    expect(TIMEOUTS.STANDARD).toBeDefined();
    expect(TIMEOUTS.LAYOUT).toBeDefined();
    expect(TIMEOUTS.THEME).toBeDefined();
    expect(TIMEOUTS.AGENT).toBeDefined();
    expect(TIMEOUTS.EXPORT).toBeDefined();
  });
});

describe("withTimeout", () => {
  it("returns result for fast operations", async () => {
    const fastPromise = Promise.resolve("success");

    const result = await withTimeout(fastPromise, 1000, "Fast operation");

    expect(result).toBe("success");
  });

  it("throws TimeoutError for slow operations", async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 500));

    try {
      await withTimeout(slowPromise, 50, "Slow operation");
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as TimeoutError).operation).toBe("Slow operation");
      expect((err as TimeoutError).timeoutMs).toBe(50);
    }
  });

  it("passes through operation errors", async () => {
    const failingPromise = Promise.reject(new Error("Operation failed"));

    try {
      await withTimeout(failingPromise, 1000, "Failing operation");
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Operation failed");
      expect(err).not.toBeInstanceOf(TimeoutError);
    }
  });

  it("cleans up timeout on fast completion", async () => {
    const start = Date.now();
    const fastPromise = Promise.resolve("done");

    await withTimeout(fastPromise, 10000, "Fast");

    const elapsed = Date.now() - start;
    // Should complete quickly, not wait for timeout
    expect(elapsed).toBeLessThan(100);
  });
});

describe("withTimeoutResult", () => {
  it("returns success result for fast operations", async () => {
    const fastPromise = Promise.resolve({ value: 42 });

    const result = await withTimeoutResult(fastPromise, 1000, "Fast");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ value: 42 });
      expect(result.timedOut).toBe(false);
    }
  });

  it("returns timeout result for slow operations", async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 500));

    const result = await withTimeoutResult(slowPromise, 50, "Slow");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.timedOut).toBe(true);
      expect(result.error).toBeInstanceOf(TimeoutError);
    }
  });

  it("returns error result for failing operations", async () => {
    const failingPromise = Promise.reject(new Error("Failed"));

    const result = await withTimeoutResult(failingPromise, 1000, "Failing");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.timedOut).toBe(false);
      expect(result.error.message).toBe("Failed");
    }
  });
});

describe("createTimeoutWrapper", () => {
  it("creates wrapper with default timeout", async () => {
    const wrapper = createTimeoutWrapper(100, "Default operation");
    const fastPromise = Promise.resolve("wrapped");

    const result = await wrapper(fastPromise);

    expect(result).toBe("wrapped");
  });

  it("uses custom timeout when provided", async () => {
    const wrapper = createTimeoutWrapper(10000, "Default");
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 200));

    // Use custom shorter timeout
    try {
      await wrapper(slowPromise, 50, "Custom operation");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as TimeoutError).operation).toBe("Custom operation");
      expect((err as TimeoutError).timeoutMs).toBe(50);
    }
  });
});

describe("Pre-configured wrappers", () => {
  it("withLayoutTimeout uses layout timeout", async () => {
    const fastPromise = Promise.resolve({ spec: {} });

    const result = await withLayoutTimeout(fastPromise);

    expect(result).toEqual({ spec: {} });
  });

  it("withAgentTimeout uses agent timeout", async () => {
    const fastPromise = Promise.resolve({ changes: [] });

    const result = await withAgentTimeout(fastPromise);

    expect(result).toEqual({ changes: [] });
  });

  it("withExportTimeout uses export timeout", async () => {
    const fastPromise = Promise.resolve(Buffer.from("exported"));

    const result = await withExportTimeout(fastPromise);

    expect(result).toEqual(Buffer.from("exported"));
  });

  it("all wrappers throw TimeoutError on slow operations", async () => {
    const slowPromise = () => new Promise((resolve) => setTimeout(resolve, 500));

    // Test each wrapper with a short custom timeout
    for (const wrapper of [withLayoutTimeout, withAgentTimeout, withExportTimeout]) {
      try {
        await wrapper(slowPromise(), 50);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TimeoutError);
      }
    }
  });
});
