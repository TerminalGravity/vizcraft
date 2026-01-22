/**
 * Audit Log Persistence Layer
 *
 * Provides durable storage for audit logs using SQLite while maintaining
 * fast in-memory reads. Uses async batch writes to avoid blocking.
 *
 * Design:
 * - In-memory buffer for hot reads (most recent entries)
 * - Async batch writes to SQLite every N seconds
 * - Retention policy with configurable max age
 * - Graceful shutdown with final flush
 */

import { Database } from "bun:sqlite";
import type { AuditEntry, AuditAction } from "./index";
import { createLogger } from "../logging";

const log = createLogger("audit-persistence");

// ==================== Configuration ====================

export const AUDIT_CONFIG = {
  /** Interval between batch flushes to SQLite (ms) */
  FLUSH_INTERVAL_MS: parseInt(process.env.AUDIT_FLUSH_INTERVAL_MS ?? "5000", 10),

  /** Maximum entries to keep in memory for hot reads */
  MAX_MEMORY_ENTRIES: parseInt(process.env.AUDIT_MAX_MEMORY_ENTRIES ?? "1000", 10),

  /** Maximum entries to write in a single batch */
  BATCH_SIZE: parseInt(process.env.AUDIT_BATCH_SIZE ?? "100", 10),

  /** Days to retain audit logs (0 = forever) */
  RETENTION_DAYS: parseInt(process.env.AUDIT_RETENTION_DAYS ?? "90", 10),

  /** Run cleanup every N flush cycles */
  CLEANUP_FREQUENCY: parseInt(process.env.AUDIT_CLEANUP_FREQUENCY ?? "100", 10),
} as const;

// ==================== Database Setup ====================

const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = `${DATA_DIR}/vizcraft.db`;

// We use the same database as the main app
const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode=WAL");
db.run("PRAGMA synchronous=NORMAL");

