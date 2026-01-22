/**
 * Diagram Quota Management
 *
 * Enforces resource limits to prevent abuse and ensure fair usage:
 * - Diagram complexity (nodes, edges)
 * - Spec size (serialized JSON)
 * - Per-user diagram count
 *
 * All limits are configurable via environment variables.
 */

import type { DiagramSpec } from "../types";

// ==================== Configuration ====================

/**
 * Quota configuration - all limits are configurable via environment
 */
export const QUOTAS = {
  /**
   * Maximum nodes per diagram
   * Prevents excessively complex diagrams that would be slow to render
   */
  MAX_NODES_PER_DIAGRAM: parseInt(process.env.MAX_NODES_PER_DIAGRAM ?? "500", 10),

  /**
   * Maximum edges per diagram
   * Edges can be more numerous than nodes in dense graphs
   */
  MAX_EDGES_PER_DIAGRAM: parseInt(process.env.MAX_EDGES_PER_DIAGRAM ?? "1000", 10),

  /**
   * Maximum groups per diagram
   */
  MAX_GROUPS_PER_DIAGRAM: parseInt(process.env.MAX_GROUPS_PER_DIAGRAM ?? "50", 10),

  /**
   * Maximum spec size in bytes (serialized JSON)
   * Prevents storage abuse via large metadata fields
   */
  MAX_SPEC_SIZE_BYTES: parseInt(process.env.MAX_SPEC_SIZE_BYTES ?? String(1024 * 1024), 10), // 1MB

  /**
   * Maximum diagrams per user
   * null = unlimited (for anonymous or admin users)
   */
  MAX_DIAGRAMS_PER_USER: parseInt(process.env.MAX_DIAGRAMS_PER_USER ?? "100", 10),

  /**
   * Maximum sequence messages (for sequence diagrams)
   */
  MAX_MESSAGES_PER_DIAGRAM: parseInt(process.env.MAX_MESSAGES_PER_DIAGRAM ?? "200", 10),

  /**
   * Maximum ER relationships (for ER diagrams)
   */
  MAX_RELATIONSHIPS_PER_DIAGRAM: parseInt(process.env.MAX_RELATIONSHIPS_PER_DIAGRAM ?? "200", 10),
} as const;

// ==================== Error Types ====================

/**
 * Base class for quota violations
 */
export class QuotaExceededError extends Error {
  public readonly code: string;
  public readonly limit: number;
  public readonly actual: number;
  public readonly resource: string;

  constructor(
    message: string,
    code: string,
    resource: string,
    limit: number,
    actual: number
  ) {
    super(message);
    this.name = "QuotaExceededError";
    this.code = code;
    this.resource = resource;
    this.limit = limit;
    this.actual = actual;
  }

  /**
   * Get a user-friendly error response
   */
  toResponse(): { error: string; code: string; details: { resource: string; limit: number; actual: number } } {
    return {
      error: this.message,
      code: this.code,
      details: {
        resource: this.resource,
        limit: this.limit,
        actual: this.actual,
      },
    };
  }
}

// ==================== Validation Functions ====================

/**
 * Result of spec validation
 */
export type SpecValidationResult =
  | { valid: true; specSize: number }
  | { valid: false; error: QuotaExceededError };

/**
 * Validate a diagram spec against all quotas
 *
 * @param spec - The diagram spec to validate
 * @returns Validation result with either success + size, or error
 */
