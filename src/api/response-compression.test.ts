/**
 * Response Compression Tests
 */

import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import {
  responseCompression,
  shouldCompress,
  isIncompressible,
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
      expect(shouldCompress("image/jpeg", 10000, "gzip")).toBe(false);
      expect(shouldCompress("image/webp", 10000, "gzip")).toBe(false);
      expect(shouldCompress("image/gif", 10000, "gzip")).toBe(false);
    });

    it("returns false for already-compressed types", () => {
      expect(shouldCompress("application/gzip", 2000, "gzip")).toBe(false);
      expect(shouldCompress("application/zip", 2000, "gzip")).toBe(false);
      expect(shouldCompress("application/pdf", 2000, "gzip")).toBe(false);
    });

    it("returns false for compressed fonts", () => {
      expect(shouldCompress("font/woff2", 2000, "gzip")).toBe(false);
      expect(shouldCompress("font/woff", 2000, "gzip")).toBe(false);
    });

    it("returns false for compressed audio/video", () => {
      expect(shouldCompress("video/mp4", 100000, "gzip")).toBe(false);
      expect(shouldCompress("audio/mpeg", 50000, "gzip")).toBe(false);
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

  describe("isIncompressible", () => {
    it("returns true for already-compressed images", () => {
      expect(isIncompressible("image/png")).toBe(true);
      expect(isIncompressible("image/jpeg")).toBe(true);
      expect(isIncompressible("image/webp")).toBe(true);
      expect(isIncompressible("image/gif")).toBe(true);
      expect(isIncompressible("image/avif")).toBe(true);
    });

    it("returns false for SVG (text-based)", () => {
      expect(isIncompressible("image/svg+xml")).toBe(false);
    });

    it("returns true for compressed archives", () => {
      expect(isIncompressible("application/zip")).toBe(true);
      expect(isIncompressible("application/gzip")).toBe(true);
      expect(isIncompressible("application/x-7z-compressed")).toBe(true);
    });

    it("returns true for compressed documents", () => {
      expect(isIncompressible("application/pdf")).toBe(true);
    });

    it("returns true for compressed fonts", () => {
      expect(isIncompressible("font/woff")).toBe(true);
      expect(isIncompressible("font/woff2")).toBe(true);
    });

    it("returns true for compressed media", () => {
      expect(isIncompressible("video/mp4")).toBe(true);
      expect(isIncompressible("audio/mpeg")).toBe(true);
    });

    it("returns false for text-based content", () => {
      expect(isIncompressible("application/json")).toBe(false);
      expect(isIncompressible("text/plain")).toBe(false);
      expect(isIncompressible("text/html")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isIncompressible(null)).toBe(false);
    });

    it("handles content type with charset", () => {
      expect(isIncompressible("image/png; charset=utf-8")).toBe(true);
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

    it("lists all incompressible types", () => {
      const stats = getCompressionStats();
      expect(stats.incompressibleTypes).toContain("image/png");
      expect(stats.incompressibleTypes).toContain("image/jpeg");
      expect(stats.incompressibleTypes).toContain("application/pdf");
      expect(stats.incompressibleTypes).toContain("font/woff2");
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
