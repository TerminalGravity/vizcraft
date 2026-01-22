/**
 * Request Context using AsyncLocalStorage
 *
 * Provides request-scoped context that propagates through async operations.
 * Enables consistent logging with request IDs and timing measurements.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, Next } from "hono";
import { nanoid } from "nanoid";
import { createLogger } from "../logging";

const log = createLogger("request");

export interface RequestContext {
  /** Unique request identifier */
  requestId: string;
  /** Request start time (high-resolution) */
  startTime: number;
  /** Request path */
  path: string;
  /** HTTP method */
  method: string;
  /** User-Agent header */
  userAgent?: string;
  /** Client IP address */
  clientIP?: string;
}

// The AsyncLocalStorage instance for request context
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context, if any
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Get the current request ID, or generate a fallback
 */
export function getRequestId(): string {
  const ctx = requestContextStorage.getStore();
  return ctx?.requestId || `no-ctx-${nanoid(8)}`;
}

/**
 * Calculate elapsed time since request start
 */
export function getElapsedMs(): number {
  const ctx = requestContextStorage.getStore();
  if (!ctx) return 0;
  return performance.now() - ctx.startTime;
}

/**
 * Run a function within a request context
 */
export function runWithContext<T>(
  context: RequestContext,
  fn: () => T
): T {
  return requestContextStorage.run(context, fn);
}

/**
 * Create a new request context
 */
export function createRequestContext(
  requestId: string,
  path: string,
  method: string,
  userAgent?: string,
  clientIP?: string
): RequestContext {
  return {
    requestId,
    startTime: performance.now(),
    path,
    method,
    userAgent,
    clientIP,
  };
}

/**
 * Request headers for tracing
 */
export const REQUEST_ID_HEADER = "X-Request-ID";
export const RESPONSE_TIME_HEADER = "X-Response-Time";

/**
 * Request context middleware for Hono
 *
 * Creates a request context with a unique ID and tracks timing.
 * The context is propagated through all async operations.
 */
export function requestContext(): (
  c: Context,
  next: Next
) => Promise<void | Response> {
  return async (c: Context, next: Next) => {
    // Use provided request ID or generate a new one
    const requestId =
      c.req.header(REQUEST_ID_HEADER) || `req-${nanoid(12)}`;

    // Extract client info
    const userAgent = c.req.header("User-Agent");
    const clientIP =
      c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
      c.req.header("X-Real-IP") ||
      "unknown";

    // Create the context
    const context = createRequestContext(
      requestId,
      c.req.path,
      c.req.method,
      userAgent,
      clientIP
    );

    // Run the request within the context
    return requestContextStorage.run(context, async () => {
      // Set request ID in response headers
      c.header(REQUEST_ID_HEADER, requestId);

      try {
        await next();
      } finally {
        // Calculate and set response time
        const elapsedMs = getElapsedMs();
        c.header(RESPONSE_TIME_HEADER, `${elapsedMs.toFixed(2)}ms`);
      }
    });
  };
}

/**
 * Format a log message with request context
 */
export function formatLogMessage(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  extra?: Record<string, unknown>
): string {
  const ctx = getRequestContext();
  const timestamp = new Date().toISOString();

  const parts = [
    `[${timestamp}]`,
    `[${level.toUpperCase()}]`,
  ];

  if (ctx) {
    parts.push(`[${ctx.requestId}]`);
    parts.push(`[${ctx.method} ${ctx.path}]`);
    parts.push(`[${getElapsedMs().toFixed(1)}ms]`);
  }

  parts.push(message);

  if (extra && Object.keys(extra).length > 0) {
    parts.push(JSON.stringify(extra));
  }

  return parts.join(" ");
}

/**
 * Context-aware logger
 * Uses structured logging with request context
 */
export const ctxLogger = {
  info(message: string, extra?: Record<string, unknown>): void {
    const ctx = getRequestContext();
    log.info(message, { ...extra, requestId: ctx?.requestId, path: ctx?.path });
  },

  warn(message: string, extra?: Record<string, unknown>): void {
    const ctx = getRequestContext();
    log.warn(message, { ...extra, requestId: ctx?.requestId, path: ctx?.path });
  },

  error(message: string, extra?: Record<string, unknown>): void {
    const ctx = getRequestContext();
    log.error(message, { ...extra, requestId: ctx?.requestId, path: ctx?.path });
  },

  debug(message: string, extra?: Record<string, unknown>): void {
    const ctx = getRequestContext();
    log.debug(message, { ...extra, requestId: ctx?.requestId, path: ctx?.path });
  },
};

/**
 * Get request context summary for error responses
 */
export function getContextSummary(): Record<string, string | undefined> {
  const ctx = getRequestContext();
  if (!ctx) return {};

  return {
    requestId: ctx.requestId,
    path: ctx.path,
    method: ctx.method,
    elapsedMs: getElapsedMs().toFixed(2),
  };
}
