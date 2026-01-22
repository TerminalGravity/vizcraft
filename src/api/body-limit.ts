/**
 * Body Size Limit Middleware
 *
 * Protects against memory exhaustion from oversized request bodies.
 * Supports route-specific limits and fast rejection via Content-Length.
 */

import type { Context, Next } from "hono";
import { createLogger } from "../logging";

const log = createLogger("body-limit");

export interface BodyLimitConfig {
  /** Maximum body size in bytes */
  maxSize: number;
  /** Name for logging */
  name: string;
}

/**
 * Pre-configured body size limits for different endpoint types
 */
export const BODY_LIMITS = {
  /** Default limit for general requests (1MB) */
  DEFAULT: {
    maxSize: 1024 * 1024,
    name: "default",
  },
  /** Diagram spec limit - diagrams can be complex (5MB) */
  DIAGRAM_SPEC: {
    maxSize: 5 * 1024 * 1024,
    name: "diagram-spec",
  },
  /** Thumbnail upload limit (2MB) */
  THUMBNAIL: {
    maxSize: 2 * 1024 * 1024,
    name: "thumbnail",
  },
  /** Export request limit (512KB) */
  EXPORT: {
    maxSize: 512 * 1024,
    name: "export",
  },
  /** Small data limit for simple updates (256KB) */
  SMALL: {
    maxSize: 256 * 1024,
    name: "small",
  },
} as const;

/**
 * Custom error for body size violations
 */
export class BodyTooLargeError extends Error {
  public readonly maxSize: number;
  public readonly actualSize?: number;

  constructor(maxSize: number, actualSize?: number) {
    const maxKB = Math.round(maxSize / 1024);
    const message = actualSize
      ? `Request body too large. Max: ${maxKB}KB, Received: ${Math.round(actualSize / 1024)}KB`
      : `Request body too large. Max: ${maxKB}KB`;
    super(message);
    this.name = "BodyTooLargeError";
    this.maxSize = maxSize;
    this.actualSize = actualSize;
  }
}

/**
 * Check Content-Length header for fast rejection
 */
function checkContentLength(c: Context, maxSize: number): void {
  const contentLength = c.req.header("Content-Length");
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (!isNaN(length) && length > maxSize) {
      throw new BodyTooLargeError(maxSize, length);
    }
  }
}

/**
 * Body limit middleware factory
 *
 * Creates middleware that enforces a body size limit.
 * First checks Content-Length header for fast rejection,
 * then validates actual body size if header is missing.
 */
export function bodyLimit(
  config: BodyLimitConfig = BODY_LIMITS.DEFAULT
): (c: Context, next: Next) => Promise<void | Response> {
  const { maxSize, name } = config;

  return async (c: Context, next: Next) => {
    // Only check POST, PUT, PATCH requests
    const method = c.req.method;
    if (!["POST", "PUT", "PATCH"].includes(method)) {
      return next();
    }

    try {
      // Fast path: check Content-Length header
      checkContentLength(c, maxSize);

      // For requests without Content-Length, we need to read and check
      // We'll clone the request to peek at the body size
      const contentType = c.req.header("Content-Type") || "";

      // For JSON requests, parse and check size
      if (contentType.includes("application/json")) {
        const body = await c.req.text();
        if (body.length > maxSize) {
          log.warn("Body size exceeds limit", { name, bodySize: body.length, maxSize });
          throw new BodyTooLargeError(maxSize, body.length);
        }

        // Store the parsed body for later use
        // Create a new Request with the body we've already read
        const newReq = new Request(c.req.url, {
          method: c.req.method,
          headers: c.req.raw.headers,
          body: body,
        });

        c.req.raw = newReq;
      }

      await next();
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return c.json(
          {
            error: true,
            code: "PAYLOAD_TOO_LARGE",
            message: err.message,
            maxSize: err.maxSize,
          },
          413
        );
      }
      throw err;
    }
  };
}

/**
 * Create body limit middleware for diagram endpoints
 */
export const diagramBodyLimit = bodyLimit(BODY_LIMITS.DIAGRAM_SPEC);

/**
 * Create body limit middleware for thumbnail endpoints
 */
export const thumbnailBodyLimit = bodyLimit(BODY_LIMITS.THUMBNAIL);

/**
 * Create body limit middleware for export endpoints
 */
export const exportBodyLimit = bodyLimit(BODY_LIMITS.EXPORT);

/**
 * Create body limit middleware for small data endpoints
 */
export const smallBodyLimit = bodyLimit(BODY_LIMITS.SMALL);

/**
 * Create body limit middleware with custom size
 */
export function customBodyLimit(
  maxSizeBytes: number,
  name = "custom"
): (c: Context, next: Next) => Promise<void | Response> {
  return bodyLimit({ maxSize: maxSizeBytes, name });
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
