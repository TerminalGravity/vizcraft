/**
 * Rate Limiter Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import {
  createRateLimiter,
  rateLimiters,
  RATE_LIMITS,
  getRateLimitStatus,
  clearRateLimitState,
} from "./rate-limiter";

describe("Rate Limiter", () => {
  beforeEach(() => {
    clearRateLimitState();
  });

  describe("createRateLimiter", () => {
    it("allows requests within limit", async () => {
      const app = new Hono();
      const limiter = createRateLimiter({ maxRequests: 5, windowMs: 60000, name: "test" });
      app.use("*", limiter);
      app.get("/test", (c) => c.json({ ok: true }));

      // Make 5 requests - all should succeed
      for (let i = 0; i < 5; i++) {
        const res = await app.request("/test", {
          headers: { "X-Forwarded-For": "192.168.1.1" },
        });
        expect(res.status).toBe(200);
      }
    });

    it("blocks requests exceeding limit", async () => {
      const app = new Hono();
      const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60000, name: "test-block" });
      app.use("*", limiter);
      app.get("/test", (c) => c.json({ ok: true }));

      // Make 3 requests - all should succeed
      for (let i = 0; i < 3; i++) {
        const res = await app.request("/test", {
          headers: { "X-Forwarded-For": "192.168.1.2" },
        });
        expect(res.status).toBe(200);
      }

      // 4th request should be blocked
      const res = await app.request("/test", {
        headers: { "X-Forwarded-For": "192.168.1.2" },
      });
      expect(res.status).toBe(429);

      const body = await res.json();
      expect(body.code).toBe("RATE_LIMITED");
    });

    it("tracks different clients separately", async () => {
      const app = new Hono();
      const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60000, name: "test-clients" });
      app.use("*", limiter);
      app.get("/test", (c) => c.json({ ok: true }));

      // Client 1 uses their limit
      for (let i = 0; i < 2; i++) {
        const res = await app.request("/test", {
          headers: { "X-Forwarded-For": "10.0.0.1" },
        });
        expect(res.status).toBe(200);
      }

      // Client 1 is now blocked
      const blocked = await app.request("/test", {
        headers: { "X-Forwarded-For": "10.0.0.1" },
      });
      expect(blocked.status).toBe(429);

      // Client 2 can still make requests
      const allowed = await app.request("/test", {
        headers: { "X-Forwarded-For": "10.0.0.2" },
      });
      expect(allowed.status).toBe(200);
    });

    it("includes rate limit headers", async () => {
      const app = new Hono();
      const limiter = createRateLimiter({ maxRequests: 10, windowMs: 60000, name: "test-headers" });
      app.use("*", limiter);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test", {
        headers: { "X-Forwarded-For": "192.168.1.3" },
      });

      expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("9");
      expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
    });

    it("includes Retry-After header when rate limited", async () => {
      const app = new Hono();
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60000, name: "test-retry" });
      app.use("*", limiter);
      app.get("/test", (c) => c.json({ ok: true }));

      // Use up the limit
      await app.request("/test", {
        headers: { "X-Forwarded-For": "192.168.1.4" },
      });

      // Next request should be rate limited
      const res = await app.request("/test", {
        headers: { "X-Forwarded-For": "192.168.1.4" },
      });

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeTruthy();
    });
  });

  describe("Pre-configured limiters", () => {
    it("has general limiter with correct config", () => {
      expect(RATE_LIMITS.GENERAL.maxRequests).toBe(100);
      expect(RATE_LIMITS.GENERAL.windowMs).toBe(60000);
    });

    it("has diagram create limiter with strict config", () => {
      expect(RATE_LIMITS.DIAGRAM_CREATE.maxRequests).toBe(10);
    });

    it("has agent run limiter with very strict config", () => {
      expect(RATE_LIMITS.AGENT_RUN.maxRequests).toBe(5);
    });

    it("has admin limiter with strict config (prevents DoS)", () => {
      expect(RATE_LIMITS.ADMIN.maxRequests).toBe(5);
      expect(RATE_LIMITS.ADMIN.windowMs).toBe(60000);
      expect(RATE_LIMITS.ADMIN.name).toBe("admin");
    });

    it("exposes all rate limiters including admin", () => {
      expect(rateLimiters.general).toBeDefined();
      expect(rateLimiters.diagramCreate).toBeDefined();
      expect(rateLimiters.agentRun).toBeDefined();
      expect(rateLimiters.layout).toBeDefined();
      expect(rateLimiters.export).toBeDefined();
      expect(rateLimiters.admin).toBeDefined();
    });
  });

  describe("getRateLimitStatus", () => {
    it("returns status for existing client", async () => {
      const app = new Hono();
      const limiter = createRateLimiter(RATE_LIMITS.GENERAL);
      app.use("*", limiter);
      app.get("/test", (c) => c.json({ ok: true }));

      // Make a request
      await app.request("/test", {
        headers: { "X-Forwarded-For": "status-test-ip" },
      });

      const status = getRateLimitStatus("status-test-ip", "general");
      expect(status).not.toBeNull();
      expect(status!.requests).toBe(1);
      expect(status!.maxRequests).toBe(100);
    });

    it("returns null for unknown limiter name", () => {
      const status = getRateLimitStatus("any-ip", "unknown-limiter");
      expect(status).toBeNull();
    });

    it("returns zero requests for new client", () => {
      const status = getRateLimitStatus("new-client-ip", "general");
      expect(status).not.toBeNull();
      expect(status!.requests).toBe(0);
    });
  });

  describe("clearRateLimitState", () => {
    it("clears all rate limit state", async () => {
      const app = new Hono();
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60000, name: "test-clear" });
      app.use("*", limiter);
      app.get("/test", (c) => c.json({ ok: true }));

      // Use up the limit
      await app.request("/test", {
        headers: { "X-Forwarded-For": "192.168.1.5" },
      });

      // Should be blocked
      let res = await app.request("/test", {
        headers: { "X-Forwarded-For": "192.168.1.5" },
      });
      expect(res.status).toBe(429);

      // Clear state
      clearRateLimitState();

      // Should be allowed again
      res = await app.request("/test", {
        headers: { "X-Forwarded-For": "192.168.1.5" },
      });
      expect(res.status).toBe(200);
    });
  });
});
