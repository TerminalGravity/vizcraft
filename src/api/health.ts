/**
 * Health Check Module
 *
 * Provides comprehensive health checks for production monitoring.
 * Checks database, filesystem, memory, and optionally external services.
 */

import { Database } from "bun:sqlite";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

// Health check status types
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheckResult {
  status: "ok" | "error";
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database?: HealthCheckResult;
    filesystem?: HealthCheckResult;
    memory?: HealthCheckResult;
  };
}

// Configuration
const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = `${DATA_DIR}/vizcraft.db`;
const MEMORY_THRESHOLD_MB = parseInt(process.env.MEMORY_LIMIT_MB || "512", 10);
const VERSION = process.env.npm_package_version || "0.1.0";

// Track server start time for uptime calculation
const startTime = Date.now();

/**
 * Check database connectivity and query performance
 */
export async function checkDatabase(): Promise<HealthCheckResult> {
  const start = performance.now();

  try {
    // Open a connection and run a simple query
    const db = new Database(DB_PATH, { readonly: true });
    const result = db.query("SELECT COUNT(*) as count FROM diagrams").get() as { count: number };
    db.close();

    const latencyMs = performance.now() - start;

    return {
      status: "ok",
      latencyMs: Math.round(latencyMs * 100) / 100,
      details: {
        diagramCount: result.count,
      },
    };
  } catch (err) {
    return {
      status: "error",
      latencyMs: performance.now() - start,
      error: err instanceof Error ? err.message : "Database check failed",
    };
  }
}

/**
 * Check filesystem read/write access
 */
export async function checkFilesystem(): Promise<HealthCheckResult> {
  const start = performance.now();
  const testFile = join(DATA_DIR, `.health-check-${Date.now()}`);

  try {
    // Check data directory exists
    if (!existsSync(DATA_DIR)) {
      return {
        status: "error",
        latencyMs: performance.now() - start,
        error: `Data directory ${DATA_DIR} does not exist`,
      };
    }

    // Try to write and read a test file
    const testContent = `health-check-${Date.now()}`;
    writeFileSync(testFile, testContent);

    // Verify file was written
    const file = Bun.file(testFile);
    const readContent = await file.text();

    // Clean up
    unlinkSync(testFile);

    if (readContent !== testContent) {
      return {
        status: "error",
        latencyMs: performance.now() - start,
        error: "Filesystem read/write verification failed",
      };
    }

    return {
      status: "ok",
      latencyMs: Math.round((performance.now() - start) * 100) / 100,
    };
  } catch (err) {
    // Try to clean up if file was created
    try {
      if (existsSync(testFile)) {
        unlinkSync(testFile);
      }
    } catch {
      // Ignore cleanup errors
    }

    return {
      status: "error",
      latencyMs: performance.now() - start,
      error: err instanceof Error ? err.message : "Filesystem check failed",
    };
  }
}

/**
 * Check memory usage
 */
export function checkMemory(): HealthCheckResult {
  const memoryUsage = process.memoryUsage();
  const usedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const totalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
  const rssMB = Math.round(memoryUsage.rss / 1024 / 1024);

  const isOverThreshold = usedMB > MEMORY_THRESHOLD_MB;

  return {
    status: isOverThreshold ? "error" : "ok",
    details: {
      heapUsedMB: usedMB,
      heapTotalMB: totalMB,
      rssMB: rssMB,
      thresholdMB: MEMORY_THRESHOLD_MB,
    },
    ...(isOverThreshold && {
      error: `Memory usage (${usedMB}MB) exceeds threshold (${MEMORY_THRESHOLD_MB}MB)`,
    }),
  };
}

/**
 * Determine overall health status based on individual checks
 */
function determineOverallStatus(checks: HealthResponse["checks"]): HealthStatus {
  const results = Object.values(checks);

  // If any critical check failed, unhealthy
  if (checks.database?.status === "error" || checks.filesystem?.status === "error") {
    return "unhealthy";
  }

  // If memory is over threshold, degraded
  if (checks.memory?.status === "error") {
    return "degraded";
  }

  // All checks passed
  return "healthy";
}

/**
 * Run all health checks and return comprehensive status
 */
export async function runHealthChecks(): Promise<HealthResponse> {
  // Run checks in parallel for speed
  const [databaseResult, filesystemResult] = await Promise.all([
    checkDatabase(),
    checkFilesystem(),
  ]);

  const memoryResult = checkMemory();

  const checks = {
    database: databaseResult,
    filesystem: filesystemResult,
    memory: memoryResult,
  };

  return {
    status: determineOverallStatus(checks),
    timestamp: new Date().toISOString(),
    uptime: Math.round((Date.now() - startTime) / 1000),
    version: VERSION,
    checks,
  };
}

/**
 * Simple liveness check (is the server running?)
 */
export function livenessCheck(): { status: "ok"; timestamp: string } {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Readiness check (is the server ready to accept traffic?)
 */
export async function readinessCheck(): Promise<{ ready: boolean; reason?: string }> {
  try {
    // Check database is accessible
    const dbCheck = await checkDatabase();
    if (dbCheck.status === "error") {
      return { ready: false, reason: `Database: ${dbCheck.error}` };
    }

    // Check filesystem is writable
    const fsCheck = await checkFilesystem();
    if (fsCheck.status === "error") {
      return { ready: false, reason: `Filesystem: ${fsCheck.error}` };
    }

    return { ready: true };
  } catch (err) {
    return {
      ready: false,
      reason: err instanceof Error ? err.message : "Readiness check failed",
    };
  }
}
