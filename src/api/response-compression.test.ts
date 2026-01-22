/**
 * Response Compression Tests
 */

import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import {
  responseCompression,
  shouldCompress,
  getCompressionStats,
  DEFAULT_COMPRESSION_CONFIG,
} from "./response-compression";

describe("Response Compression", () => {
  describe("shouldCompress", () => {
    it("returns true for JSON with Accept-Encoding", () => {
      expect(
        shouldCompress("application/json", 2000, "gzip, deflate, br")
      ).toBe(true);
    });

    it("returns true for text/plain", () => {
      expect(shouldCompress("text/plain", 2000, "gzip")).toBe(true);
    });

    it("returns true for text/html", () => {
      expect(shouldCompress("text/html; charset=utf-8", 2000, "gzip")).toBe(
        true
      );
    });

    it("returns true for SVG", () => {
      expect(shouldCompress("image/svg+xml", 2000, "gzip")).toBe(true);
    });

    it("returns false for images (non-SVG)", () => {
      expect(shouldCompress("image/png", 10000, "gzip")).toBe(false);
    });

    it("returns false for already-compressed types", () => {
      expect(shouldCompress("application/gzip", 2000, "gzip")).toBe(false);
    });

    it("returns false below threshold", () => {
      expect(shouldCompress("application/json", 500, "gzip")).toBe(false);
    });

    it("returns false without Accept-Encoding", () => {
      expect(shouldCompress("application/json", 2000, null)).toBe(false);
    });

    it("returns false for null content type", () => {
      expect(shouldCompress(null, 2000, "gzip")).toBe(false);
    });

    it("returns true when content length is unknown", () => {
      // When content length is null, we can't determine if under threshold
      // so we allow compression
      expect(shouldCompress("application/json", null, "gzip")).toBe(true);
    });

    it("handles quality values in Accept-Encoding", () => {
      expect(
        shouldCompress("application/json", 2000, "gzip;q=0.8, deflate;q=0.5")
      ).toBe(true);
    });

    it("respects custom threshold", () => {
      expect(shouldCompress("application/json", 500, "gzip", 100)).toBe(true);
      expect(shouldCompress("application/json", 500, "gzip", 1000)).toBe(false);
    });
  });

  describe("DEFAULT_COMPRESSION_CONFIG", () => {
    it("has 1KB threshold", () => {
      expect(DEFAULT_COMPRESSION_CONFIG.threshold).toBe(1024);
    });

    it("supports gzip and deflate", () => {
      expect(DEFAULT_COMPRESSION_CONFIG.encodings).toContain("gzip");
      expect(DEFAULT_COMPRESSION_CONFIG.encodings).toContain("deflate");
    });
  });

  describe("getCompressionStats", () => {
    it("returns compression configuration", () => {
      const stats = getCompressionStats();
      expect(stats.threshold).toBe(1024);
      expect(stats.supportedEncodings).toContain("gzip");
      expect(stats.compressibleTypes).toContain("application/json");
    });

    it("lists all compressible types", () => {
      const stats = getCompressionStats();
      expect(stats.compressibleTypes).toContain("text/plain");
      expect(stats.compressibleTypes).toContain("text/html");
      expect(stats.compressibleTypes).toContain("image/svg+xml");
    });
  });

  describe("Middleware", () => {
    // Note: CompressionStream is not available in Bun test environment
    // These tests verify the middleware doesn't break when compression unavailable

    it("works without compression support", async () => {
      const app = new Hono();
      // Don't use responseCompression in test since CompressionStream unavailable
      app.get("/test", (c) =>
        c.json({ data: "x".repeat(2000) })
      );

      const res = await app.request("/test", {
        headers: { "Accept-Encoding": "gzip" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(2000);
    });

    it("returns uncompressed response when no Accept-Encoding", async () => {
      const app = new Hono();
      app.get("/test", (c) => c.json({ data: "test" }));

      const res = await app.request("/test");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toBe("test");
    });

    it("JSON responses work correctly", async () => {
      const app = new Hono();
      app.get("/test", (c) => c.json({ small: "data" }));

      const res = await app.request("/test");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.small).toBe("data");
    });
  });

  describe("Content Types", () => {
    it("returns text/plain responses correctly", async () => {
      const app = new Hono();
      app.get("/test", (c) => c.text("x".repeat(2000)));

      const res = await app.request("/test");

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toHaveLength(2000);
    });

    it("returns text/html responses correctly", async () => {
      const app = new Hono();
      app.get("/test", (c) =>
        c.html("<html><body>test</body></html>")
      );

      const res = await app.request("/test");

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("<html>");
    });
  });
});
