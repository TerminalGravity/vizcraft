/**
 * HTTP API Rate Limiter
 *
 * Implements a sliding window rate limiting algorithm for HTTP endpoints.
 * Different limits for different operation types.
 */

import type { Context, Next } from "hono";

// Rate limit configuration
export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Unique key for this limiter (e.g., "diagram-create") */
  name: string;
}

// Default rate limits for different operation types
export const RATE_LIMITS = {
  // General API calls - generous limit
  GENERAL: {
    maxRequests: 100,
    windowMs: 60_000, // 100 requests per minute
    name: "general",
  },
  // Diagram creation - moderate limit
  DIAGRAM_CREATE: {
    maxRequests: 10,
    windowMs: 60_000, // 10 per minute
    name: "diagram-create",
  },
  // Agent runs - strict limit (expensive operations)
  AGENT_RUN: {
    maxRequests: 5,
    windowMs: 60_000, // 5 per minute
    name: "agent-run",
  },
  // Layout calculations - moderate limit
  LAYOUT: {
    maxRequests: 20,
    windowMs: 60_000, // 20 per minute
    name: "layout",
  },
  // Export operations
  EXPORT: {
    maxRequests: 30,
    windowMs: 60_000, // 30 per minute
    name: "export",
  },
} as const;

// Rate limit state for a single IP/key
interface RateLimitState {
  requests: number[];
  windowStart: number;
}

// In-memory store for rate limit state
// In production, use Redis for distributed rate limiting
const rateLimitStore = new Map<string, RateLimitState>();

// Cleanup old entries periodically (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of rateLimitStore.entries()) {
    // Remove if no requests in the last 2 windows
    if (now - state.windowStart > CLEANUP_INTERVAL) {
      rateLimitStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Get client identifier from request
 * Uses X-Forwarded-For, X-Real-IP, or falls back to connection info
 */
function getClientKey(c: Context): string {
  return (
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    c.req.header("X-Real-IP") ||
    "unknown"
  );
}

/**
 * Check if request is rate limited using sliding window algorithm
 */
function isRateLimited(key: string, config: RateLimitConfig): {
  limited: boolean;
  remaining: number;
  resetTime: number;
} {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Get or create state
  let state = rateLimitStore.get(key);
  if (!state) {
    state = { requests: [], windowStart: now };
    rateLimitStore.set(key, state);
  }

  // Remove requests outside the current window
  state.requests = state.requests.filter((timestamp) => timestamp > windowStart);
  state.windowStart = now;

  // Check if rate limited
  if (state.requests.length >= config.maxRequests) {
    const oldestRequest = Math.min(...state.requests);
    const resetTime = oldestRequest + config.windowMs;
    return {
      limited: true,
      remaining: 0,
      resetTime,
    };
  }

  // Record this request
  state.requests.push(now);

  return {
    limited: false,
    remaining: config.maxRequests - state.requests.length,
    resetTime: now + config.windowMs,
  };
}

/**
 * Create a rate limiting middleware for a specific configuration
 */
export function createRateLimiter(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    const clientKey = getClientKey(c);
    const storeKey = `${config.name}:${clientKey}`;

    const result = isRateLimited(storeKey, config);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", config.maxRequests.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", Math.ceil(result.resetTime / 1000).toString());

    if (result.limited) {
      c.header("Retry-After", Math.ceil((result.resetTime - Date.now()) / 1000).toString());
      return c.json(
        {
          error: true,
          message: "Too many requests. Please try again later.",
          code: "RATE_LIMITED",
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
        },
        429
      );
    }

    await next();
  };
}

/**
 * Pre-configured rate limiters for common operations
 */
export const rateLimiters = {
  general: createRateLimiter(RATE_LIMITS.GENERAL),
  diagramCreate: createRateLimiter(RATE_LIMITS.DIAGRAM_CREATE),
  agentRun: createRateLimiter(RATE_LIMITS.AGENT_RUN),
  layout: createRateLimiter(RATE_LIMITS.LAYOUT),
  export: createRateLimiter(RATE_LIMITS.EXPORT),
};

/**
 * Get current rate limit status for a client (useful for debugging)
 */
export function getRateLimitStatus(
  clientKey: string,
  limitName: string
): { requests: number; windowMs: number; maxRequests: number } | null {
  const config = Object.values(RATE_LIMITS).find((c) => c.name === limitName);
  if (!config) return null;

  const storeKey = `${limitName}:${clientKey}`;
  const state = rateLimitStore.get(storeKey);

  if (!state) {
    return {
      requests: 0,
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
    };
  }

  const now = Date.now();
  const windowStart = now - config.windowMs;
  const activeRequests = state.requests.filter((t) => t > windowStart).length;

  return {
    requests: activeRequests,
    windowMs: config.windowMs,
    maxRequests: config.maxRequests,
  };
}

/**
 * Clear rate limit state (for testing)
 */
export function clearRateLimitState(): void {
  rateLimitStore.clear();
}
