/**
 * Database layer using bun:sqlite
 *
 * Thumbnails are stored as files on the filesystem (via thumbnails module)
 * rather than as base64 data URLs in the database.
 */

import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import type { Diagram, DiagramSpec, DiagramVersion } from "../types";
import { safeParseSpec, VALID_DIAGRAM_TYPES } from "../validation/schemas";
import {
  saveThumbnail,
  loadThumbnail,
  deleteThumbnail,
  thumbnailExists,
  cleanupOrphans as cleanupOrphanThumbnails,
  listThumbnails,
} from "./thumbnails";

const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = `${DATA_DIR}/vizcraft.db`;

// Ensure data directory exists
await Bun.write(`${DATA_DIR}/.gitkeep`, "");

const db = new Database(DB_PATH, { create: true });

// Enable WAL mode for better concurrent read/write performance
// WAL allows readers to not block writers and vice versa
db.run("PRAGMA journal_mode=WAL");

// Set synchronous to NORMAL for better write performance
// NORMAL is safe with WAL mode - data is still durable
db.run("PRAGMA synchronous=NORMAL");

// Increase cache size to 64MB for better read performance
// Negative value = KB, positive = pages
db.run("PRAGMA cache_size=-65536");

// Enable foreign key constraints
db.run("PRAGMA foreign_keys=ON");

// Initialize schema
db.run(`
  CREATE TABLE IF NOT EXISTS diagrams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project TEXT NOT NULL,
    spec TEXT NOT NULL,
    thumbnail_url TEXT,
    version INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

/**
 * Check if a column exists in a table
 * Note: PRAGMA doesn't support parameterized queries, so we construct the query directly.
 * The table name comes from our own code (not user input), so this is safe.
 */
function columnExists(table: string, column: string): boolean {
  // PRAGMA requires direct string interpolation (doesn't support parameterized queries)
  // This is safe because table/column names come from our own migration code
  const rows = db.query<{ name: string }, []>(
    `PRAGMA table_info(${table})`
  ).all();
  return rows.some(row => row.name === column);
}

/**
 * Safely add a column to a table if it doesn't exist
 * Uses PRAGMA table_info to check first, avoiding the need to catch errors
 */
function migrateAddColumn(
  table: string,
  column: string,
  type: string,
  defaultValue?: string | number
): boolean {
  if (columnExists(table, column)) {
    return false; // Column already exists
  }

  const defaultClause = defaultValue !== undefined
    ? ` DEFAULT ${typeof defaultValue === "string" ? `'${defaultValue}'` : defaultValue}`
    : "";

  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}${defaultClause}`);
  console.log(`[db] Added ${column} column to ${table} table`);
  return true;
}

// Migration: Add version column if it doesn't exist (for existing databases)
migrateAddColumn("diagrams", "version", "INTEGER", 1);

// Migration: Add auth columns for ownership and access control
migrateAddColumn("diagrams", "owner_id", "TEXT");
migrateAddColumn("diagrams", "is_public", "INTEGER", 0);
migrateAddColumn("diagrams", "shares", "TEXT");

db.run(`
  CREATE TABLE IF NOT EXISTS diagram_versions (
    id TEXT PRIMARY KEY,
    diagram_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    spec TEXT NOT NULL,
    message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (diagram_id) REFERENCES diagrams(id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    diagram_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    input_version INTEGER,
    output_version INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (diagram_id) REFERENCES diagrams(id)
  )
`);

// Create indexes for better query performance
// Diagrams table indexes
db.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_project ON diagrams(project)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_created_at ON diagrams(created_at)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_updated_at ON diagrams(updated_at)`);
// Composite index for common query pattern: filter by project, sort by updated_at
db.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_project_updated ON diagrams(project, updated_at DESC)`);

// Diagram versions table indexes
db.run(`CREATE INDEX IF NOT EXISTS idx_versions_diagram ON diagram_versions(diagram_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_versions_created_at ON diagram_versions(created_at)`);
// Composite index for version lookups
db.run(`CREATE INDEX IF NOT EXISTS idx_versions_diagram_version ON diagram_versions(diagram_id, version DESC)`);

// Agent runs table indexes
db.run(`CREATE INDEX IF NOT EXISTS idx_agent_runs_diagram ON agent_runs(diagram_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status)`);

