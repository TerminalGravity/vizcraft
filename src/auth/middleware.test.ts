/**
 * Auth Middleware Tests
 */

import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { signJWT } from "./jwt";
import {
  requireAuth,
  optionalAuth,
  requireRole,
  getCurrentUser,
  assertAuthenticated,
  AuthenticationError,
} from "./middleware";

describe("Auth Middleware", () => {
  describe("requireAuth", () => {
    it("allows requests with valid token", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.get("/test", (c) => {
        const user = getCurrentUser(c);
        return c.json({ userId: user?.id });
      });

      const token = await signJWT({ sub: "user-123", role: "user" });
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe("user-123");
    });

    it("rejects requests without token", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe("UNAUTHORIZED");
    });

    it("rejects requests with invalid token", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test", {
        headers: { Authorization: "Bearer invalid-token" },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe("INVALID_TOKEN");
    });

    it("rejects expired tokens", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.get("/test", (c) => c.json({ ok: true }));

      const token = await signJWT({ sub: "user-123" }, { expiresInSeconds: -1 });
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(401);
    });

    it("sets user context with role", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.get("/test", (c) => {
        const user = getCurrentUser(c);
        return c.json({ role: user?.role });
      });

      const token = await signJWT({ sub: "user-123", role: "admin" });
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.role).toBe("admin");
    });

    it("defaults to user role if not specified", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.get("/test", (c) => {
        const user = getCurrentUser(c);
        return c.json({ role: user?.role });
      });

      const token = await signJWT({ sub: "user-123" });
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.role).toBe("user");
    });
  });

  describe("optionalAuth", () => {
    it("sets user context when token is valid", async () => {
      const app = new Hono();
      app.use("*", optionalAuth());
      app.get("/test", (c) => {
        const user = getCurrentUser(c);
        return c.json({ userId: user?.id ?? null });
      });

      const token = await signJWT({ sub: "user-123" });
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe("user-123");
    });

    it("allows requests without token", async () => {
      const app = new Hono();
      app.use("*", optionalAuth());
      app.get("/test", (c) => {
        const user = getCurrentUser(c);
        return c.json({ userId: user?.id ?? null });
      });

      const res = await app.request("/test");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBeNull();
    });

    it("ignores invalid tokens and proceeds", async () => {
      const app = new Hono();
      app.use("*", optionalAuth());
      app.get("/test", (c) => {
        const user = getCurrentUser(c);
        return c.json({ userId: user?.id ?? null });
      });

      const res = await app.request("/test", {
        headers: { Authorization: "Bearer invalid-token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBeNull();
    });
  });

  describe("requireRole", () => {
    it("allows users with matching role", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.use("*", requireRole("admin"));
      app.get("/test", (c) => c.json({ ok: true }));

      const token = await signJWT({ sub: "user-123", role: "admin" });
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
    });

    it("rejects users without matching role", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.use("*", requireRole("admin"));
      app.get("/test", (c) => c.json({ ok: true }));

      const token = await signJWT({ sub: "user-123", role: "user" });
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe("FORBIDDEN");
    });

    it("allows multiple roles", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.use("*", requireRole("admin", "user"));
      app.get("/test", (c) => c.json({ ok: true }));

      const token = await signJWT({ sub: "user-123", role: "user" });
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
    });
  });

  describe("AuthenticationError", () => {
    it("has correct default message", () => {
      const error = new AuthenticationError();

      expect(error.message).toBe("User is not authenticated");
      expect(error.name).toBe("AuthenticationError");
    });

    it("supports custom message", () => {
      const error = new AuthenticationError("Custom auth error");

      expect(error.message).toBe("Custom auth error");
    });

    it("has correct code and statusCode", () => {
      const error = new AuthenticationError();

      expect(error.code).toBe("AUTHENTICATION_REQUIRED");
      expect(error.statusCode).toBe(401);
    });

    it("is an instance of Error", () => {
      const error = new AuthenticationError();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AuthenticationError);
    });
  });

  describe("assertAuthenticated", () => {
    it("returns user when authenticated", async () => {
      const app = new Hono();
      app.use("*", requireAuth());
      app.get("/test", (c) => {
        const user = assertAuthenticated(c);
        return c.json({ userId: user.id, role: user.role });
      });

      const token = await signJWT({ sub: "user-456", role: "admin" });
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe("user-456");
      expect(body.role).toBe("admin");
    });

    it("throws AuthenticationError when not authenticated", async () => {
      const app = new Hono();
      app.use("*", optionalAuth());
      app.get("/test", (c) => {
        try {
          assertAuthenticated(c);
          return c.json({ ok: true });
        } catch (error) {
          if (error instanceof AuthenticationError) {
            return c.json(
              { error: true, code: error.code, message: error.message },
              error.statusCode
            );
          }
          throw error;
        }
      });

      const res = await app.request("/test");

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });
});
