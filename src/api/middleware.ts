/**
 * API Middleware and Helpers
 *
 * Reduces code duplication in web-server.ts by providing:
 * - Common middleware patterns
 * - Response helpers
 * - Error handling utilities
 */

import { Context, Next } from "hono";
import { z } from "zod";
import { protectedStorage as storage } from "../storage/protected-storage";
import type { Diagram } from "../types";

// ==================== Error Class ====================

/**
 * API Error with code and status
 */
export class APIError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400
  ) {
    super(message);
    this.name = "APIError";
  }
}

// ==================== Response Helpers ====================

/**
 * Standard success response
 */
export function success<T>(c: Context, data: T, status: 200 | 201 = 200) {
  return c.json(data, status);
}

/**
 * Standard error response
 */
export function error(
  c: Context,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 500 = 400
) {
  return c.json({ error: true, message, code }, status);
}

/**
 * Not found error
 */
export function notFound(c: Context, resource: string) {
  return error(c, "NOT_FOUND", `${resource} not found`, 404);
}

/**
 * Validation error
 */
export function validationError(c: Context, message: string) {
  return error(c, "VALIDATION_ERROR", message, 400);
}

// ==================== Validation Helpers ====================

/**
 * Nanoid format: URL-safe alphabet (A-Za-z0-9_-)
 * Default length is 12, but we allow 8-21 for flexibility
 * Pattern: /^[A-Za-z0-9_-]{8,21}$/
 */
const NANOID_PATTERN = /^[A-Za-z0-9_-]{8,21}$/;

/**
 * Validate required ID from URL params
 * Enforces nanoid format to prevent injection attacks
 */
export function validateId(id: string | undefined, name = "ID"): string {
  if (!id?.trim()) {
    throw new APIError("INVALID_ID", `${name} is required`, 400);
  }

  const trimmed = id.trim();

  // Validate nanoid format (URL-safe characters only)
  if (!NANOID_PATTERN.test(trimmed)) {
    throw new APIError(
      "INVALID_ID",
      `${name} must be 8-21 characters using only letters, numbers, underscore, or hyphen`,
      400
    );
  }

  return trimmed;
}

/**
 * Validate and parse version number
 */
export function validateVersion(versionStr: string | undefined): number {
  if (!versionStr?.trim()) {
    throw new APIError("INVALID_VERSION", "Version number is required", 400);
  }
  const version = parseInt(versionStr, 10);
  if (isNaN(version) || version < 1) {
    throw new APIError("INVALID_VERSION", "Version must be a positive integer", 400);
  }
  return version;
}

/**
 * Validate request body with Zod schema
 */
export async function validateBody<T extends z.ZodType>(
  c: Context,
  schema: T
): Promise<z.infer<T>> {
  try {
    const body = await c.req.json();
    const result = schema.safeParse(body);

    if (!result.success) {
      const errorMessages = result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      });
      throw new APIError("VALIDATION_ERROR", errorMessages.join("; "), 400);
    }

    return result.data;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new APIError("INVALID_JSON", "Invalid JSON in request body", 400);
    }
    throw err;
  }
}

// ==================== Resource Helpers ====================

/**
 * Get diagram or throw 404
 */
export function requireDiagram(id: string): Diagram {
  const diagram = storage.getDiagram(id);
  if (!diagram) {
    throw new APIError("NOT_FOUND", "Diagram not found", 404);
  }
  return diagram;
}

/**
 * Get diagram version or throw 404
 */
export function requireVersion(diagramId: string, version: number) {
  const ver = storage.getVersion(diagramId, version);
  if (!ver) {
    throw new APIError("VERSION_NOT_FOUND", `Version ${version} not found`, 404);
  }
  return ver;
}

// ==================== Middleware ====================

/**
 * Error handling middleware
 */
export function errorHandler(err: Error, c: Context) {
  console.error(`[API Error] ${c.req.method} ${c.req.path}:`, err);

  if (err instanceof APIError) {
    return c.json(
      { error: true, message: err.message, code: err.code },
      err.status as 400 | 404 | 500
    );
  }

  if (err instanceof SyntaxError) {
    return c.json(
      { error: true, message: "Invalid JSON in request body", code: "INVALID_JSON" },
      400
    );
  }

  return c.json(
    {
      error: true,
      message: "Internal server error",
      code: "INTERNAL_ERROR",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    },
    500
  );
}

/**
 * 404 handler for API routes
 */
export function notFoundHandler(c: Context) {
  if (c.req.path.startsWith("/api")) {
    return c.json(
      {
        error: true,
        message: `API endpoint not found: ${c.req.method} ${c.req.path}`,
        code: "NOT_FOUND",
      },
      404
    );
  }
  return c.text("Not Found", 404);
}

/**
 * Middleware to load diagram from :id param and attach to context
 * Usage: app.get("/api/diagrams/:id/*", withDiagram, handler)
 */
export async function withDiagram(c: Context, next: Next) {
  const id = c.req.param("id");
  const validId = validateId(id, "Diagram ID");
  const diagram = requireDiagram(validId);
  c.set("diagram", diagram);
  c.set("diagramId", validId);
  await next();
}

/**
 * Get diagram from context (set by withDiagram middleware)
 */
export function getDiagramFromContext(c: Context): Diagram {
  const diagram = c.get("diagram") as Diagram | undefined;
  if (!diagram) {
    throw new Error("Diagram not in context - did you use withDiagram middleware?");
  }
  return diagram;
}

/**
 * Get diagram ID from context (set by withDiagram middleware)
 */
export function getDiagramIdFromContext(c: Context): string {
  const id = c.get("diagramId") as string | undefined;
  if (!id) {
    throw new Error("Diagram ID not in context - did you use withDiagram middleware?");
  }
  return id;
}

// ==================== Common Patterns ====================

/**
 * Wrapper for async route handlers with error handling
 */
export function asyncHandler(
  handler: (c: Context) => Promise<Response>
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    try {
      return await handler(c);
    } catch (err) {
      return errorHandler(err as Error, c);
    }
  };
}
