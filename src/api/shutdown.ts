/**
 * Graceful Shutdown Handler
 *
 * Ensures the server shuts down cleanly by:
 * - Waiting for in-flight requests to complete
 * - Closing WebSocket connections gracefully
 * - Flushing database writes
 */

import type { Context, Next } from "hono";

// Shutdown state
let isShuttingDown = false;
let shutdownPromise: Promise<void> | null = null;
const activeRequests = new Set<symbol>();

// Configuration
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || "30000", 10);
const DRAIN_INTERVAL_MS = 100;

/**
 * Check if server is shutting down
 */
export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * Get count of active requests
 */
export function getActiveRequestCount(): number {
  return activeRequests.size;
}

/**
 * Middleware to track active requests and reject new ones during shutdown
 */
export function shutdownMiddleware() {
  return async (c: Context, next: Next) => {
    if (isShuttingDown) {
      c.header("Connection", "close");
      c.header("Retry-After", "60");
      return c.json(
        {
          error: true,
          code: "SERVICE_UNAVAILABLE",
          message: "Server is shutting down",
        },
        503
      );
    }

    // Track this request
    const requestId = Symbol();
    activeRequests.add(requestId);

    try {
      await next();
    } finally {
      activeRequests.delete(requestId);
    }
  };
}

/**
 * Wait for all active requests to complete (with timeout)
 */
async function drainRequests(): Promise<{ drained: boolean; remaining: number }> {
  const startTime = Date.now();

  while (activeRequests.size > 0) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= SHUTDOWN_TIMEOUT_MS) {
      console.log(
        `[shutdown] Drain timeout reached, ${activeRequests.size} requests still active`
      );
      return { drained: false, remaining: activeRequests.size };
    }

    console.log(
      `[shutdown] Waiting for ${activeRequests.size} requests to complete...`
    );
    await new Promise((resolve) => setTimeout(resolve, DRAIN_INTERVAL_MS));
  }

  return { drained: true, remaining: 0 };
}

/**
 * Callbacks to run during shutdown
 */
type ShutdownCallback = () => Promise<void> | void;
const shutdownCallbacks: Array<{ name: string; callback: ShutdownCallback }> = [];

/**
 * Register a callback to run during shutdown
 */
export function onShutdown(name: string, callback: ShutdownCallback): void {
  shutdownCallbacks.push({ name, callback });
}

/**
 * Initiate graceful shutdown
 */
export async function gracefulShutdown(signal: string): Promise<void> {
  // Prevent multiple shutdown attempts
  if (shutdownPromise) {
    return shutdownPromise;
  }

  isShuttingDown = true;

  shutdownPromise = (async () => {
    console.log(`\n[shutdown] Received ${signal}, starting graceful shutdown...`);
    const startTime = Date.now();

    // Phase 1: Stop accepting new requests (done via middleware)
    console.log("[shutdown] Phase 1: Stopped accepting new requests");

    // Phase 2: Drain in-flight requests
    console.log("[shutdown] Phase 2: Draining in-flight requests...");
    const drainResult = await drainRequests();

    if (drainResult.drained) {
      console.log("[shutdown] All requests completed");
    } else {
      console.log(
        `[shutdown] WARNING: ${drainResult.remaining} requests still active after timeout`
      );
    }

    // Phase 3: Run shutdown callbacks
    console.log(`[shutdown] Phase 3: Running ${shutdownCallbacks.length} cleanup callbacks...`);
    for (const { name, callback } of shutdownCallbacks) {
      try {
        console.log(`[shutdown] Running: ${name}`);
        await callback();
      } catch (err) {
        console.error(`[shutdown] Error in ${name}:`, err);
      }
    }

    // Calculate total shutdown time
    const totalTime = Date.now() - startTime;
    console.log(`[shutdown] Graceful shutdown completed in ${totalTime}ms`);

    // Exit with appropriate code
    const exitCode = drainResult.drained ? 0 : 1;
    process.exit(exitCode);
  })();

  return shutdownPromise;
}

/**
 * Install shutdown signal handlers
 */
export function installShutdownHandlers(): void {
  // Handle SIGTERM (Docker/K8s sends this)
  process.on("SIGTERM", () => {
    gracefulShutdown("SIGTERM");
  });

  // Handle SIGINT (Ctrl+C)
  process.on("SIGINT", () => {
    gracefulShutdown("SIGINT");
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", (err) => {
    console.error("[shutdown] Uncaught exception:", err);
    gracefulShutdown("uncaughtException");
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason, promise) => {
    console.error("[shutdown] Unhandled rejection at:", promise, "reason:", reason);
    // Don't shutdown on unhandled rejection, just log it
  });

  console.log("[shutdown] Graceful shutdown handlers installed");
}

/**
 * Export for testing
 */
export function resetShutdownState(): void {
  isShuttingDown = false;
  shutdownPromise = null;
  activeRequests.clear();
  shutdownCallbacks.length = 0;
}
