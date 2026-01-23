/**
 * HTTP API Rate Limiter
 *
 * Implements a sliding window rate limiting algorithm for HTTP endpoints.
 * Different limits for different operation types.
 */

import type { Context, Next } from "hono";
import { createLogger } from "../logging";
import { getClientIP } from "../utils/ip-trust";

const log = createLogger("rate-limiter");

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
  // Admin/performance operations - very strict (prevents DoS via cache clearing)
  ADMIN: {
    maxRequests: 5,
    windowMs: 60_000, // Only 5 per minute
    name: "admin",
  },
} as const;

// Rate limit state for a single IP/key
interface RateLimitState {
  requests: number[];
  windowStart: number;
  /** Last access timestamp for LRU eviction */
  lastAccess: number;
  /** Creation timestamp for absolute TTL */
  createdAt: number;
}

// In-memory store for rate limit state
// In production, use Redis for distributed rate limiting
const rateLimitStore = new Map<string, RateLimitState>();

// Cleanup configuration (configurable via environment for different deployments)
const CLEANUP_INTERVAL = parseInt(process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS ?? "300000", 10); // 5 minutes default
const MAX_STORE_SIZE = parseInt(process.env.RATE_LIMIT_MAX_STORE ?? "100000", 10); // 100k entries default
const ABSOLUTE_TTL = parseInt(process.env.RATE_LIMIT_TTL_MS ?? "3600000", 10); // 1 hour default
const EVICTION_BATCH_SIZE = parseInt(process.env.RATE_LIMIT_EVICTION_BATCH ?? "100", 10); // 100 entries default
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let lastCleanupTime = Date.now();

/**
 * Evict entries using LRU (Least Recently Used) policy
 * Called when store approaches capacity
 */
function evictLRUEntries(count: number): number {
  if (rateLimitStore.size === 0 || count <= 0) return 0;

  // Sort by lastAccess (oldest first) for LRU eviction
  const entries = Array.from(rateLimitStore.entries())
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  const toEvict = Math.min(count, entries.length);
  for (let i = 0; i < toEvict; i++) {
    const entry = entries[i];
    if (entry) {
      rateLimitStore.delete(entry[0]);
    }
  }

  return toEvict;
}

/**
 * Perform cleanup of stale rate limit entries
 * Uses TTL-based cleanup and LRU eviction for memory management
 */
