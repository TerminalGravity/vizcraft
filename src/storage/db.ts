/**
 * Database layer using bun:sqlite
 */

import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import type { Diagram, DiagramSpec, DiagramVersion } from "../types";

const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = `${DATA_DIR}/vizcraft.db`;

// Ensure data directory exists
await Bun.write(`${DATA_DIR}/.gitkeep`, "");

const db = new Database(DB_PATH, { create: true });

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

// Create indexes
db.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_project ON diagrams(project)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_versions_diagram ON diagram_versions(diagram_id)`);

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

    db.run(
      `UPDATE diagrams SET spec = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(spec), now, id]
    );

    // Create new version
    this.createVersion(id, spec, message);

    return this.getDiagram(id);
  },

  deleteDiagram(id: string): boolean {
    db.run(`DELETE FROM diagram_versions WHERE diagram_id = ?`, [id]);
    db.run(`DELETE FROM agent_runs WHERE diagram_id = ?`, [id]);
    const result = db.run(`DELETE FROM diagrams WHERE id = ?`, [id]);
    return result.changes > 0;
  },

  listDiagrams(project?: string): Diagram[] {
    const query = project
      ? db.query<{ id: string; name: string; project: string; spec: string; thumbnail_url: string | null; created_at: string; updated_at: string }, [string]>(
          `SELECT * FROM diagrams WHERE project = ? ORDER BY updated_at DESC`
        )
      : db.query<{ id: string; name: string; project: string; spec: string; thumbnail_url: string | null; created_at: string; updated_at: string }, []>(
          `SELECT * FROM diagrams ORDER BY updated_at DESC`
        );

    const rows = project ? query.all(project) : (query as any).all();

    return rows.map((row: any) => ({
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

  // Thumbnails
  updateThumbnail(id: string, thumbnailDataUrl: string): boolean {
    const result = db.run(
      `UPDATE diagrams SET thumbnail_url = ?, updated_at = ? WHERE id = ?`,
      [thumbnailDataUrl, new Date().toISOString(), id]
    );
    return result.changes > 0;
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
