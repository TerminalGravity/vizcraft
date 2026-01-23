/**
 * Protected Storage Layer with Circuit Breaker
 *
 * Wraps storage operations with circuit breaker protection to handle
 * transient failures like disk issues, locking problems, etc.
 */

import { circuitBreakers, CircuitBreakerError } from "../utils/circuit-breaker";
import { trackDbOperation, setGauge } from "../metrics";
import type { Diagram, DiagramSpec, DiagramVersion } from "../types";

// Import the raw storage
import { storage as rawStorage } from "./db";

/**
 * Execute a synchronous database operation with circuit breaker protection
 */
function withProtection<T>(
  operation: string,
  table: string,
  fn: () => T
): T {
  const cb = circuitBreakers.database;
  const start = performance.now();

  // Check if circuit is open
  if (!cb.canExecute()) {
    trackDbOperation(operation, table, 0, true);
    throw new CircuitBreakerError(
      `Database circuit breaker is OPEN`,
      cb.getRetryAfter()
    );
  }

  try {
    // Execute synchronously
    const result = fn();

    // Record success metrics
    const duration = performance.now() - start;
    trackDbOperation(operation, table, duration, false);

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    trackDbOperation(operation, table, duration, true);

    throw error;
  }
}

/**
 * Execute an async database operation with circuit breaker protection
 */
async function withProtectionAsync<T>(
  operation: string,
  table: string,
  fn: () => Promise<T>
): Promise<T> {
  const cb = circuitBreakers.database;
  const start = performance.now();

  // Check if circuit is open
  if (!cb.canExecute()) {
    trackDbOperation(operation, table, 0, true);
    throw new CircuitBreakerError(
      `Database circuit breaker is OPEN`,
      cb.getRetryAfter()
    );
  }

  try {
    const result = await fn();

    const duration = performance.now() - start;
    trackDbOperation(operation, table, duration, false);

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    trackDbOperation(operation, table, duration, true);

    throw error;
  }
}

/**
 * Protected storage interface - wraps raw storage with circuit breaker
 */