export function validateSpecQuotas(spec: DiagramSpec): SpecValidationResult {
  // Calculate serialized size for size quota
  const specJson = JSON.stringify(spec);
  const specSize = new TextEncoder().encode(specJson).length;

  // Check spec size
  if (specSize > QUOTAS.MAX_SPEC_SIZE_BYTES) {
    return {
      valid: false,
      error: new QuotaExceededError(
        `Diagram spec exceeds maximum size of ${formatBytes(QUOTAS.MAX_SPEC_SIZE_BYTES)} (actual: ${formatBytes(specSize)})`,
        "QUOTA_SPEC_SIZE_EXCEEDED",
        "spec_size",
        QUOTAS.MAX_SPEC_SIZE_BYTES,
        specSize
      ),
    };
  }

  // Check node count
  const nodeCount = spec.nodes?.length ?? 0;
  if (nodeCount > QUOTAS.MAX_NODES_PER_DIAGRAM) {
    return {
      valid: false,
      error: new QuotaExceededError(
        `Diagram exceeds maximum of ${QUOTAS.MAX_NODES_PER_DIAGRAM} nodes (actual: ${nodeCount})`,
        "QUOTA_NODES_EXCEEDED",
        "nodes",
        QUOTAS.MAX_NODES_PER_DIAGRAM,
        nodeCount
      ),
    };
  }

  // Check edge count
  const edgeCount = spec.edges?.length ?? 0;
  if (edgeCount > QUOTAS.MAX_EDGES_PER_DIAGRAM) {
    return {
      valid: false,
      error: new QuotaExceededError(
        `Diagram exceeds maximum of ${QUOTAS.MAX_EDGES_PER_DIAGRAM} edges (actual: ${edgeCount})`,
        "QUOTA_EDGES_EXCEEDED",
        "edges",
        QUOTAS.MAX_EDGES_PER_DIAGRAM,
        edgeCount
      ),
    };
  }

  // Check group count
  const groupCount = spec.groups?.length ?? 0;
  if (groupCount > QUOTAS.MAX_GROUPS_PER_DIAGRAM) {
    return {
      valid: false,
      error: new QuotaExceededError(
        `Diagram exceeds maximum of ${QUOTAS.MAX_GROUPS_PER_DIAGRAM} groups (actual: ${groupCount})`,
        "QUOTA_GROUPS_EXCEEDED",
        "groups",
        QUOTAS.MAX_GROUPS_PER_DIAGRAM,
        groupCount
      ),
    };
  }

  // Check sequence messages (if present)
  const messageCount = spec.messages?.length ?? 0;
  if (messageCount > QUOTAS.MAX_MESSAGES_PER_DIAGRAM) {
    return {
      valid: false,
      error: new QuotaExceededError(
        `Diagram exceeds maximum of ${QUOTAS.MAX_MESSAGES_PER_DIAGRAM} sequence messages (actual: ${messageCount})`,
        "QUOTA_MESSAGES_EXCEEDED",
        "messages",
        QUOTAS.MAX_MESSAGES_PER_DIAGRAM,
        messageCount
      ),
    };
  }

  // Check ER relationships (if present)
  const relationshipCount = spec.relationships?.length ?? 0;
  if (relationshipCount > QUOTAS.MAX_RELATIONSHIPS_PER_DIAGRAM) {
    return {
      valid: false,
      error: new QuotaExceededError(
        `Diagram exceeds maximum of ${QUOTAS.MAX_RELATIONSHIPS_PER_DIAGRAM} relationships (actual: ${relationshipCount})`,
        "QUOTA_RELATIONSHIPS_EXCEEDED",
        "relationships",
        QUOTAS.MAX_RELATIONSHIPS_PER_DIAGRAM,
        relationshipCount
      ),
    };
  }

  return { valid: true, specSize };
}

/**
 * Check if a user can create a new diagram
 *
 * @param currentCount - User's current diagram count
 * @param userId - User ID (null for anonymous)
 * @returns null if allowed, or QuotaExceededError if not
 */
export function checkUserDiagramQuota(
  currentCount: number,
  userId: string | null
): QuotaExceededError | null {
  // Anonymous users have unlimited (they can't be tracked anyway)
  if (!userId) {
    return null;
  }

  if (currentCount >= QUOTAS.MAX_DIAGRAMS_PER_USER) {
    return new QuotaExceededError(
      `User has reached maximum of ${QUOTAS.MAX_DIAGRAMS_PER_USER} diagrams`,
      "QUOTA_USER_DIAGRAMS_EXCEEDED",
      "user_diagrams",
      QUOTAS.MAX_DIAGRAMS_PER_USER,
      currentCount
    );
  }

  return null;
}

/**
 * Validate spec and throw if quota exceeded
 *
 * @param spec - The diagram spec to validate
 * @throws QuotaExceededError if any quota is exceeded
 */
export function assertSpecQuotas(spec: DiagramSpec): void {
  const result = validateSpecQuotas(spec);
  if (!result.valid) {
    throw result.error;
  }
}

// ==================== Utilities ====================

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get current quota configuration (for admin/monitoring)
 */
export function getQuotaConfig(): typeof QUOTAS {
  return { ...QUOTAS };
}
