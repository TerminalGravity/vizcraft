/**
 * Database layer using bun:sqlite
 *
 * Thumbnails are stored as files on the filesystem (via thumbnails module)
 * rather than as base64 data URLs in the database.
 */

import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import type { Diagram, DiagramSpec, DiagramVersion } from "../types";
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

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

export const storage = {
  // Diagrams
  createDiagram(name: string, project: string, spec: DiagramSpec): Diagram {
    const id = nanoid(12);
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO diagrams (id, name, project, spec, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, project, JSON.stringify(spec), now, now]
    );

    // Create initial version
    this.createVersion(id, spec, "Initial version");

    return {
      id,
      name,
      project,
      spec,
      createdAt: now,
      updatedAt: now,
    };
  },

  getDiagram(id: string): Diagram | null {
    const row = db.query<{ id: string; name: string; project: string; spec: string; thumbnail_url: string | null; created_at: string; updated_at: string }, [string]>(
      `SELECT * FROM diagrams WHERE id = ?`
    ).get(id);

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      project: row.project,
      spec: JSON.parse(row.spec),
      thumbnailUrl: row.thumbnail_url || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  updateDiagram(id: string, spec: DiagramSpec, message?: string): Diagram | null {
    const now = new Date().toISOString();

    const result = db.run(
      `UPDATE diagrams SET spec = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(spec), now, id]
    );

    // Only create version if the diagram actually exists (update affected rows)
    if (result.changes === 0) {
      return null;
    }

    // Create new version
    this.createVersion(id, spec, message);

    return this.getDiagram(id);
  },

  async deleteDiagram(id: string): Promise<boolean> {
    // Delete associated thumbnail file
    await deleteThumbnail(id);

    db.run(`DELETE FROM diagram_versions WHERE diagram_id = ?`, [id]);
    db.run(`DELETE FROM agent_runs WHERE diagram_id = ?`, [id]);
    const result = db.run(`DELETE FROM diagrams WHERE id = ?`, [id]);
    return result.changes > 0;
  },

  listDiagrams(project?: string): Diagram[] {
    // Define row type for query results
    type DiagramRow = {
      id: string;
      name: string;
      project: string;
      spec: string;
      thumbnail_url: string | null;
      created_at: string;
      updated_at: string;
    };

    const rows: DiagramRow[] = project
      ? db.query<DiagramRow, [string]>(
          `SELECT * FROM diagrams WHERE project = ? ORDER BY updated_at DESC`
        ).all(project)
      : db.query<DiagramRow, []>(
          `SELECT * FROM diagrams ORDER BY updated_at DESC`
        ).all();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      project: row.project,
      spec: JSON.parse(row.spec),
      thumbnailUrl: row.thumbnail_url || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },

  // Versions
  createVersion(diagramId: string, spec: DiagramSpec, message?: string): DiagramVersion {
    const id = nanoid(12);
    const now = new Date().toISOString();

    // Get next version number
    const lastVersion = db.query<{ version: number }, [string]>(
      `SELECT MAX(version) as version FROM diagram_versions WHERE diagram_id = ?`
    ).get(diagramId);

    const version = (lastVersion?.version || 0) + 1;

    db.run(
      `INSERT INTO diagram_versions (id, diagram_id, version, spec, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, diagramId, version, JSON.stringify(spec), message || null, now]
    );

    return {
      id,
      diagramId,
      version,
      spec,
      message,
      createdAt: now,
    };
  },

  getVersions(diagramId: string): DiagramVersion[] {
    const rows = db.query<{ id: string; diagram_id: string; version: number; spec: string; message: string | null; created_at: string }, [string]>(
      `SELECT * FROM diagram_versions WHERE diagram_id = ? ORDER BY version DESC`
    ).all(diagramId);

    return rows.map(row => ({
      id: row.id,
      diagramId: row.diagram_id,
      version: row.version,
      spec: JSON.parse(row.spec),
      message: row.message || undefined,
      createdAt: row.created_at,
    }));
  },

  getVersion(diagramId: string, version: number): DiagramVersion | null {
    const row = db.query<{ id: string; diagram_id: string; version: number; spec: string; message: string | null; created_at: string }, [string, number]>(
      `SELECT * FROM diagram_versions WHERE diagram_id = ? AND version = ?`
    ).get(diagramId, version);

    if (!row) return null;

    return {
      id: row.id,
      diagramId: row.diagram_id,
      version: row.version,
      spec: JSON.parse(row.spec),
      message: row.message || undefined,
      createdAt: row.created_at,
    };
  },

  getLatestVersion(diagramId: string): DiagramVersion | null {
    const row = db.query<{ id: string; diagram_id: string; version: number; spec: string; message: string | null; created_at: string }, [string]>(
      `SELECT * FROM diagram_versions WHERE diagram_id = ? ORDER BY version DESC LIMIT 1`
    ).get(diagramId);

    if (!row) return null;

    return {
      id: row.id,
      diagramId: row.diagram_id,
      version: row.version,
      spec: JSON.parse(row.spec),
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
};

export default storage;