// Create audit_logs table
db.run(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    action TEXT NOT NULL,
    user_id TEXT,
    user_role TEXT,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create indexes for efficient querying
db.run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_audit_resource_id ON audit_logs(resource_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)`);
// Composite index for common query: filter by resource, sort by time
db.run(`CREATE INDEX IF NOT EXISTS idx_audit_resource_timestamp ON audit_logs(resource_id, timestamp DESC)`);
// Composite index for user activity reports
db.run(`CREATE INDEX IF NOT EXISTS idx_audit_user_timestamp ON audit_logs(user_id, timestamp DESC)`);

// ==================== State ====================

/** Entries waiting to be persisted */
let pendingWrites: AuditEntry[] = [];

/** In-memory cache for hot reads */
let memoryCache: AuditEntry[] = [];

/** Flush timer handle */
let flushTimer: ReturnType<typeof setInterval> | null = null;

/** Flush cycle counter for cleanup scheduling */
let flushCycleCount = 0;

/** Track if we've loaded initial data from DB */
let initialized = false;

// ==================== Prepared Statements ====================

const insertStmt = db.prepare<void, {
  $timestamp: string;
  $action: string;
  $user_id: string | null;
  $user_role: string | null;
  $resource_type: string;
  $resource_id: string;
  $details: string | null;
  $ip_address: string | null;
  $user_agent: string | null;
}>(`
  INSERT INTO audit_logs (timestamp, action, user_id, user_role, resource_type, resource_id, details, ip_address, user_agent)
  VALUES ($timestamp, $action, $user_id, $user_role, $resource_type, $resource_id, $details, $ip_address, $user_agent)
`);

const selectRecentStmt = db.prepare<{
  timestamp: string;
  action: string;
  user_id: string | null;
  user_role: string | null;
  resource_type: string;
  resource_id: string;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
}, [number]>(`
  SELECT timestamp, action, user_id, user_role, resource_type, resource_id, details, ip_address, user_agent
  FROM audit_logs
  ORDER BY timestamp DESC
  LIMIT ?
`);

const deleteOldStmt = db.prepare<{ deleted: number }, [string]>(`
  DELETE FROM audit_logs WHERE timestamp < ?
`);

const countStmt = db.prepare<{ count: number }, []>(`
  SELECT COUNT(*) as count FROM audit_logs
`);

// ==================== Core Functions ====================

/**
 * Initialize persistence layer and load recent entries into memory
 */
export function initAuditPersistence(): void {
  if (initialized) return;

  // Load recent entries from DB into memory cache
  const rows = selectRecentStmt.all(AUDIT_CONFIG.MAX_MEMORY_ENTRIES);
  memoryCache = rows.map(rowToEntry).reverse(); // Oldest first for consistent ordering

  // Start flush timer
  flushTimer = setInterval(flushPendingWrites, AUDIT_CONFIG.FLUSH_INTERVAL_MS);

  initialized = true;
  log.info("Persistence initialized", { loadedEntries: memoryCache.length });
}

/**
 * Queue an audit entry for persistence
 */
export function queueAuditEntry(entry: AuditEntry): void {
  // Add to pending writes
  pendingWrites.push(entry);

  // Add to memory cache
  memoryCache.push(entry);

  // Trim memory cache if over limit
  while (memoryCache.length > AUDIT_CONFIG.MAX_MEMORY_ENTRIES) {
    memoryCache.shift();
  }
}

/**
 * Flush pending writes to SQLite
 */
export function flushPendingWrites(): number {
  if (pendingWrites.length === 0) {
    flushCycleCount++;
    maybeRunCleanup();
    return 0;
  }

  const toWrite = pendingWrites.splice(0, AUDIT_CONFIG.BATCH_SIZE);
  let written = 0;

  // Use transaction for batch insert
  db.run("BEGIN IMMEDIATE");
  try {
    for (const entry of toWrite) {
      insertStmt.run({
        $timestamp: entry.timestamp,
        $action: entry.action,
        $user_id: entry.userId,
        $user_role: entry.userRole,
        $resource_type: entry.resourceType,
        $resource_id: entry.resourceId,
        $details: entry.details ? JSON.stringify(entry.details) : null,
        $ip_address: entry.ipAddress ?? null,
        $user_agent: entry.userAgent ?? null,
      });
      written++;
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    // Re-queue failed writes
    pendingWrites.unshift(...toWrite);
    log.error("Failed to flush entries", { error: error instanceof Error ? error.message : String(error) });
    return 0;
  }

  flushCycleCount++;
  maybeRunCleanup();

  return written;
}

/**
 * Run cleanup if it's time
 */
function maybeRunCleanup(): void {
  if (AUDIT_CONFIG.RETENTION_DAYS > 0 && flushCycleCount >= AUDIT_CONFIG.CLEANUP_FREQUENCY) {
    flushCycleCount = 0;
    cleanupOldEntries();
  }
}

/**
 * Delete entries older than retention period
 */
export function cleanupOldEntries(): number {
  if (AUDIT_CONFIG.RETENTION_DAYS <= 0) return 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - AUDIT_CONFIG.RETENTION_DAYS);
  const cutoffTimestamp = cutoffDate.toISOString();

  try {
    // SQLite DELETE doesn't return affected rows directly, so we count first
    const countBefore = countStmt.get()?.count ?? 0;
    deleteOldStmt.run(cutoffTimestamp);
    const countAfter = countStmt.get()?.count ?? 0;
    const deleted = countBefore - countAfter;

    if (deleted > 0) {
      log.info("Cleaned up old entries", { deleted, retentionDays: AUDIT_CONFIG.RETENTION_DAYS });
    }

    return deleted;
  } catch (error) {
    log.error("Failed to cleanup old entries", { error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
}

/**
 * Get entries from memory cache (fast path)
 */
export function getMemoryCache(): readonly AuditEntry[] {
  return memoryCache;
}

/**
 * Query persisted audit logs with filters
 */
export function queryAuditLogs(options: {
  limit?: number;
  userId?: string;
  action?: AuditAction;
  resourceId?: string;
  since?: Date;
  until?: Date;
} = {}): AuditEntry[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.userId !== undefined) {
    conditions.push("user_id = ?");
    params.push(options.userId);
  }

  if (options.action) {
    conditions.push("action = ?");
    params.push(options.action);
  }

  if (options.resourceId) {
    conditions.push("resource_id = ?");
    params.push(options.resourceId);
  }

  if (options.since) {
    conditions.push("timestamp >= ?");
    params.push(options.since.toISOString());
  }

  if (options.until) {
    conditions.push("timestamp <= ?");
    params.push(options.until.toISOString());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit ?? 100;

  const query = `
    SELECT timestamp, action, user_id, user_role, resource_type, resource_id, details, ip_address, user_agent
    FROM audit_logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ?
  `;

  const stmt = db.prepare<{
    timestamp: string;
    action: string;
    user_id: string | null;
    user_role: string | null;
    resource_type: string;
    resource_id: string;
    details: string | null;
    ip_address: string | null;
    user_agent: string | null;
  }, (string | number)[]>(query);

  const rows = stmt.all(...params, limit);
  return rows.map(rowToEntry);
}

/**
 * Get statistics about persisted audit logs
 */
export function getPersistedStats(): {
  totalEntries: number;
  oldestEntry: string | null;
  newestEntry: string | null;
  pendingWrites: number;
  memoryCacheSize: number;
} {
  const count = countStmt.get()?.count ?? 0;

  const oldest = db.prepare<{ timestamp: string }, []>(`
    SELECT timestamp FROM audit_logs ORDER BY timestamp ASC LIMIT 1
  `).get();

  const newest = db.prepare<{ timestamp: string }, []>(`
    SELECT timestamp FROM audit_logs ORDER BY timestamp DESC LIMIT 1
  `).get();

  return {
    totalEntries: count,
    oldestEntry: oldest?.timestamp ?? null,
    newestEntry: newest?.timestamp ?? null,
    pendingWrites: pendingWrites.length,
    memoryCacheSize: memoryCache.length,
  };
}

/**
 * Graceful shutdown - flush all pending writes
 */
export function shutdownAuditPersistence(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  // Flush remaining entries
  while (pendingWrites.length > 0) {
    flushPendingWrites();
  }

  log.info("Persistence shutdown complete");
}

/**
 * Clear all audit logs (for testing only)
 */
export function clearPersistedAuditLogs(): void {
  db.run("DELETE FROM audit_logs");
  memoryCache = [];
  pendingWrites = [];
}

// ==================== Helpers ====================

/**
 * Safely parse JSON details from audit log row
 * Returns undefined if parsing fails instead of throwing
 */
function safeParseDetails(json: string, context?: unknown): Record<string, unknown> | undefined {
  try {
    return JSON.parse(json);
  } catch (err) {
    log.warn("Failed to parse audit entry details", {
      error: err instanceof Error ? err.message : String(err),
      context: String(context).slice(0, 100),
      preview: json.slice(0, 50),
    });
    return undefined;
  }
}

function rowToEntry(row: {
  timestamp: string;
  action: string;
  user_id: string | null;
  user_role: string | null;
  resource_type: string;
  resource_id: string;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
}): AuditEntry {
  return {
    timestamp: row.timestamp,
    action: row.action as AuditAction,
    userId: row.user_id,
    userRole: row.user_role,
    resourceType: row.resource_type as "diagram" | "share" | "ownership",
    resourceId: row.resource_id,
    details: row.details ? safeParseDetails(row.details, row.timestamp) : undefined,
    ipAddress: row.ip_address ?? undefined,
    userAgent: row.user_agent ?? undefined,
  };
}

// Auto-initialize on import
initAuditPersistence();