// Name search index with case-insensitive collation
// This helps with case-insensitive sorting and prefix searches
db.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_name_nocase ON diagrams(name COLLATE NOCASE)`);

// Owner index for filtering user's diagrams
db.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_owner ON diagrams(owner_id)`);

// Composite index for owner + updated_at for listing user's diagrams
db.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_owner_updated ON diagrams(owner_id, updated_at DESC)`);

// Expression index for diagram type filtering
// Enables efficient queries like: WHERE json_extract(spec, '$.type') IN ('flowchart', 'architecture')
// Without this, SQLite performs a full table scan extracting JSON from every row
db.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_type ON diagrams(json_extract(spec, '$.type'))`);

// FTS5 full-text search virtual table for diagram names
// This enables efficient substring and token-based searching
db.run(`
  CREATE VIRTUAL TABLE IF NOT EXISTS diagrams_fts USING fts5(
    id,
    name,
    project,
    content=diagrams,
    content_rowid=rowid,
    tokenize='trigram'
  )
`);

// Triggers to keep FTS table in sync with diagrams table
db.run(`
  CREATE TRIGGER IF NOT EXISTS diagrams_fts_insert AFTER INSERT ON diagrams BEGIN
    INSERT INTO diagrams_fts(rowid, id, name, project) VALUES (NEW.rowid, NEW.id, NEW.name, NEW.project);
  END
`);

db.run(`
  CREATE TRIGGER IF NOT EXISTS diagrams_fts_delete AFTER DELETE ON diagrams BEGIN
    INSERT INTO diagrams_fts(diagrams_fts, rowid, id, name, project) VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.project);
  END
`);

db.run(`
  CREATE TRIGGER IF NOT EXISTS diagrams_fts_update AFTER UPDATE ON diagrams BEGIN
    INSERT INTO diagrams_fts(diagrams_fts, rowid, id, name, project) VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.project);
    INSERT INTO diagrams_fts(rowid, id, name, project) VALUES (NEW.rowid, NEW.id, NEW.name, NEW.project);
  END
`);

// Migration: Populate FTS table with existing diagrams (for database upgrades)
// This is idempotent - if FTS already has the data, the 'rebuild' command will refresh it
try {
  const ftsCount = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM diagrams_fts").get();
  const diagramCount = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM diagrams").get();

  if (ftsCount && diagramCount && ftsCount.count < diagramCount.count) {
    console.log("[db] Rebuilding FTS index for existing diagrams...");
    // Clear and rebuild FTS content
    db.run("INSERT INTO diagrams_fts(diagrams_fts) VALUES('rebuild')");
    console.log("[db] FTS index rebuilt successfully");
  }
} catch (err) {
  // FTS rebuild failed, log but don't crash - search will fall back to LIKE
  console.warn("[db] FTS index rebuild failed:", err instanceof Error ? err.message : err);
}

// =============================================================================
// Row Types & Helper Functions
// =============================================================================

/**
 * Database row type for basic diagram queries (without ownership fields)
 */
interface BasicDiagramRow {
  id: string;
  name: string;
  project: string;
  spec: string;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Database row type for full diagram queries (with ownership fields)
 */
interface FullDiagramRow extends BasicDiagramRow {
  version: number | null;
  owner_id: string | null;
  is_public: number | null;
  shares: string | null;
}

/**
 * Type alias for rows that may or may not have ownership fields
 */
type DiagramRow = BasicDiagramRow | FullDiagramRow;

/**
 * Parse shares JSON from database row into typed array
 * Handles invalid JSON gracefully by returning empty array
 */
function parseShares(
  sharesJson: string | null
): Array<{ userId: string; permission: "editor" | "viewer" }> {
  if (!sharesJson) return [];

  try {
    const parsed = JSON.parse(sharesJson);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (s): s is { userId: string; permission: "editor" | "viewer" } =>
        typeof s === "object" &&
        s !== null &&
        typeof s.userId === "string" &&
        (s.permission === "editor" || s.permission === "viewer")
    );
  } catch {
    // Invalid JSON, return empty array
    return [];
  }
}

