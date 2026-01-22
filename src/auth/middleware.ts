/**
 * Authentication Middleware for Hono
 *
 * Provides JWT-based authentication with user context extraction.
 * Supports optional auth for public endpoints and strict auth for protected ones.
 */

import type { Context, Next } from "hono";
import { verifyJWT, type JWTPayload } from "./jwt";

// Extend Hono context with user information
declare module "hono" {
  interface ContextVariableMap {
    user: UserContext | null;
    token: string | null;
  }
}

export interface UserContext {
  id: string;
  role: "admin" | "user" | "viewer";
  payload: JWTPayload;
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Authentication middleware that requires a valid JWT token.
 * Returns 401 Unauthorized if token is missing or invalid.
 */
export function requireAuth() {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    const token = extractBearerToken(authHeader);

    if (!token) {
      return c.json(
        {
          error: true,
          code: "UNAUTHORIZED",
          message: "Authentication required. Provide a valid Bearer token.",
        },
        401
      );
    }

    const result = await verifyJWT(token);

    if (!result.valid || !result.payload) {
      return c.json(
        {
          error: true,
          code: "INVALID_TOKEN",
          message: result.error || "Invalid or expired token",
        },
        401
      );
    }

    // Set user context
    const user: UserContext = {
      id: result.payload.sub,
      role: result.payload.role || "user",
      payload: result.payload,
    };

    c.set("user", user);
    c.set("token", token);

    await next();
  };
}

/**
 * Optional authentication middleware.
 * Sets user context if token is valid, but allows request to proceed without auth.
 * Useful for public endpoints that behave differently for authenticated users.
 */
export function optionalAuth() {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    const token = extractBearerToken(authHeader);

    if (token) {
      const result = await verifyJWT(token);
      if (result.valid && result.payload) {
        const user: UserContext = {
          id: result.payload.sub,
          role: result.payload.role || "user",
          payload: result.payload,
        };
        c.set("user", user);
        c.set("token", token);
      }
    }

    if (!c.get("user")) {
      c.set("user", null);
      c.set("token", null);
    }

    await next();
  };
}

/**
 * Role-based authorization middleware.
 * Must be used after requireAuth().
 * Returns 403 Forbidden if user doesn't have required role.
 */
export function requireRole(...allowedRoles: Array<"admin" | "user" | "viewer">) {
  return async (c: Context, next: Next) => {
    const user = c.get("user");

    if (!user) {
      return c.json(
        {
          error: true,
          code: "UNAUTHORIZED",
          message: "Authentication required",
        },
        401
      );
    }

    if (!allowedRoles.includes(user.role)) {
      return c.json(
        {
          error: true,
          code: "FORBIDDEN",
          message: `This action requires one of these roles: ${allowedRoles.join(", ")}`,
        },
        403
      );
    }

    await next();
  };
}

/**
 * Get current user from context (helper for route handlers)
 */
export function getCurrentUser(c: Context): UserContext | null {
  return c.get("user") || null;
}

/**
 * Assert user is authenticated (throws if not)
 */
export function assertAuthenticated(c: Context): UserContext {
  const user = c.get("user");
  if (!user) {
    throw new Error("User is not authenticated");
  }
  return user;
}
