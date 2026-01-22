/**
 * Graceful Shutdown Tests
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Hono } from "hono";
import {
  shutdownMiddleware,
  isServerShuttingDown,
  getActiveRequestCount,
  onShutdown,
  resetShutdownState,
} from "./shutdown";

describe("Shutdown Middleware", () => {
  beforeEach(() => {
    resetShutdownState();
  });

  afterEach(() => {
    resetShutdownState();
  });

  test("allows requests when not shutting down", async () => {
    const app = new Hono();
    app.use("*", shutdownMiddleware());
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("tracks active request count", async () => {
    expect(getActiveRequestCount()).toBe(0);

    const app = new Hono();
    app.use("*", shutdownMiddleware());
    app.get("/slow", async (c) => {
      // During this handler, request should be tracked
      expect(getActiveRequestCount()).toBe(1);
      return c.json({ ok: true });
    });

    const res = await app.request("/slow");
    expect(res.status).toBe(200);

    // After request completes, count should be 0
    expect(getActiveRequestCount()).toBe(0);
  });

  test("initial shutdown state is false", () => {
    expect(isServerShuttingDown()).toBe(false);
  });
});

describe("Shutdown Callbacks", () => {
  beforeEach(() => {
    resetShutdownState();
  });

  afterEach(() => {
    resetShutdownState();
  });

  test("registers shutdown callbacks", () => {
    const callback = mock(() => {});

    onShutdown("test-callback", callback);

    // Callback shouldn't be called until shutdown
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("Server State", () => {
  beforeEach(() => {
    resetShutdownState();
  });

  afterEach(() => {
    resetShutdownState();
  });

  test("isServerShuttingDown returns correct state", () => {
    expect(isServerShuttingDown()).toBe(false);
  });

  test("getActiveRequestCount returns 0 initially", () => {
    expect(getActiveRequestCount()).toBe(0);
  });

  test("resetShutdownState clears state", () => {
    // Register a callback to verify it gets cleared
    onShutdown("test", () => {});

    resetShutdownState();

    expect(isServerShuttingDown()).toBe(false);
    expect(getActiveRequestCount()).toBe(0);
  });
});
