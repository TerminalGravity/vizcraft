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

// In-memory audit buffer (for production, use a proper logging service)
const auditBuffer: AuditEntry[] = [];
const MAX_BUFFER_SIZE = 1000;

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

  // Add to buffer (ring buffer behavior)
  if (auditBuffer.length >= MAX_BUFFER_SIZE) {
    auditBuffer.shift();
  }
  auditBuffer.push(entry);
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
 * Get recent audit entries (for monitoring/debugging)
 */
export function getAuditLog(options: {
  limit?: number;
  userId?: string;
  action?: AuditAction;
  resourceId?: string;
  since?: Date;
} = {}): AuditEntry[] {
  let entries = [...auditBuffer];

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
 * Clear audit buffer (for testing)
 */
export function clearAuditLog(): void {
  auditBuffer.length = 0;
}

/**
 * Get audit stats
 */
export function getAuditStats(): {
  totalEntries: number;
  actionCounts: Record<string, number>;
  uniqueUsers: number;
} {
  const actionCounts: Record<string, number> = {};
  const userIds = new Set<string | null>();

  for (const entry of auditBuffer) {
    actionCounts[entry.action] = (actionCounts[entry.action] || 0) + 1;
    userIds.add(entry.userId);
  }

  return {
    totalEntries: auditBuffer.length,
    actionCounts,
    uniqueUsers: userIds.size,
  };
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
