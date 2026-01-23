/**
 * Body Limit Middleware Tests
 */

import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import {
  bodyLimit,
  BODY_LIMITS,
  diagramBodyLimit,
  thumbnailBodyLimit,
  customBodyLimit,
  BodyTooLargeError,
  formatBytes,
} from "./body-limit";

describe("Body Limit Middleware", () => {
  describe("BODY_LIMITS", () => {
    it("has DEFAULT limit of 1MB", () => {
      expect(BODY_LIMITS.DEFAULT.maxSize).toBe(1024 * 1024);
    });

    it("has DIAGRAM_SPEC limit of 5MB", () => {
      expect(BODY_LIMITS.DIAGRAM_SPEC.maxSize).toBe(5 * 1024 * 1024);
    });

    it("has THUMBNAIL limit of 2MB", () => {
      expect(BODY_LIMITS.THUMBNAIL.maxSize).toBe(2 * 1024 * 1024);
    });

    it("has EXPORT limit of 512KB", () => {
      expect(BODY_LIMITS.EXPORT.maxSize).toBe(512 * 1024);
    });

    it("has SMALL limit of 256KB", () => {
      expect(BODY_LIMITS.SMALL.maxSize).toBe(256 * 1024);
    });
  });

  describe("BodyTooLargeError", () => {
    it("creates error with max size", () => {
      const err = new BodyTooLargeError(1024 * 1024);
      expect(err.message).toContain("Max: 1024KB");
      expect(err.maxSize).toBe(1024 * 1024);
    });

    it("creates error with actual size", () => {
      const err = new BodyTooLargeError(1024, 2048);
      expect(err.message).toContain("Max: 1KB");
      expect(err.message).toContain("Received: 2KB");
      expect(err.actualSize).toBe(2048);
    });

    it("has correct name", () => {
      const err = new BodyTooLargeError(1024);
      expect(err.name).toBe("BodyTooLargeError");
    });
  });

  describe("formatBytes", () => {
    it("formats bytes", () => {
      expect(formatBytes(512)).toBe("512B");
    });

    it("formats kilobytes", () => {
      expect(formatBytes(1536)).toBe("1.5KB");
    });

    it("formats megabytes", () => {
      expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5MB");
    });
  });

  describe("Middleware", () => {
    it("allows GET requests without checking body", async () => {
      const app = new Hono();
      app.use("*", bodyLimit({ maxSize: 10, name: "test" }));
      app.get("/test", (c) => c.text("OK"));

      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });

    it("allows small POST requests", async () => {
      const app = new Hono();
      app.use("*", bodyLimit({ maxSize: 1024, name: "test" }));
      app.post("/test", async (c) => {
        const body = await c.req.json();
        return c.json(body);
      });

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ small: "data" }),
      });
      expect(res.status).toBe(200);
    });

    it("rejects oversized POST with Content-Length", async () => {
      const app = new Hono();
      app.use("*", bodyLimit({ maxSize: 100, name: "test" }));
      app.post("/test", (c) => c.text("OK"));

      const largeBody = "x".repeat(200);
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(largeBody.length),
        },
        body: largeBody,
      });

      expect(res.status).toBe(413);
      const data = await res.json();
      expect(data.error.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("rejects oversized JSON body", async () => {
      const app = new Hono();
      app.use("*", bodyLimit({ maxSize: 50, name: "test" }));
      app.post("/test", (c) => c.text("OK"));

      const largeBody = JSON.stringify({ data: "x".repeat(100) });
      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: largeBody,
      });

      expect(res.status).toBe(413);
    });

    it("allows PUT requests under limit", async () => {
      const app = new Hono();
      app.use("*", bodyLimit({ maxSize: 1024, name: "test" }));
      app.put("/test", async (c) => {
        const body = await c.req.json();
        return c.json(body);
      });

      const res = await app.request("/test", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ update: true }),
      });
      expect(res.status).toBe(200);
    });

    it("allows PATCH requests under limit", async () => {
      const app = new Hono();
      app.use("*", bodyLimit({ maxSize: 1024, name: "test" }));
      app.patch("/test", async (c) => {
        const body = await c.req.json();
        return c.json(body);
      });

      const res = await app.request("/test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: true }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("Pre-configured Middlewares", () => {
    it("diagramBodyLimit uses DIAGRAM_SPEC limit", async () => {
      const app = new Hono();
      app.use("*", diagramBodyLimit);
      app.post("/test", async (c) => {
        const body = await c.req.json();
        return c.json({ size: JSON.stringify(body).length });
      });

      // Should allow large diagrams (under 5MB)
      const largeSpec = JSON.stringify({
        nodes: Array(1000)
          .fill(null)
          .map((_, i) => ({ id: `node-${i}`, label: `Node ${i}` })),
      });

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: largeSpec,
      });
      expect(res.status).toBe(200);
    });

    it("thumbnailBodyLimit uses THUMBNAIL limit", async () => {
      const app = new Hono();
      app.use("*", thumbnailBodyLimit);
      app.post("/test", (c) => c.text("OK"));

      // Should reject over 2MB
      const overLimit = "x".repeat(3 * 1024 * 1024);
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(overLimit.length),
        },
        body: overLimit,
      });
      expect(res.status).toBe(413);
    });
  });

  describe("customBodyLimit", () => {
    it("creates middleware with custom size", async () => {
      const app = new Hono();
      app.use("*", customBodyLimit(500, "tiny"));
      app.post("/test", (c) => c.text("OK"));

      const smallBody = JSON.stringify({ a: 1 });
      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: smallBody,
      });
      expect(res.status).toBe(200);

      const largeBody = "x".repeat(600);
      const res2 = await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(largeBody.length),
        },
        body: largeBody,
      });
      expect(res2.status).toBe(413);
    });
  });

  describe("Response Format", () => {
    it("returns proper 413 response", async () => {
      const app = new Hono();
      app.use("*", bodyLimit({ maxSize: 100, name: "test" }));
      app.post("/test", (c) => c.text("OK"));

      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "200",
        },
        body: "x".repeat(200),
      });

      expect(res.status).toBe(413);
      const data = await res.json();
      // New standardized error format
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe("PAYLOAD_TOO_LARGE");
      // maxSize is only included in development mode (security)
      if (process.env.NODE_ENV === "development") {
        expect(data.error.maxSize).toBe(100);
      }
    });
  });
});