/**
 * Parse a basic database row into a Diagram object with default ownership fields
 * Used by listDiagrams() and listDiagramsPaginated() which don't query ownership columns
 */
function parseBasicRow(row: BasicDiagramRow): Diagram {
  const { spec } = safeParseSpec(row.spec, `diagram:${row.id}`);
  return {
    id: row.id,
    name: row.name,
    project: row.project,
    spec,
    thumbnailUrl: row.thumbnail_url || undefined,
    version: 1, // Default version when not queried
    ownerId: null, // Not available in basic query
    isPublic: false, // Default to private
    shares: [], // Not available in basic query
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Parse a full database row into a complete Diagram object (with ownership fields)
 * Used by getDiagram() and listDiagramsForUser()
 */
function parseFullRow(row: FullDiagramRow): Diagram {
  const { spec } = safeParseSpec(row.spec, `diagram:${row.id}`);
  return {
    id: row.id,
    name: row.name,
    project: row.project,
    spec,
    thumbnailUrl: row.thumbnail_url || undefined,
    version: row.version ?? 1,
    ownerId: row.owner_id,
    isPublic: Boolean(row.is_public),
    shares: parseShares(row.shares),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const storage = {
  // Diagrams
  createDiagram(
    name: string,
    project: string,
    spec: DiagramSpec,
    options: { ownerId?: string; isPublic?: boolean } = {}
  ): Diagram {
    const id = nanoid(12);
    const now = new Date().toISOString();
    const version = 1;
    const ownerId = options.ownerId ?? null;
    const isPublic = options.isPublic ?? false;

    db.run(
      `INSERT INTO diagrams (id, name, project, spec, version, owner_id, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, project, JSON.stringify(spec), version, ownerId, isPublic ? 1 : 0, now, now]
    );

    // Create initial version
    this.createVersion(id, spec, "Initial version");

    return {
      id,
      name,
      project,
      spec,
      version,
      ownerId,
      isPublic,
      shares: [],
      createdAt: now,
      updatedAt: now,
    };
  },

  getDiagram(id: string): Diagram | null {
    const row = db.query<FullDiagramRow, [string]>(
      `SELECT * FROM diagrams WHERE id = ?`
    ).get(id);

    if (!row) return null;

    return parseFullRow(row);
  },

  /**
   * Update diagram with optional optimistic locking
   * @param id - Diagram ID
   * @param spec - New diagram spec
   * @param message - Optional version message
   * @param baseVersion - Optional version to check for optimistic locking
   * @returns Updated diagram, null if not found, or { conflict: true, currentVersion: number } if version mismatch
   */
  updateDiagram(
    id: string,
    spec: DiagramSpec,
    message?: string,
    baseVersion?: number
  ): Diagram | null | { conflict: true; currentVersion: number } {
    const now = new Date().toISOString();

    // If baseVersion is provided, use optimistic locking
    if (baseVersion !== undefined) {
      const result = db.run(
        `UPDATE diagrams SET spec = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
        [JSON.stringify(spec), now, id, baseVersion]
      );

      // No rows affected - either diagram doesn't exist or version mismatch
      if (result.changes === 0) {
        // Check if diagram exists to differentiate between not found and conflict
        const existing = this.getDiagram(id);
        if (!existing) {
          return null;
        }
        // Version mismatch - return conflict
        return { conflict: true, currentVersion: existing.version };
      }
    } else {
      // No optimistic locking - just update (backwards compatible)
      const result = db.run(
        `UPDATE diagrams SET spec = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [JSON.stringify(spec), now, id]
      );

      // Only create version if the diagram actually exists (update affected rows)
      if (result.changes === 0) {
        return null;
      }
    }

    // Create new version
    this.createVersion(id, spec, message);

    return this.getDiagram(id);
  },

  /**
   * Force update diagram without version check (admin operation)
   * Use with caution - can overwrite concurrent changes
   */
  forceUpdateDiagram(id: string, spec: DiagramSpec, message?: string): Diagram | null {
    return this.updateDiagram(id, spec, message) as Diagram | null;
  },

  /**
   * Atomically transform a diagram with conflict retry
   *
   * This is the safe way for server operations to update diagrams.
   * Reads the diagram, applies the transform, and saves with version check.
   * On conflict, automatically retries with fresh data (up to maxRetries).
   *
   * @param id - Diagram ID
   * @param transform - Function that transforms the diagram spec
   * @param message - Version message for the update
   * @param maxRetries - Maximum retry attempts on conflict (default: 3)
   * @returns Updated diagram, null if not found, or error info
   */
  transformDiagram(
    id: string,
    transform: (spec: DiagramSpec) => DiagramSpec,
    message?: string,
    maxRetries: number = 3
  ): Diagram | null | { error: "MAX_RETRIES_EXCEEDED"; attempts: number } {
    let attempts = 0;

    while (attempts < maxRetries) {
      attempts++;

      // Read current state with version
      const current = this.getDiagram(id);
      if (!current) {
        return null;
      }

      // Apply transformation
      const transformedSpec = transform(current.spec);

      // Attempt to save with version check
      const result = this.updateDiagram(id, transformedSpec, message, current.version);

      // Success - return the updated diagram
      if (result && !("conflict" in result)) {
        return result;
      }

      // Not found (shouldn't happen but handle it)
      if (result === null) {
        return null;
      }

      // Conflict - retry with fresh data
      // Log conflict in development for debugging
      if (process.env.NODE_ENV !== "production") {
        console.log(
          `[db] transformDiagram conflict for ${id}: expected v${current.version}, found v${result.currentVersion}. Retry ${attempts}/${maxRetries}`
        );
      }
    }

    // Exceeded max retries - this indicates high contention
    console.warn(
      `[db] transformDiagram exceeded max retries for ${id} after ${attempts} attempts`
    );
    return { error: "MAX_RETRIES_EXCEEDED", attempts };
  },

  async deleteDiagram(id: string): Promise<boolean> {
    // Delete database records FIRST (in a transaction), then thumbnail
    // This ordering prevents the race condition where the diagram exists
    // but the thumbnail is gone. Orphaned thumbnails are cleaned up later.
    const deleteDb = db.transaction(() => {
      db.run(`DELETE FROM diagram_versions WHERE diagram_id = ?`, [id]);
      db.run(`DELETE FROM agent_runs WHERE diagram_id = ?`, [id]);
      return db.run(`DELETE FROM diagrams WHERE id = ?`, [id]);
    });

    const result = deleteDb();
    const deleted = result.changes > 0;

    if (deleted) {
      // Delete thumbnail after DB records are gone
      // If this fails, the thumbnail becomes orphaned and will be cleaned up
      // by cleanupOrphanedThumbnails - but the data is consistent
      try {
        await deleteThumbnail(id);
      } catch (err) {
        console.warn(`[db] Failed to delete thumbnail for ${id}, will be cleaned up later:`, err);
      }
    }

    return deleted;
  },

  /**
   * Get all diagram IDs efficiently (for cleanup operations)
   * This is much faster than listDiagrams when you only need IDs
   */
  getAllDiagramIds(): Set<string> {
    type IdRow = { id: string };
    const rows = db.query<IdRow, []>(`SELECT id FROM diagrams`).all();
    return new Set(rows.map((row) => row.id));
  },

  /**
   * List diagrams with optional pagination and filtering
   * @deprecated Use listDiagramsPaginated for large datasets
   */
  listDiagrams(project?: string): Diagram[] {
    const rows = project
      ? db.query<BasicDiagramRow, [string]>(
          `SELECT id, name, project, spec, thumbnail_url, created_at, updated_at FROM diagrams WHERE project = ? ORDER BY updated_at DESC`
        ).all(project)
      : db.query<BasicDiagramRow, []>(
          `SELECT id, name, project, spec, thumbnail_url, created_at, updated_at FROM diagrams ORDER BY updated_at DESC`
        ).all();

    return rows.map(parseBasicRow);
  },

  /**
   * List diagrams with SQL-level pagination for better performance
   */
  listDiagramsPaginated(options: {
    project?: string;
    limit?: number;
    offset?: number;
    sortBy?: "createdAt" | "updatedAt" | "name";
    sortOrder?: "asc" | "desc";
    search?: string;
    types?: string[];
    createdAfter?: string;
    createdBefore?: string;
    updatedAfter?: string;
    updatedBefore?: string;
  } = {}): { data: Diagram[]; total: number } {
    const {
      project,
      limit = 20,
      offset = 0,
      sortBy = "updatedAt",
      sortOrder = "desc",
      search,
      types,
      createdAfter,
      createdBefore,
      updatedAfter,
      updatedBefore,
    } = options;

    // Build WHERE conditions
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (project) {
      conditions.push("project = ?");
      params.push(project);
    }

    if (search) {
      // Use FTS5 with trigram tokenizer for efficient substring search
      // Trigram tokenizer splits text into 3-character sequences, enabling substring matching
      // Escape special FTS5 characters to prevent query syntax errors
      const escapedSearch = search.replace(/["\-*()]/g, " ").trim();
      if (escapedSearch.length >= 3) {
        // FTS5 trigram requires at least 3 characters for efficient matching
        conditions.push("id IN (SELECT id FROM diagrams_fts WHERE name MATCH ?)");
        params.push(`"${escapedSearch}"`);
      } else {
        // Fall back to LIKE for very short searches (1-2 chars)
        // Use COLLATE NOCASE for case-insensitive comparison
        conditions.push("name LIKE ? COLLATE NOCASE");
        params.push(`%${search}%`);
      }
    }

    if (types && types.length > 0) {
      // Validate types against the DiagramTypeSchema enum to prevent SQL injection
      // and ensure only valid types are queried
      // Cast to allow has() to accept string (we're just checking membership)
      const validTypes = types.filter(t => (VALID_DIAGRAM_TYPES as Set<string>).has(t));
      if (validTypes.length > 0) {
        // Filter by diagram type (stored in spec.type)
        const typePlaceholders = validTypes.map(() => "?").join(", ");
        conditions.push(`json_extract(spec, '$.type') IN (${typePlaceholders})`);
        params.push(...validTypes);
      } else {
        // User requested specific types but ALL were invalid/unknown
        // Return empty result (no diagrams match nonexistent types)
        return { data: [], total: 0 };
      }
    }

    // Date range filters - SQLite stores ISO timestamps as TEXT which sort lexicographically
    if (createdAfter) {
      conditions.push("created_at >= ?");
      params.push(createdAfter);
    }
    if (createdBefore) {
      conditions.push("created_at <= ?");
      params.push(createdBefore);
    }
    if (updatedAfter) {
      conditions.push("updated_at >= ?");
      params.push(updatedAfter);
    }
    if (updatedBefore) {
      conditions.push("updated_at <= ?");
      params.push(updatedBefore);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    // Map sortBy to column names
    const sortColumn = sortBy === "createdAt"
      ? "created_at"
      : sortBy === "name"
      ? "name"
      : "updated_at";

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM diagrams ${whereClause}`;
    const countRow = db.query<{ total: number }, (string | number)[]>(countQuery).get(...params);
    const total = countRow?.total ?? 0;

    // Get paginated data
    const dataQuery = `
      SELECT id, name, project, spec, thumbnail_url, created_at, updated_at FROM diagrams
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}
      LIMIT ? OFFSET ?
    `;

    const rows = db.query<BasicDiagramRow, (string | number)[]>(dataQuery)
      .all(...params, limit, offset);

    return { data: rows.map(parseBasicRow), total };
  },

  /**
   * Count diagrams matching criteria
   */
  countDiagrams(project?: string): number {
    if (project) {
      const row = db.query<{ count: number }, [string]>(
        `SELECT COUNT(*) as count FROM diagrams WHERE project = ?`
      ).get(project);
      return row?.count ?? 0;
    }
    const row = db.query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM diagrams`
    ).get();
    return row?.count ?? 0;
  },

  // Versions
  createVersion(diagramId: string, spec: DiagramSpec, message?: string): DiagramVersion {
    const id = nanoid(12);
    const now = new Date().toISOString();

    // Use transaction to prevent race condition where two concurrent calls
    // both read the same MAX(version) and try to insert duplicate version numbers
    const createVersionTx = db.transaction(() => {
      // Get next version number (inside transaction for atomicity)
      const lastVersion = db.query<{ version: number }, [string]>(
        `SELECT MAX(version) as version FROM diagram_versions WHERE diagram_id = ?`
      ).get(diagramId);

      const version = (lastVersion?.version || 0) + 1;

      db.run(
        `INSERT INTO diagram_versions (id, diagram_id, version, spec, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, diagramId, version, JSON.stringify(spec), message || null, now]
      );

      return version;
    });

    const version = createVersionTx();

    return {
      id,
      diagramId,
      version,
      spec,
      message,
      createdAt: now,
    };
  },

  /**
   * Get all versions for a diagram
   * @deprecated Use getVersionsPaginated for large version histories
   */
  getVersions(diagramId: string): DiagramVersion[] {
    const rows = db.query<{ id: string; diagram_id: string; version: number; spec: string; message: string | null; created_at: string }, [string]>(
      `SELECT * FROM diagram_versions WHERE diagram_id = ? ORDER BY version DESC`
    ).all(diagramId);

    return rows.map(row => {
      const { spec } = safeParseSpec(row.spec, `version:${diagramId}:${row.version}`);
      return {
        id: row.id,
        diagramId: row.diagram_id,
        version: row.version,
        spec,
        message: row.message || undefined,
        createdAt: row.created_at,
      };
    });
  },

  /**
   * Get versions with SQL-level pagination
   * More efficient than getVersions for large version histories
   */
  getVersionsPaginated(
    diagramId: string,
    limit: number = 20,
    offset: number = 0
  ): { versions: DiagramVersion[]; total: number } {
    type VersionRow = {
      id: string;
      diagram_id: string;
      version: number;
      spec: string;
      message: string | null;
      created_at: string;
    };

    // Get total count first
    const countRow = db.query<{ total: number }, [string]>(
      `SELECT COUNT(*) as total FROM diagram_versions WHERE diagram_id = ?`
    ).get(diagramId);
    const total = countRow?.total ?? 0;

    // Get paginated versions (newest first)
    const rows = db.query<VersionRow, [string, number, number]>(
      `SELECT * FROM diagram_versions WHERE diagram_id = ? ORDER BY version DESC LIMIT ? OFFSET ?`
    ).all(diagramId, limit, offset);

    const versions = rows.map(row => {
      const { spec } = safeParseSpec(row.spec, `version:${diagramId}:${row.version}`);
      return {
        id: row.id,
        diagramId: row.diagram_id,
        version: row.version,
        spec,
        message: row.message || undefined,
        createdAt: row.created_at,
      };
    });

    return { versions, total };
  },

  /**
   * Get version metadata without specs (lightweight)
   * Useful for listing/overview where specs aren't needed
   */
  getVersionsMetadata(
    diagramId: string,
    limit: number = 50
  ): Array<{ id: string; version: number; message?: string; createdAt: string }> {
    type MetadataRow = {
      id: string;
      version: number;
      message: string | null;
      created_at: string;
    };

    const rows = db.query<MetadataRow, [string, number]>(
      `SELECT id, version, message, created_at FROM diagram_versions WHERE diagram_id = ? ORDER BY version DESC LIMIT ?`
    ).all(diagramId, limit);

    return rows.map(row => ({
      id: row.id,
      version: row.version,
      message: row.message || undefined,
      createdAt: row.created_at,
    }));
  },

  getVersion(diagramId: string, version: number): DiagramVersion | null {
    const row = db.query<{ id: string; diagram_id: string; version: number; spec: string; message: string | null; created_at: string }, [string, number]>(
      `SELECT * FROM diagram_versions WHERE diagram_id = ? AND version = ?`
    ).get(diagramId, version);

    if (!row) return null;

    const { spec } = safeParseSpec(row.spec, `version:${diagramId}:${row.version}`);
    return {
      id: row.id,
      diagramId: row.diagram_id,
      version: row.version,
      spec,
      message: row.message || undefined,
      createdAt: row.created_at,
    };
  },

  getLatestVersion(diagramId: string): DiagramVersion | null {
    const row = db.query<{ id: string; diagram_id: string; version: number; spec: string; message: string | null; created_at: string }, [string]>(
      `SELECT * FROM diagram_versions WHERE diagram_id = ? ORDER BY version DESC LIMIT 1`
    ).get(diagramId);

    if (!row) return null;

    const { spec } = safeParseSpec(row.spec, `version:${diagramId}:${row.version}`);
    return {
      id: row.id,
      diagramId: row.diagram_id,
      version: row.version,
      spec,
      message: row.message || undefined,
      createdAt: row.created_at,
    };
  },

  restoreVersion(diagramId: string, version: number): Diagram | null {
    const targetVersion = this.getVersion(diagramId, version);
    if (!targetVersion) return null;

    const now = new Date().toISOString();

    // Update diagram to the old version's spec
    db.run(
      `UPDATE diagrams SET spec = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(targetVersion.spec), now, diagramId]
    );

    // Create a new version recording the restore
    this.createVersion(diagramId, targetVersion.spec, `Restored to version ${version}`);

    return this.getDiagram(diagramId);
  },

  forkDiagram(id: string, newName: string, project?: string): Diagram | null {
    const original = this.getDiagram(id);
    if (!original) return null;

    const newId = nanoid(12);
    const now = new Date().toISOString();
    const targetProject = project || original.project;

    db.run(
      `INSERT INTO diagrams (id, name, project, spec, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [newId, newName, targetProject, JSON.stringify(original.spec), now, now]
    );

    // Create initial version with fork reference
    this.createVersion(newId, original.spec, `Forked from ${original.name} (${id})`);

    return this.getDiagram(newId);
  },

  // Thumbnails - stored as files on filesystem
  async updateThumbnail(id: string, thumbnailDataUrl: string): Promise<boolean> {
    // Save thumbnail to filesystem
    const saved = await saveThumbnail(id, thumbnailDataUrl);
    if (!saved) {
      return false;
    }

    // Update diagram's updated_at timestamp
    const result = db.run(
      `UPDATE diagrams SET updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), id]
    );
    return result.changes > 0;
  },

  /**
   * Load a diagram's thumbnail from filesystem
   */
  async loadThumbnail(id: string): Promise<string | null> {
    return loadThumbnail(id);
  },

  /**
   * Check if a thumbnail exists for a diagram
   */
  async hasThumbnail(id: string): Promise<boolean> {
    return thumbnailExists(id);
  },

  /**
   * Delete a diagram's thumbnail
   */
  async deleteThumbnail(id: string): Promise<boolean> {
    return deleteThumbnail(id);
  },

  /**
   * Clean up orphaned thumbnails (thumbnails without matching diagrams)
   */
  async cleanupOrphanedThumbnails(): Promise<number> {
    // Get all diagram IDs
    const rows = db.query<{ id: string }, []>(
      `SELECT id FROM diagrams`
    ).all();
    const existingIds = new Set(rows.map((r) => r.id));

    return cleanupOrphanThumbnails(existingIds);
  },

  // Projects
  listProjects(): string[] {
    const rows = db.query<{ project: string }, []>(
      `SELECT DISTINCT project FROM diagrams ORDER BY project`
    ).all();

    return rows.map(row => row.project);
  },

  /**
   * Get storage statistics for monitoring
   */
  getStats(): { diagramCount: number; versionCount: number; projectCount: number } {
    const diagramCount = db.query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM diagrams`
    ).get()?.count ?? 0;

    const versionCount = db.query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM diagram_versions`
    ).get()?.count ?? 0;

    const projectCount = db.query<{ count: number }, []>(
      `SELECT COUNT(DISTINCT project) as count FROM diagrams`
    ).get()?.count ?? 0;

    return { diagramCount, versionCount, projectCount };
  },

  // Ownership and Access Control
  /**
   * Update diagram ownership (transfer ownership)
   */
  updateOwner(id: string, ownerId: string): boolean {
    const result = db.run(
      `UPDATE diagrams SET owner_id = ?, updated_at = ? WHERE id = ?`,
      [ownerId, new Date().toISOString(), id]
    );
    return result.changes > 0;
  },

  /**
   * Update diagram public/private status
   */
  setPublic(id: string, isPublic: boolean): boolean {
    const result = db.run(
      `UPDATE diagrams SET is_public = ?, updated_at = ? WHERE id = ?`,
      [isPublic ? 1 : 0, new Date().toISOString(), id]
    );
    return result.changes > 0;
  },

  /**
   * Validate a user ID format for share operations
   * User IDs must be non-empty strings with reasonable length and safe characters
   */
  validateUserId(userId: string): boolean {
    // Must be a non-empty string
    if (!userId || typeof userId !== "string") {
      return false;
    }
    // Reasonable length (1-255 chars)
    if (userId.length < 1 || userId.length > 255) {
      return false;
    }
    // Only allow alphanumeric, dash, underscore, and @ (for email-style IDs)
    // This prevents JSON injection and other special character attacks
    if (!/^[a-zA-Z0-9_@.-]+$/.test(userId)) {
      return false;
    }
    return true;
  },

  /**
   * Update diagram shares
   */
  updateShares(id: string, shares: Array<{ userId: string; permission: "editor" | "viewer" }>): boolean {
    // Validate all user IDs before storing
    for (const share of shares) {
      if (!this.validateUserId(share.userId)) {
        console.error(`[db] Invalid userId in share: ${share.userId?.slice(0, 50)}`);
        return false;
      }
    }

    const result = db.run(
      `UPDATE diagrams SET shares = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(shares), new Date().toISOString(), id]
    );
    return result.changes > 0;
  },

  /**
   * Add a share to a diagram
   */
  addShare(id: string, userId: string, permission: "editor" | "viewer"): boolean {
    // Validate userId before any operation
    if (!this.validateUserId(userId)) {
      console.error(`[db] Invalid userId for addShare: ${userId?.slice(0, 50)}`);
      return false;
    }

    const diagram = this.getDiagram(id);
    if (!diagram) return false;

    const shares = diagram.shares || [];
    // Remove existing share for this user if any
    const filtered = shares.filter((s) => s.userId !== userId);
    filtered.push({ userId, permission });

    return this.updateShares(id, filtered);
  },

  /**
   * Remove a share from a diagram
   */
  removeShare(id: string, userId: string): boolean {
    // Validate userId before any operation
    if (!this.validateUserId(userId)) {
      console.error(`[db] Invalid userId for removeShare: ${userId?.slice(0, 50)}`);
      return false;
    }

    const diagram = this.getDiagram(id);
    if (!diagram) return false;

    const shares = diagram.shares || [];
    const filtered = shares.filter((s) => s.userId !== userId);

    return this.updateShares(id, filtered);
  },

  /**
   * List diagrams accessible by a user
   */
  listDiagramsForUser(
    userId: string | null,
    options: {
      project?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): { diagrams: Diagram[]; total: number } {
    const { project, limit = 50, offset = 0 } = options;

    // Validate userId if provided (defense in depth)
    // This prevents LIKE pattern injection even though the query is parameterized
    if (userId !== null && !this.validateUserId(userId)) {
      console.error(`[db] Invalid userId for listDiagramsForUser: ${userId?.slice(0, 50)}`);
      return { diagrams: [], total: 0 };
    }

    // Build WHERE clause based on access:
    // - User owns the diagram
    // - Diagram is public
    // - User is in the shares list
    // - No owner (legacy diagrams)
    let whereClause: string;
    let params: string[];

    if (userId) {
      // Use GLOB instead of LIKE to prevent wildcard injection
      // GLOB wildcards (* and ?) are not in our allowed userId character set
      // whereas LIKE wildcards (% and _) could be exploited via underscore
      whereClause = `
        WHERE (owner_id = ? OR owner_id IS NULL OR is_public = 1 OR shares GLOB ?)
        ${project ? "AND project = ?" : ""}
      `;
      params = project
        ? [userId, `*"userId":"${userId}"*`, project]
        : [userId, `*"userId":"${userId}"*`];
    } else {
      // Anonymous user: only public diagrams or legacy diagrams
      whereClause = `
        WHERE (is_public = 1 OR owner_id IS NULL)
        ${project ? "AND project = ?" : ""}
      `;
      params = project ? [project] : [];
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM diagrams ${whereClause}`;
    const countRow = db.query<{ total: number }, string[]>(countQuery).get(...params);
    const total = countRow?.total ?? 0;

    // Get paginated results
    const query = `
      SELECT * FROM diagrams
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `;
    const rows = db.query<FullDiagramRow, (string | number)[]>(query).all(
      ...params,
      limit,
      offset
    );

    return { diagrams: rows.map(parseFullRow), total };
  },
};

export default storage;
