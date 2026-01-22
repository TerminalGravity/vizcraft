/**
 * Security Headers Tests
 */

import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import {
  securityHeaders,
  getSecurityHeaders,
  getAPISecurityHeaders,
  apiSecurityHeaders,
  DEFAULT_CONFIG,
  type SecurityHeadersConfig,
} from "./security-headers";

describe("Security Headers", () => {
  describe("getSecurityHeaders", () => {
    it("returns Content-Security-Policy header", () => {
      const headers = getSecurityHeaders();
      expect(headers["Content-Security-Policy"]).toBeDefined();
    });

    it("includes default-src 'self' in CSP", () => {
      const headers = getSecurityHeaders();
      expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    });

    it("allows unsafe-inline for scripts (needed for tldraw)", () => {
      const headers = getSecurityHeaders();
      expect(headers["Content-Security-Policy"]).toContain("'unsafe-inline'");
    });

    it("allows data: and blob: for images", () => {
      const headers = getSecurityHeaders();
      const csp = headers["Content-Security-Policy"];
      expect(csp).toContain("img-src 'self' data: blob:");
    });

    it("allows WebSocket connections", () => {
      const headers = getSecurityHeaders();
      const csp = headers["Content-Security-Policy"];
      expect(csp).toContain("connect-src 'self' ws: wss:");
    });

    it("returns X-Content-Type-Options: nosniff", () => {
      const headers = getSecurityHeaders();
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    });

    it("returns X-Frame-Options: SAMEORIGIN", () => {
      const headers = getSecurityHeaders();
      expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    });

    it("returns X-XSS-Protection header", () => {
      const headers = getSecurityHeaders();
      expect(headers["X-XSS-Protection"]).toBe("1; mode=block");
    });

    it("returns Referrer-Policy header", () => {
      const headers = getSecurityHeaders();
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    });

    it("returns Permissions-Policy header", () => {
      const headers = getSecurityHeaders();
      expect(headers["Permissions-Policy"]).toBeDefined();
      expect(headers["Permissions-Policy"]).toContain("camera=()");
      expect(headers["Permissions-Policy"]).toContain("microphone=()");
    });

    it("returns X-DNS-Prefetch-Control header", () => {
      const headers = getSecurityHeaders();
      expect(headers["X-DNS-Prefetch-Control"]).toBe("off");
    });

    it("returns X-Download-Options header", () => {
      const headers = getSecurityHeaders();
      expect(headers["X-Download-Options"]).toBe("noopen");
    });

    it("returns X-Permitted-Cross-Domain-Policies header", () => {
      const headers = getSecurityHeaders();
      expect(headers["X-Permitted-Cross-Domain-Policies"]).toBe("none");
    });
  });

  describe("HSTS", () => {
    it("includes HSTS in production", () => {
      const config: SecurityHeadersConfig = {
        ...DEFAULT_CONFIG,
        enableHSTS: true,
        isProduction: true,
      };
      const headers = getSecurityHeaders(config);
      expect(headers["Strict-Transport-Security"]).toBeDefined();
      expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
    });

    it("excludes HSTS in development", () => {
      const config: SecurityHeadersConfig = {
        ...DEFAULT_CONFIG,
        enableHSTS: true,
        isProduction: false,
      };
      const headers = getSecurityHeaders(config);
      expect(headers["Strict-Transport-Security"]).toBeUndefined();
    });

    it("excludes HSTS when disabled", () => {
      const config: SecurityHeadersConfig = {
        ...DEFAULT_CONFIG,
        enableHSTS: false,
        isProduction: true,
      };
      const headers = getSecurityHeaders(config);
      expect(headers["Strict-Transport-Security"]).toBeUndefined();
    });
  });

  describe("CSP Configuration", () => {
    it("can disable CSP", () => {
      const config: SecurityHeadersConfig = {
        ...DEFAULT_CONFIG,
        enableCSP: false,
      };
      const headers = getSecurityHeaders(config);
      expect(headers["Content-Security-Policy"]).toBeUndefined();
    });

    it("can merge custom CSP directives", () => {
      const config: SecurityHeadersConfig = {
        ...DEFAULT_CONFIG,
        customCSP: {
          "connect-src": ["'self'", "https://api.example.com"],
        },
      };
      const headers = getSecurityHeaders(config);
      expect(headers["Content-Security-Policy"]).toContain(
        "connect-src 'self' https://api.example.com"
      );
    });

    it("can set custom frame-ancestors", () => {
      const config: SecurityHeadersConfig = {
        ...DEFAULT_CONFIG,
        frameAncestors: ["'self'", "https://trusted.com"],
      };
      const headers = getSecurityHeaders(config);
      expect(headers["Content-Security-Policy"]).toContain(
        "frame-ancestors 'self' https://trusted.com"
      );
    });
  });

  describe("API Security Headers", () => {
    it("includes X-Content-Type-Options", () => {
      const headers = getAPISecurityHeaders();
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    });

    it("includes X-Frame-Options: DENY", () => {
      const headers = getAPISecurityHeaders();
      expect(headers["X-Frame-Options"]).toBe("DENY");
    });

    it("includes Cache-Control: no-store", () => {
      const headers = getAPISecurityHeaders();
      expect(headers["Cache-Control"]).toBe("no-store");
    });
  });

  describe("Middleware", () => {
    it("applies headers to response", async () => {
      const app = new Hono();
      app.use("*", securityHeaders());
      app.get("/test", (c) => c.text("OK"));

      const res = await app.request("/test");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
      expect(res.headers.get("Content-Security-Policy")).toBeDefined();
    });

    it("applies API headers to response", async () => {
      const app = new Hono();
      app.use("*", apiSecurityHeaders());
      app.get("/api/test", (c) => c.json({ ok: true }));

      const res = await app.request("/api/test");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("allows custom configuration", async () => {
      const app = new Hono();
      app.use(
        "*",
        securityHeaders({
          enableCSP: false,
        })
      );
      app.get("/test", (c) => c.text("OK"));

      const res = await app.request("/test");
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });
  });
});
