/**
 * Audit Logging Module
 *
 * Tracks mutations for security and compliance:
 * - Who performed the action
 * - What action was taken
 * - What resource was affected
 * - When it happened
 */

import type { UserContext } from "../auth";

/**
 * Valid audit actions as a const array for runtime validation
 */
export const AUDIT_ACTIONS = [
  "diagram.create",
  "diagram.update",
  "diagram.delete",
  "diagram.fork",
  "diagram.restore",
  "diagram.apply_layout",
  "diagram.apply_theme",
  "diagram.run_agent",
  "diagram.thumbnail_update",
  "share.add",
  "share.remove",
  "ownership.transfer",
  "visibility.change",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Type guard to check if a string is a valid AuditAction
 */
export function isValidAuditAction(value: string | undefined): value is AuditAction {
  return value !== undefined && (AUDIT_ACTIONS as readonly string[]).includes(value);
}

export interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  userId: string | null;
  userRole: string | null;
  resourceType: "diagram" | "share" | "ownership";
  resourceId: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// Import persistence layer for durable audit logs
import {
  queueAuditEntry,
  getMemoryCache,
  queryAuditLogs,
  getPersistedStats,
  flushPendingWrites,
  cleanupOldEntries,
  shutdownAuditPersistence,
  clearPersistedAuditLogs,
  AUDIT_CONFIG,
} from "./persistence";

/**
 * Log an audit event
 */
export function audit(
  action: AuditAction,
  user: UserContext | null,
  resourceId: string,
  details?: Record<string, unknown>,
  context?: { ip?: string; userAgent?: string }
): void {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    action,
    userId: user?.id ?? null,
    userRole: user?.role ?? null,
    resourceType: getResourceType(action),
    resourceId,
    details,
    ipAddress: context?.ip,
    userAgent: context?.userAgent,
  };

  // Log to console in structured format
  console.log(
    JSON.stringify({
      level: "audit",
      ...entry,
    })
  );

  // Queue for persistence (async batch write to SQLite)
  queueAuditEntry(entry);
}

/**
 * Get resource type from action
 */
function getResourceType(action: AuditAction): "diagram" | "share" | "ownership" {
  if (action.startsWith("share.")) return "share";
  if (action.startsWith("ownership.")) return "ownership";
  return "diagram";
}

/**
 * Get recent audit entries from memory cache (fast path)
 * For historical queries beyond the memory cache, use queryPersistedAuditLogs
 */
export function getAuditLog(options: {
  limit?: number;
  userId?: string;
  action?: AuditAction;
  resourceId?: string;
  since?: Date;
} = {}): AuditEntry[] {
  // Use memory cache for hot reads
  let entries = [...getMemoryCache()];

  // Filter by userId
  if (options.userId !== undefined) {
    entries = entries.filter((e) => e.userId === options.userId);
  }

  // Filter by action
  if (options.action) {
    entries = entries.filter((e) => e.action === options.action);
  }

  // Filter by resourceId
  if (options.resourceId) {
    entries = entries.filter((e) => e.resourceId === options.resourceId);
  }

  // Filter by time
  if (options.since) {
    const sinceTime = options.since.getTime();
    entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceTime);
  }

  // Sort by timestamp descending (most recent first)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply limit
  if (options.limit && options.limit > 0) {
    entries = entries.slice(0, options.limit);
  }

  return entries;
}

/**
 * Query persisted audit logs from SQLite
 * Use this for historical queries beyond the memory cache
 */
export function queryPersistedAuditLogs(options: {
  limit?: number;
  userId?: string;
  action?: AuditAction;
  resourceId?: string;
  since?: Date;
  until?: Date;
} = {}): AuditEntry[] {
  return queryAuditLogs(options);
}

/**
 * Clear audit buffer and persisted logs (for testing)
 */
export function clearAuditLog(): void {
  clearPersistedAuditLogs();
}

/**
 * Get audit stats from memory cache
 */
export function getAuditStats(): {
  totalEntries: number;
  actionCounts: Record<string, number>;
  uniqueUsers: number;
} {
  const memoryCache = getMemoryCache();
  const actionCounts: Record<string, number> = {};
  const userIds = new Set<string | null>();

  for (const entry of memoryCache) {
    actionCounts[entry.action] = (actionCounts[entry.action] || 0) + 1;
    userIds.add(entry.userId);
  }

  return {
    totalEntries: memoryCache.length,
    actionCounts,
    uniqueUsers: userIds.size,
  };
}

/**
 * Get comprehensive audit stats including persistence info
 */
export function getAuditStatsExtended(): {
  memory: {
    totalEntries: number;
    actionCounts: Record<string, number>;
    uniqueUsers: number;
  };
  persistence: {
    totalEntries: number;
    oldestEntry: string | null;
    newestEntry: string | null;
    pendingWrites: number;
    memoryCacheSize: number;
  };
  config: typeof AUDIT_CONFIG;
} {
  return {
    memory: getAuditStats(),
    persistence: getPersistedStats(),
    config: AUDIT_CONFIG,
  };
}

/**
 * Manually trigger a flush of pending audit entries to SQLite
 */
export function flushAuditLog(): number {
  return flushPendingWrites();
}

/**
 * Manually trigger cleanup of old audit entries
 */
export function cleanupAuditLog(): number {
  return cleanupOldEntries();
}

/**
 * Graceful shutdown - flushes all pending writes
 */
export function shutdownAuditLog(): void {
  shutdownAuditPersistence();
}

/**
 * Helper to create audit context from request
 */
export function getAuditContext(req: Request): { ip?: string; userAgent?: string } {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        undefined,
    userAgent: req.headers.get("user-agent") || undefined,
  };
}
