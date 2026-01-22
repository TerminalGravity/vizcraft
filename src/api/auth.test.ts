/**
 * Auth API Tests
 *
 * Tests auth middleware and endpoints in isolation
 */

import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import {
  signJWT,
  verifyJWT,
  requireAuth,
  optionalAuth,
  getCurrentUser,
} from "../auth";

describe("Auth API", () => {
  describe("Auth middleware", () => {
    it("requireAuth blocks unauthenticated requests", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.get("/protected", (c) => c.json({ ok: true }));

      const res = await app.request("/protected");
      expect(res.status).toBe(401);
    });

    it("requireAuth allows authenticated requests", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.get("/protected", (c) => c.json({ ok: true }));

      const token = await signJWT({ sub: "user-123", role: "user" });
      const res = await app.request("/protected", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
    });

    it("optionalAuth allows unauthenticated requests", async () => {
      const app = new Hono();
      app.use("*", optionalAuth());
      app.get("/public", (c) => {
        const user = getCurrentUser(c);
        return c.json({ authenticated: !!user });
      });

      const res = await app.request("/public");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authenticated).toBe(false);
    });

    it("optionalAuth sets user context when authenticated", async () => {
      const app = new Hono();
      app.use("*", optionalAuth());
      app.get("/public", (c) => {
        const user = getCurrentUser(c);
        return c.json({
          authenticated: !!user,
          userId: user?.id,
        });
      });

      const token = await signJWT({ sub: "user-456", role: "admin" });
      const res = await app.request("/public", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authenticated).toBe(true);
      expect(body.userId).toBe("user-456");
    });
  });

  describe("Token generation endpoint pattern", () => {
    it("generates valid tokens", async () => {
      const app = new Hono();

      app.post("/api/auth/token", async (c) => {
        const body = await c.req.json();
        const { userId, role = "user" } = body;

        if (!userId) {
          return c.json({ error: "userId required" }, 400);
        }

        const token = await signJWT({ sub: userId, role });
        return c.json({ token, tokenType: "Bearer" });
      });

      const res = await app.request("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "test-user", role: "user" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeDefined();
      expect(body.tokenType).toBe("Bearer");

      // Verify the token works
      const result = await verifyJWT(body.token);
      expect(result.valid).toBe(true);
      expect(result.payload?.sub).toBe("test-user");
    });
  });

  describe("Auth me endpoint pattern", () => {
    it("returns user info when authenticated", async () => {
      const app = new Hono();
      app.use("*", optionalAuth());

      app.get("/api/auth/me", (c) => {
        const user = getCurrentUser(c);
        if (!user) {
          return c.json({ authenticated: false, user: null });
        }
        return c.json({
          authenticated: true,
          user: { id: user.id, role: user.role },
        });
      });

      const token = await signJWT({ sub: "user-789", role: "viewer" });
      const res = await app.request("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authenticated).toBe(true);
      expect(body.user.id).toBe("user-789");
      expect(body.user.role).toBe("viewer");
    });

    it("returns unauthenticated when no token", async () => {
      const app = new Hono();
      app.use("*", optionalAuth());

      app.get("/api/auth/me", (c) => {
        const user = getCurrentUser(c);
        return c.json({
          authenticated: !!user,
          user: user ? { id: user.id, role: user.role } : null,
        });
      });

      const res = await app.request("/api/auth/me");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authenticated).toBe(false);
      expect(body.user).toBeNull();
    });
  });

  describe("Token verification endpoint pattern", () => {
    it("verifies valid tokens", async () => {
      const app = new Hono();

      app.post("/api/auth/verify", async (c) => {
        const body = await c.req.json();
        const { token } = body;

        if (!token) {
          return c.json({ error: "token required" }, 400);
        }

        const result = await verifyJWT(token);
        if (!result.valid) {
          return c.json({ valid: false, error: result.error });
        }

        return c.json({
          valid: true,
          payload: {
            sub: result.payload!.sub,
            role: result.payload!.role,
          },
        });
      });

      const token = await signJWT({ sub: "verify-user", role: "admin" });
      const res = await app.request("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(true);
      expect(body.payload.sub).toBe("verify-user");
      expect(body.payload.role).toBe("admin");
    });

    it("rejects invalid tokens", async () => {
      const app = new Hono();

      app.post("/api/auth/verify", async (c) => {
        const body = await c.req.json();
        const { token } = body;

        const result = await verifyJWT(token);
        return c.json({
          valid: result.valid,
          error: result.error,
        });
      });

      const res = await app.request("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "invalid-token" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(false);
      expect(body.error).toBeDefined();
    });
  });
});