function performCleanup(): void {
  try {
    const now = Date.now();
    let deleted = 0;

    // Pass 1: Remove entries that have exceeded absolute TTL or are stale
    for (const [key, state] of rateLimitStore.entries()) {
      const entryAge = now - state.createdAt;
      const timeSinceAccess = now - state.lastAccess;

      // Remove if:
      // 1. Entry has exceeded absolute TTL (1 hour)
      // 2. Entry hasn't been accessed in 2x cleanup interval (stale)
      if (entryAge > ABSOLUTE_TTL || timeSinceAccess > CLEANUP_INTERVAL * 2) {
        rateLimitStore.delete(key);
        deleted++;
      }
    }

    // Pass 2: LRU eviction if still over capacity
    if (rateLimitStore.size > MAX_STORE_SIZE) {
      log.warn("Store size exceeds maximum after TTL cleanup, performing LRU eviction", {
        currentSize: rateLimitStore.size,
        maxSize: MAX_STORE_SIZE,
      });
      // Evict least recently used entries to get below 90% capacity
      const targetSize = Math.floor(MAX_STORE_SIZE * 0.9);
      const toEvict = rateLimitStore.size - targetSize;
      deleted += evictLRUEntries(toEvict);
    }

    lastCleanupTime = now;

    if (deleted > 0) {
      log.info("Cleaned up stale entries", { deleted, remaining: rateLimitStore.size });
    }
  } catch (err) {
    // Log error but don't crash - cleanup is best-effort
    log.error("Cleanup failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Start the cleanup interval (idempotent)
 */
function ensureCleanupRunning(): void {
  if (cleanupIntervalId === null) {
    cleanupIntervalId = setInterval(performCleanup, CLEANUP_INTERVAL);
    // Unref to allow process to exit even if interval is running
    if (typeof cleanupIntervalId === "object" && "unref" in cleanupIntervalId) {
      cleanupIntervalId.unref();
    }
    log.info("Cleanup interval started");
  }

  // Check if cleanup has been running - restart if stale
  const timeSinceLastCleanup = Date.now() - lastCleanupTime;
  if (timeSinceLastCleanup > CLEANUP_INTERVAL * 3) {
    log.warn("Cleanup appears stale, forcing cleanup now", { timeSinceLastCleanupMs: timeSinceLastCleanup });
    performCleanup();
  }
}

// Start cleanup on module load
ensureCleanupRunning();

/**
 * Get client identifier from request
 * Only trusts X-Forwarded-For and X-Real-IP headers when the
 * direct connection is from a trusted proxy IP.
 *
 * Security: Without this validation, attackers can spoof their IP
 * by setting X-Forwarded-For headers, bypassing rate limiting.
 */
function getClientKey(c: Context): string {
  // Get direct connection IP from Bun's socket info
  // This is set by Hono's Bun adapter
  const directIP = (c.env as { remoteAddr?: string } | undefined)?.remoteAddr;

  // Get forwarded headers
  const forwardedFor = c.req.header("X-Forwarded-For");
  const realIP = c.req.header("X-Real-IP");

  // Use the utility that validates trust before using forwarded headers
  return getClientIP(directIP, forwardedFor, realIP);
}

/**
 * Check if request is rate limited using sliding window algorithm
 * Includes LRU tracking for efficient memory management
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
    // Proactive eviction: if at capacity, evict before inserting
    if (rateLimitStore.size >= MAX_STORE_SIZE) {
      evictLRUEntries(EVICTION_BATCH_SIZE);
    }

    state = {
      requests: [],
      windowStart: now,
      lastAccess: now,
      createdAt: now,
    };
    rateLimitStore.set(key, state);
  } else {
    // Update last access time for LRU tracking
    state.lastAccess = now;
  }

  // Remove requests outside the current window (in-place to reduce GC pressure)
  // This is an O(n) operation but n is bounded by maxRequests
  let writeIndex = 0;
  for (let i = 0; i < state.requests.length; i++) {
    const timestamp = state.requests[i];
    if (timestamp !== undefined && timestamp > windowStart) {
      state.requests[writeIndex++] = timestamp;
    }
  }
  state.requests.length = writeIndex; // Truncate in-place
  state.windowStart = now;

  // Check if rate limited
  if (state.requests.length >= config.maxRequests) {
    // Find oldest request - array is naturally sorted (timestamps are inserted in order)
    const oldestRequest = state.requests[0] ?? now;
    const resetTime = oldestRequest + config.windowMs;
    return {
      limited: true,
      remaining: 0,
      resetTime,
    };
  }

  // Record this request
  state.requests.push(now);

  // Safety cap: ensure array never exceeds 2x maxRequests (should never happen, but defense-in-depth)
  if (state.requests.length > config.maxRequests * 2) {
    state.requests = state.requests.slice(-config.maxRequests);
  }

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
  admin: createRateLimiter(RATE_LIMITS.ADMIN),
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

/**
 * Stop the cleanup interval (for graceful shutdown)
 */
export function stopRateLimitCleanup(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    log.info("Cleanup interval stopped");
  }
}

/**
 * Get rate limiter stats for monitoring
 */
export function getRateLimiterStats(): {
  storeSize: number;
  maxSize: number;
  lastCleanupTime: number;
  cleanupRunning: boolean;
  absoluteTtlMs: number;
  evictionBatchSize: number;
} {
  return {
    storeSize: rateLimitStore.size,
    maxSize: MAX_STORE_SIZE,
    lastCleanupTime,
    cleanupRunning: cleanupIntervalId !== null,
    absoluteTtlMs: ABSOLUTE_TTL,
    evictionBatchSize: EVICTION_BATCH_SIZE,
  };
}