export const protectedStorage = {
  // ==========================================
  // Diagram CRUD operations
  // ==========================================

  /**
   * Create a new diagram
   */
  createDiagram(
    name: string,
    project: string,
    spec: DiagramSpec,
    options: { ownerId?: string | null; isPublic?: boolean } = {}
  ): Diagram {
    // Convert null to undefined to match rawStorage signature
    const sanitizedOptions = {
      ownerId: options.ownerId ?? undefined,
      isPublic: options.isPublic,
    };
    return withProtection("INSERT", "diagrams", () =>
      rawStorage.createDiagram(name, project, spec, sanitizedOptions)
    );
  },

  /**
   * Get a diagram by ID
   */
  getDiagram(id: string): Diagram | null {
    return withProtection("SELECT", "diagrams", () =>
      rawStorage.getDiagram(id)
    );
  },

  /**
   * Update a diagram (with optional optimistic locking)
   */
  updateDiagram(
    id: string,
    spec: DiagramSpec,
    message?: string,
    baseVersion?: number
  ): Diagram | { conflict: true; currentVersion: number } | null {
    return withProtection("UPDATE", "diagrams", () =>
      rawStorage.updateDiagram(id, spec, message, baseVersion)
    );
  },

  /**
   * Transform a diagram using a function with automatic conflict retry
   */
  transformDiagram(
    id: string,
    transform: (spec: DiagramSpec) => DiagramSpec,
    message?: string,
    maxRetries: number = 3
  ): Diagram | null | { error: "MAX_RETRIES_EXCEEDED"; attempts: number } {
    return withProtection("UPDATE", "diagrams", () =>
      rawStorage.transformDiagram(id, transform, message, maxRetries)
    );
  },

  /**
   * Delete a diagram (async due to thumbnail cleanup)
   */
  async deleteDiagram(id: string): Promise<boolean> {
    return withProtectionAsync("DELETE", "diagrams", () =>
      rawStorage.deleteDiagram(id)
    );
  },

  /**
   * List diagrams (simple version)
   */
  listDiagrams(project?: string): Diagram[] {
    return withProtection("SELECT", "diagrams", () =>
      rawStorage.listDiagrams(project)
    );
  },

  /**
   * List diagrams with pagination
   */
  listDiagramsPaginated(options: Parameters<typeof rawStorage.listDiagramsPaginated>[0] = {}) {
    return withProtection("SELECT", "diagrams", () =>
      rawStorage.listDiagramsPaginated(options)
    );
  },

  /**
   * Count diagrams
   */
  countDiagrams(project?: string): number {
    return withProtection("SELECT", "diagrams", () =>
      rawStorage.countDiagrams(project)
    );
  },

  /**
   * Get all diagram IDs (for cleanup operations)
   */
  getAllDiagramIds(): Set<string> {
    return withProtection("SELECT", "diagrams", () =>
      rawStorage.getAllDiagramIds()
    );
  },

  // ==========================================
  // Version operations
  // ==========================================

  /**
   * Get version history for a diagram
   */
  getVersions(diagramId: string): DiagramVersion[] {
    return withProtection("SELECT", "diagram_versions", () =>
      rawStorage.getVersions(diagramId)
    );
  },

  /**
   * Get a specific version
   */
  getVersion(diagramId: string, version: number): DiagramVersion | null {
    return withProtection("SELECT", "diagram_versions", () =>
      rawStorage.getVersion(diagramId, version)
    );
  },

  /**
   * Get the latest version for a diagram
   */
  getLatestVersion(diagramId: string): DiagramVersion | null {
    return withProtection("SELECT", "diagram_versions", () =>
      rawStorage.getLatestVersion(diagramId)
    );
  },

  /**
   * Get versions with pagination (SQL-level pagination)
   */
  getVersionsPaginated(
    diagramId: string,
    limit: number = 20,
    offset: number = 0
  ): { versions: DiagramVersion[]; total: number } {
    return withProtection("SELECT", "diagram_versions", () =>
      rawStorage.getVersionsPaginated(diagramId, limit, offset)
    );
  },

  /**
   * Restore a diagram to a specific version
   */
  restoreVersion(diagramId: string, version: number): Diagram | null {
    return withProtection("UPDATE", "diagrams", () =>
      rawStorage.restoreVersion(diagramId, version)
    );
  },

  // ==========================================
  // Other operations
  // ==========================================

  /**
   * Fork a diagram
   */
  forkDiagram(id: string, newName: string, project?: string): Diagram | null {
    return withProtection("INSERT", "diagrams", () =>
      rawStorage.forkDiagram(id, newName, project)
    );
  },

  /**
   * List projects
   */
  listProjects(): string[] {
    return withProtection("SELECT", "diagrams", () =>
      rawStorage.listProjects()
    );
  },

  /**
   * Get storage statistics
   */
  getStats(): { diagramCount: number; versionCount: number; projectCount: number } {
    return withProtection("SELECT", "diagrams", () =>
      rawStorage.getStats()
    );
  },

  // ==========================================
  // Thumbnail operations (async)
  // ==========================================

  /**
   * Update thumbnail
   */
  async updateThumbnail(id: string, thumbnailDataUrl: string): Promise<boolean> {
    return withProtectionAsync("UPDATE", "thumbnails", () =>
      rawStorage.updateThumbnail(id, thumbnailDataUrl)
    );
  },

  /**
   * Load thumbnail
   */
  async loadThumbnail(id: string): Promise<string | null> {
    return withProtectionAsync("SELECT", "thumbnails", () =>
      rawStorage.loadThumbnail(id)
    );
  },

  /**
   * Check if thumbnail exists
   */
  async hasThumbnail(id: string): Promise<boolean> {
    return withProtectionAsync("SELECT", "thumbnails", () =>
      rawStorage.hasThumbnail(id)
    );
  },

  // ==========================================
  // Share operations
  // ==========================================

  /**
   * Update shares for a diagram
   */
  updateShares(id: string, shares: Array<{ userId: string; permission: "editor" | "viewer" }>): boolean {
    return withProtection("UPDATE", "diagrams", () =>
      rawStorage.updateShares(id, shares)
    );
  },

  /**
   * Add a share to a diagram
   */
  addShare(id: string, userId: string, permission: "editor" | "viewer"): boolean {
    return withProtection("UPDATE", "diagrams", () =>
      rawStorage.addShare(id, userId, permission)
    );
  },

  /**
   * Remove a share from a diagram
   */
  removeShare(id: string, userId: string): boolean {
    return withProtection("UPDATE", "diagrams", () =>
      rawStorage.removeShare(id, userId)
    );
  },

  // ==========================================
  // Ownership operations
  // ==========================================

  /**
   * Update owner of a diagram
   */
  updateOwner(id: string, ownerId: string): boolean {
    return withProtection("UPDATE", "diagrams", () =>
      rawStorage.updateOwner(id, ownerId)
    );
  },

  /**
   * Set public/private status
   */
  setPublic(id: string, isPublic: boolean): boolean {
    return withProtection("UPDATE", "diagrams", () =>
      rawStorage.setPublic(id, isPublic)
    );
  },

  // ==========================================
  // User-scoped queries
  // ==========================================

  /**
   * Count diagrams for a specific user
   */
  countUserDiagrams(ownerId: string): number {
    return withProtection("SELECT", "diagrams", () =>
      rawStorage.countUserDiagrams(ownerId)
    );
  },

  /**
   * List diagrams accessible to a user
   */
  listDiagramsForUser(options: Parameters<typeof rawStorage.listDiagramsForUser>[0]) {
    return withProtection("SELECT", "diagrams", () =>
      rawStorage.listDiagramsForUser(options)
    );
  },

  /**
   * Get version metadata without full spec (efficient for listings)
   */
  getVersionsMetadata(
    diagramId: string,
    limit: number = 20,
    offset: number = 0
  ): { versions: Array<{ version: number; message: string | null; created_at: string }>; total: number } {
    return withProtection("SELECT", "diagram_versions", () =>
      rawStorage.getVersionsMetadata(diagramId, limit, offset)
    );
  },

  // ==========================================
  // Circuit breaker management
  // ==========================================

  /**
   * Get circuit breaker stats
   */
  getCircuitBreakerStats() {
    return circuitBreakers.database.getStats();
  },

  /**
   * Reset circuit breaker (for recovery/testing)
   */
  resetCircuitBreaker() {
    circuitBreakers.database.reset();
  },

  /**
   * Get raw storage for operations that don't need protection
   * (e.g., read-only health checks)
   */
  get raw() {
    return rawStorage;
  },
};

export type ProtectedStorage = typeof protectedStorage;
