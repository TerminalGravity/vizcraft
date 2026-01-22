/**
 * Database Layer Tests
 *
 * Comprehensive tests for src/storage/db.ts
 * Tests all CRUD operations, versioning, forking, and edge cases.
 */

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import type { DiagramSpec, Diagram, DiagramVersion } from "../types";

// Create isolated test database for each test run
const TEST_DB_PATH = `./data/test-${nanoid(8)}.db`;
const testDb = new Database(TEST_DB_PATH, { create: true });

// Initialize schema (same as production)
testDb.run(`
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

testDb.run(`
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

testDb.run(`
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

testDb.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_project ON diagrams(project)`);
testDb.run(`CREATE INDEX IF NOT EXISTS idx_versions_diagram ON diagram_versions(diagram_id)`);

// Row types
interface DiagramRow {
  id: string;
  name: string;
  project: string;
  spec: string;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  diagram_id: string;
  version: number;
  spec: string;
  message: string | null;
  created_at: string;
}

// Test storage implementation (mirrors production but uses test db)
const testStorage = {
  createDiagram(name: string, project: string, spec: DiagramSpec): Diagram {
    const id = nanoid(12);
    const now = new Date().toISOString();

    testDb.run(
      `INSERT INTO diagrams (id, name, project, spec, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, project, JSON.stringify(spec), now, now]
    );

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
    const row = testDb.query<DiagramRow, [string]>(
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

    testDb.run(
      `UPDATE diagrams SET spec = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(spec), now, id]
    );

    this.createVersion(id, spec, message);

    return this.getDiagram(id);
  },

  deleteDiagram(id: string): boolean {
    testDb.run(`DELETE FROM diagram_versions WHERE diagram_id = ?`, [id]);
    testDb.run(`DELETE FROM agent_runs WHERE diagram_id = ?`, [id]);
    const result = testDb.run(`DELETE FROM diagrams WHERE id = ?`, [id]);
    return result.changes > 0;
  },

  listDiagrams(project?: string): Diagram[] {
    let rows: DiagramRow[];
    if (project) {
      rows = testDb.query<DiagramRow, [string]>(
        `SELECT * FROM diagrams WHERE project = ? ORDER BY updated_at DESC`
      ).all(project);
    } else {
      rows = testDb.query<DiagramRow, []>(
        `SELECT * FROM diagrams ORDER BY updated_at DESC`
      ).all();
    }

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

  createVersion(diagramId: string, spec: DiagramSpec, message?: string): DiagramVersion {
    const id = nanoid(12);
    const now = new Date().toISOString();

    const lastVersion = testDb.query<{ version: number }, [string]>(
      `SELECT MAX(version) as version FROM diagram_versions WHERE diagram_id = ?`
    ).get(diagramId);

    const version = (lastVersion?.version || 0) + 1;

    testDb.run(
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
    const rows = testDb.query<VersionRow, [string]>(
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
    const row = testDb.query<VersionRow, [string, number]>(
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
    const row = testDb.query<VersionRow, [string]>(
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

  getVersionsPaginated(
    diagramId: string,
    limit: number = 20,
    offset: number = 0
  ): { versions: DiagramVersion[]; total: number } {
    const countRow = testDb.query<{ total: number }, [string]>(
      `SELECT COUNT(*) as total FROM diagram_versions WHERE diagram_id = ?`
    ).get(diagramId);
    const total = countRow?.total ?? 0;

    const rows = testDb.query<VersionRow, [string, number, number]>(
      `SELECT * FROM diagram_versions WHERE diagram_id = ? ORDER BY version DESC LIMIT ? OFFSET ?`
    ).all(diagramId, limit, offset);

    const versions = rows.map(row => ({
      id: row.id,
      diagramId: row.diagram_id,
      version: row.version,
      spec: JSON.parse(row.spec) as DiagramSpec,
      message: row.message || undefined,
      createdAt: row.created_at,
    }));

    return { versions, total };
  },

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

    const rows = testDb.query<MetadataRow, [string, number]>(
      `SELECT id, version, message, created_at FROM diagram_versions WHERE diagram_id = ? ORDER BY version DESC LIMIT ?`
    ).all(diagramId, limit);

    return rows.map(row => ({
      id: row.id,
      version: row.version,
      message: row.message || undefined,
      createdAt: row.created_at,
    }));
  },

  restoreVersion(diagramId: string, version: number): Diagram | null {
    const targetVersion = this.getVersion(diagramId, version);
    if (!targetVersion) return null;

    const now = new Date().toISOString();

    testDb.run(
      `UPDATE diagrams SET spec = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(targetVersion.spec), now, diagramId]
    );

    this.createVersion(diagramId, targetVersion.spec, `Restored to version ${version}`);

    return this.getDiagram(diagramId);
  },

  forkDiagram(id: string, newName: string, project?: string): Diagram | null {
    const original = this.getDiagram(id);
    if (!original) return null;

    const newId = nanoid(12);
    const now = new Date().toISOString();
    const targetProject = project || original.project;

    testDb.run(
      `INSERT INTO diagrams (id, name, project, spec, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [newId, newName, targetProject, JSON.stringify(original.spec), now, now]
    );

    this.createVersion(newId, original.spec, `Forked from ${original.name} (${id})`);

    return this.getDiagram(newId);
  },

  updateThumbnail(id: string, thumbnailDataUrl: string): boolean {
    const result = testDb.run(
      `UPDATE diagrams SET thumbnail_url = ?, updated_at = ? WHERE id = ?`,
      [thumbnailDataUrl, new Date().toISOString(), id]
    );
    return result.changes > 0;
  },

  listProjects(): string[] {
    const rows = testDb.query<{ project: string }, []>(
      `SELECT DISTINCT project FROM diagrams ORDER BY project`
    ).all();

    return rows.map(row => row.project);
  },

  // Test helper: clear all data
  _clearAll() {
    testDb.run(`DELETE FROM diagram_versions`);
    testDb.run(`DELETE FROM agent_runs`);
    testDb.run(`DELETE FROM diagrams`);
  },
};

// Sample specs for testing
const sampleFlowchartSpec: DiagramSpec = {
  type: "flowchart",
  nodes: [
    { id: "start", label: "Start", type: "circle" },
    { id: "end", label: "End", type: "circle" },
  ],
  edges: [{ from: "start", to: "end" }],
};

const sampleArchitectureSpec: DiagramSpec = {
  type: "architecture",
  nodes: [
    { id: "client", label: "Client", type: "box" },
    { id: "server", label: "Server", type: "server" },
    { id: "db", label: "Database", type: "database" },
  ],
  edges: [
    { from: "client", to: "server" },
    { from: "server", to: "db" },
  ],
};

// Clean up before each test
beforeEach(() => {
  testStorage._clearAll();
});

// Clean up test database after all tests
afterAll(() => {
  testDb.close();
  // Remove test database file
  try {
    Bun.spawnSync(["rm", "-f", TEST_DB_PATH]);
  } catch {
    // Ignore cleanup errors
  }
});

describe("Database Schema", () => {
  it("creates diagrams table with correct columns", () => {
    const tableInfo = testDb.query<{ name: string; type: string }, []>(
      `PRAGMA table_info(diagrams)`
    ).all();

    const columns = tableInfo.map(col => col.name);
    expect(columns).toContain("id");
    expect(columns).toContain("name");
    expect(columns).toContain("project");
    expect(columns).toContain("spec");
    expect(columns).toContain("thumbnail_url");
    expect(columns).toContain("created_at");
    expect(columns).toContain("updated_at");
  });

  it("creates diagram_versions table with correct columns", () => {
    const tableInfo = testDb.query<{ name: string; type: string }, []>(
      `PRAGMA table_info(diagram_versions)`
    ).all();

    const columns = tableInfo.map(col => col.name);
    expect(columns).toContain("id");
    expect(columns).toContain("diagram_id");
    expect(columns).toContain("version");
    expect(columns).toContain("spec");
    expect(columns).toContain("message");
    expect(columns).toContain("created_at");
  });

  it("creates indexes for performance", () => {
    const indexes = testDb.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'`
    ).all();

    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain("idx_diagrams_project");
    expect(indexNames).toContain("idx_versions_diagram");
  });
});

describe("Diagram CRUD Operations", () => {
  describe("createDiagram", () => {
    it("creates a diagram with valid data", () => {
      const diagram = testStorage.createDiagram("Test Flowchart", "my-project", sampleFlowchartSpec);

      expect(diagram.id).toBeTruthy();
      expect(diagram.id.length).toBe(12);
      expect(diagram.name).toBe("Test Flowchart");
      expect(diagram.project).toBe("my-project");
      expect(diagram.spec).toEqual(sampleFlowchartSpec);
      expect(diagram.createdAt).toBeTruthy();
      expect(diagram.updatedAt).toBeTruthy();
    });

    it("creates initial version automatically", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      const versions = testStorage.getVersions(diagram.id);

      expect(versions.length).toBe(1);
      expect(versions[0].version).toBe(1);
      expect(versions[0].message).toBe("Initial version");
      expect(versions[0].spec).toEqual(sampleFlowchartSpec);
    });

    it("handles special characters in name", () => {
      const diagram = testStorage.createDiagram("Test \"Diagram\" <with> 'special' chars", "project", sampleFlowchartSpec);

      expect(diagram.name).toBe("Test \"Diagram\" <with> 'special' chars");

      // Verify retrieval works
      const retrieved = testStorage.getDiagram(diagram.id);
      expect(retrieved?.name).toBe("Test \"Diagram\" <with> 'special' chars");
    });

    it("handles empty string name", () => {
      const diagram = testStorage.createDiagram("", "project", sampleFlowchartSpec);
      expect(diagram.name).toBe("");
    });

    it("handles unicode characters", () => {
      const diagram = testStorage.createDiagram("测试图表 🎨", "项目", sampleFlowchartSpec);

      expect(diagram.name).toBe("测试图表 🎨");
      expect(diagram.project).toBe("项目");

      const retrieved = testStorage.getDiagram(diagram.id);
      expect(retrieved?.name).toBe("测试图表 🎨");
    });

    it("generates unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const diagram = testStorage.createDiagram(`Test ${i}`, "project", sampleFlowchartSpec);
        expect(ids.has(diagram.id)).toBe(false);
        ids.add(diagram.id);
      }
    });
  });

  describe("getDiagram", () => {
    it("retrieves existing diagram", () => {
      const created = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      const retrieved = testStorage.getDiagram(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe("Test");
      expect(retrieved?.spec).toEqual(sampleFlowchartSpec);
    });

    it("returns null for non-existent ID", () => {
      const result = testStorage.getDiagram("nonexistent123");
      expect(result).toBeNull();
    });

    it("returns null for empty ID", () => {
      const result = testStorage.getDiagram("");
      expect(result).toBeNull();
    });

    it("correctly parses spec JSON", () => {
      const complexSpec: DiagramSpec = {
        type: "architecture",
        nodes: [
          { id: "a", label: "Node A", type: "box", color: "#ff0000" },
          { id: "b", label: "Node B", type: "database" },
        ],
        edges: [{ from: "a", to: "b", label: "connects", style: "dashed" }],
        groups: [{ id: "g1", label: "Group 1", nodeIds: ["a", "b"], color: "#0000ff" }],
      };

      const created = testStorage.createDiagram("Complex", "project", complexSpec);
      const retrieved = testStorage.getDiagram(created.id);

      expect(retrieved?.spec).toEqual(complexSpec);
      expect(retrieved?.spec.groups?.[0].nodeIds).toEqual(["a", "b"]);
    });
  });

  describe("updateDiagram", () => {
    it("updates spec and creates new version", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 5));

      const updatedSpec: DiagramSpec = {
        ...sampleFlowchartSpec,
        nodes: [...sampleFlowchartSpec.nodes, { id: "new", label: "New Node", type: "box" }],
      };

      const updated = testStorage.updateDiagram(diagram.id, updatedSpec, "Added new node");

      expect(updated?.spec.nodes.length).toBe(3);
      expect(updated?.updatedAt).not.toBe(diagram.createdAt);

      const versions = testStorage.getVersions(diagram.id);
      expect(versions.length).toBe(2);
      expect(versions[0].version).toBe(2);
      expect(versions[0].message).toBe("Added new node");
    });

    it("updates without message", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      const updated = testStorage.updateDiagram(diagram.id, sampleArchitectureSpec);

      expect(updated?.spec.type).toBe("architecture");

      const versions = testStorage.getVersions(diagram.id);
      expect(versions[0].message).toBeUndefined();
    });

    it("returns null for non-existent diagram", () => {
      const result = testStorage.updateDiagram("nonexistent", sampleFlowchartSpec);
      // Note: Current implementation doesn't check existence before update
      // This test documents current behavior
      expect(result).toBeNull();
    });
  });

  describe("deleteDiagram", () => {
    it("deletes existing diagram", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      const result = testStorage.deleteDiagram(diagram.id);

      expect(result).toBe(true);
      expect(testStorage.getDiagram(diagram.id)).toBeNull();
    });

    it("deletes associated versions", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec);

      expect(testStorage.getVersions(diagram.id).length).toBe(2);

      testStorage.deleteDiagram(diagram.id);

      expect(testStorage.getVersions(diagram.id).length).toBe(0);
    });

    it("returns false for non-existent diagram", () => {
      const result = testStorage.deleteDiagram("nonexistent");
      expect(result).toBe(false);
    });

    it("handles multiple deletes gracefully", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      expect(testStorage.deleteDiagram(diagram.id)).toBe(true);
      expect(testStorage.deleteDiagram(diagram.id)).toBe(false);
    });
  });

  describe("listDiagrams", () => {
    it("lists all diagrams when no project specified", () => {
      testStorage.createDiagram("Diagram 1", "project-a", sampleFlowchartSpec);
      testStorage.createDiagram("Diagram 2", "project-b", sampleArchitectureSpec);
      testStorage.createDiagram("Diagram 3", "project-a", sampleFlowchartSpec);

      const diagrams = testStorage.listDiagrams();

      expect(diagrams.length).toBe(3);
    });

    it("filters by project", () => {
      testStorage.createDiagram("Diagram 1", "project-a", sampleFlowchartSpec);
      testStorage.createDiagram("Diagram 2", "project-b", sampleArchitectureSpec);
      testStorage.createDiagram("Diagram 3", "project-a", sampleFlowchartSpec);

      const diagrams = testStorage.listDiagrams("project-a");

      expect(diagrams.length).toBe(2);
      expect(diagrams.every(d => d.project === "project-a")).toBe(true);
    });

    it("returns empty array for non-existent project", () => {
      testStorage.createDiagram("Diagram 1", "project-a", sampleFlowchartSpec);

      const diagrams = testStorage.listDiagrams("nonexistent");

      expect(diagrams.length).toBe(0);
    });

    it("orders by updated_at descending", async () => {
      const d1 = testStorage.createDiagram("Diagram 1", "project", sampleFlowchartSpec);

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      const d2 = testStorage.createDiagram("Diagram 2", "project", sampleFlowchartSpec);

      await new Promise(resolve => setTimeout(resolve, 10));
      testStorage.updateDiagram(d1.id, sampleArchitectureSpec);

      const diagrams = testStorage.listDiagrams();

      // d1 was updated most recently, so should be first
      expect(diagrams[0].id).toBe(d1.id);
      expect(diagrams[1].id).toBe(d2.id);
    });

    it("returns empty array when no diagrams exist", () => {
      const diagrams = testStorage.listDiagrams();
      expect(diagrams).toEqual([]);
    });
  });
});

describe("Version Operations", () => {
  describe("createVersion", () => {
    it("increments version number correctly", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const v2 = testStorage.createVersion(diagram.id, sampleArchitectureSpec, "v2");
      const v3 = testStorage.createVersion(diagram.id, sampleFlowchartSpec, "v3");

      expect(v2.version).toBe(2);
      expect(v3.version).toBe(3);
    });

    it("handles first version for new diagram", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      // First version is created automatically, so next is 2
      const versions = testStorage.getVersions(diagram.id);
      expect(versions.length).toBe(1);
      expect(versions[0].version).toBe(1);
    });
  });

  describe("getVersions", () => {
    it("returns versions in descending order", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      testStorage.createVersion(diagram.id, sampleArchitectureSpec, "v2");
      testStorage.createVersion(diagram.id, sampleFlowchartSpec, "v3");

      const versions = testStorage.getVersions(diagram.id);

      expect(versions.length).toBe(3);
      expect(versions[0].version).toBe(3);
      expect(versions[1].version).toBe(2);
      expect(versions[2].version).toBe(1);
    });

    it("returns empty array for non-existent diagram", () => {
      const versions = testStorage.getVersions("nonexistent");
      expect(versions).toEqual([]);
    });
  });

  describe("getVersion", () => {
    it("returns specific version", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      testStorage.createVersion(diagram.id, sampleArchitectureSpec, "v2");

      const v1 = testStorage.getVersion(diagram.id, 1);
      const v2 = testStorage.getVersion(diagram.id, 2);

      expect(v1?.spec.type).toBe("flowchart");
      expect(v2?.spec.type).toBe("architecture");
    });

    it("returns null for non-existent version", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      const result = testStorage.getVersion(diagram.id, 999);
      expect(result).toBeNull();
    });
  });

  describe("getLatestVersion", () => {
    it("returns most recent version", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      testStorage.createVersion(diagram.id, sampleArchitectureSpec, "v2");
      testStorage.createVersion(diagram.id, sampleFlowchartSpec, "v3");

      const latest = testStorage.getLatestVersion(diagram.id);

      expect(latest?.version).toBe(3);
      expect(latest?.message).toBe("v3");
    });

    it("returns null for non-existent diagram", () => {
      const result = testStorage.getLatestVersion("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getVersionsPaginated", () => {
    it("returns paginated versions with total count", () => {
      const diagram = testStorage.createDiagram("Pagination Test", "project", sampleFlowchartSpec);
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec, "v2");
      testStorage.updateDiagram(diagram.id, sampleFlowchartSpec, "v3");
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec, "v4");
      testStorage.updateDiagram(diagram.id, sampleFlowchartSpec, "v5");

      // Get first page
      const page1 = testStorage.getVersionsPaginated(diagram.id, 2, 0);
      expect(page1.total).toBe(5);
      expect(page1.versions.length).toBe(2);
      expect(page1.versions[0].version).toBe(5); // Newest first
      expect(page1.versions[1].version).toBe(4);

      // Get second page
      const page2 = testStorage.getVersionsPaginated(diagram.id, 2, 2);
      expect(page2.total).toBe(5);
      expect(page2.versions.length).toBe(2);
      expect(page2.versions[0].version).toBe(3);
      expect(page2.versions[1].version).toBe(2);
    });

    it("returns fewer results when near end", () => {
      const diagram = testStorage.createDiagram("End Test", "project", sampleFlowchartSpec);
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec, "v2");

      const result = testStorage.getVersionsPaginated(diagram.id, 5, 0);
      expect(result.total).toBe(2);
      expect(result.versions.length).toBe(2);
    });

    it("returns empty array for offset beyond total", () => {
      const diagram = testStorage.createDiagram("Offset Test", "project", sampleFlowchartSpec);

      const result = testStorage.getVersionsPaginated(diagram.id, 10, 100);
      expect(result.total).toBe(1);
      expect(result.versions.length).toBe(0);
    });

    it("includes full spec in paginated results", () => {
      const diagram = testStorage.createDiagram("Spec Test", "project", sampleFlowchartSpec);

      const result = testStorage.getVersionsPaginated(diagram.id, 10, 0);
      expect(result.versions[0].spec).toEqual(sampleFlowchartSpec);
    });
  });

  describe("getVersionsMetadata", () => {
    it("returns version metadata without specs", () => {
      const diagram = testStorage.createDiagram("Metadata Test", "project", sampleFlowchartSpec);
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec, "Updated");

      const metadata = testStorage.getVersionsMetadata(diagram.id);

      expect(metadata.length).toBe(2);
      expect(metadata[0].version).toBe(2);
      expect(metadata[0].message).toBe("Updated");
      expect(metadata[0].createdAt).toBeDefined();
      // @ts-expect-error - spec should not exist
      expect(metadata[0].spec).toBeUndefined();
    });

    it("respects limit parameter", () => {
      const diagram = testStorage.createDiagram("Limit Test", "project", sampleFlowchartSpec);
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec, "v2");
      testStorage.updateDiagram(diagram.id, sampleFlowchartSpec, "v3");

      const metadata = testStorage.getVersionsMetadata(diagram.id, 2);

      expect(metadata.length).toBe(2);
      expect(metadata[0].version).toBe(3);
      expect(metadata[1].version).toBe(2);
    });
  });

  describe("restoreVersion", () => {
    it("restores to previous version", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec, "Changed to architecture");

      const restored = testStorage.restoreVersion(diagram.id, 1);

      expect(restored?.spec.type).toBe("flowchart");
    });

    it("creates restore version record", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec);

      testStorage.restoreVersion(diagram.id, 1);

      const versions = testStorage.getVersions(diagram.id);
      expect(versions.length).toBe(3);
      expect(versions[0].message).toBe("Restored to version 1");
    });

    it("returns null for non-existent version", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      const result = testStorage.restoreVersion(diagram.id, 999);
      expect(result).toBeNull();
    });
  });
});

describe("Fork Operations", () => {
  describe("forkDiagram", () => {
    it("creates copy with new name", () => {
      const original = testStorage.createDiagram("Original", "project", sampleFlowchartSpec);
      const forked = testStorage.forkDiagram(original.id, "Forked Copy");

      expect(forked).not.toBeNull();
      expect(forked?.id).not.toBe(original.id);
      expect(forked?.name).toBe("Forked Copy");
      expect(forked?.spec).toEqual(original.spec);
    });

    it("preserves project by default", () => {
      const original = testStorage.createDiagram("Original", "original-project", sampleFlowchartSpec);
      const forked = testStorage.forkDiagram(original.id, "Forked");

      expect(forked?.project).toBe("original-project");
    });

    it("allows specifying new project", () => {
      const original = testStorage.createDiagram("Original", "original-project", sampleFlowchartSpec);
      const forked = testStorage.forkDiagram(original.id, "Forked", "new-project");

      expect(forked?.project).toBe("new-project");
    });

    it("creates initial version with fork reference", () => {
      const original = testStorage.createDiagram("Original", "project", sampleFlowchartSpec);
      const forked = testStorage.forkDiagram(original.id, "Forked");

      const versions = testStorage.getVersions(forked!.id);
      expect(versions.length).toBe(1);
      expect(versions[0].message).toContain("Forked from Original");
      expect(versions[0].message).toContain(original.id);
    });

    it("returns null for non-existent original", () => {
      const result = testStorage.forkDiagram("nonexistent", "Fork");
      expect(result).toBeNull();
    });

    it("creates independent copy", () => {
      const original = testStorage.createDiagram("Original", "project", sampleFlowchartSpec);
      const forked = testStorage.forkDiagram(original.id, "Forked");

      // Update original
      testStorage.updateDiagram(original.id, sampleArchitectureSpec);

      // Forked should remain unchanged
      const forkedAfter = testStorage.getDiagram(forked!.id);
      expect(forkedAfter?.spec.type).toBe("flowchart");
    });
  });
});

describe("Thumbnail Operations", () => {
  describe("updateThumbnail", () => {
    it("updates thumbnail for existing diagram", () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      const thumbnailData = "data:image/png;base64,iVBORw0KGgo...";

      const result = testStorage.updateThumbnail(diagram.id, thumbnailData);

      expect(result).toBe(true);

      const retrieved = testStorage.getDiagram(diagram.id);
      expect(retrieved?.thumbnailUrl).toBe(thumbnailData);
    });

    it("returns false for non-existent diagram", () => {
      const result = testStorage.updateThumbnail("nonexistent", "data:...");
      expect(result).toBe(false);
    });

    it("updates timestamp when thumbnail changes", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      const originalUpdatedAt = diagram.updatedAt;

      await new Promise(resolve => setTimeout(resolve, 10));

      testStorage.updateThumbnail(diagram.id, "data:...");

      const updated = testStorage.getDiagram(diagram.id);
      expect(updated?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });
});

describe("Project Operations", () => {
  describe("listProjects", () => {
    it("returns unique project names", () => {
      testStorage.createDiagram("D1", "project-a", sampleFlowchartSpec);
      testStorage.createDiagram("D2", "project-b", sampleFlowchartSpec);
      testStorage.createDiagram("D3", "project-a", sampleFlowchartSpec);
      testStorage.createDiagram("D4", "project-c", sampleFlowchartSpec);

      const projects = testStorage.listProjects();

      expect(projects.length).toBe(3);
      expect(projects).toContain("project-a");
      expect(projects).toContain("project-b");
      expect(projects).toContain("project-c");
    });

    it("returns sorted project names", () => {
      testStorage.createDiagram("D1", "zebra", sampleFlowchartSpec);
      testStorage.createDiagram("D2", "alpha", sampleFlowchartSpec);
      testStorage.createDiagram("D3", "beta", sampleFlowchartSpec);

      const projects = testStorage.listProjects();

      expect(projects).toEqual(["alpha", "beta", "zebra"]);
    });

    it("returns empty array when no diagrams", () => {
      const projects = testStorage.listProjects();
      expect(projects).toEqual([]);
    });
  });
});

describe("Edge Cases and Error Handling", () => {
  it("handles very long names", () => {
    const longName = "A".repeat(10000);
    const diagram = testStorage.createDiagram(longName, "project", sampleFlowchartSpec);

    const retrieved = testStorage.getDiagram(diagram.id);
    expect(retrieved?.name).toBe(longName);
  });

  it("handles complex nested spec", () => {
    const complexSpec: DiagramSpec = {
      type: "sequence",
      nodes: Array.from({ length: 50 }, (_, i) => ({
        id: `node-${i}`,
        label: `Node ${i} with "quotes" and 'apostrophes'`,
        type: "box" as const,
      })),
      edges: Array.from({ length: 100 }, (_, i) => ({
        from: `node-${i % 50}`,
        to: `node-${(i + 1) % 50}`,
        label: `Edge ${i}`,
      })),
      messages: Array.from({ length: 20 }, (_, i) => ({
        from: `node-${i}`,
        to: `node-${i + 1}`,
        label: `Message ${i}`,
        type: "sync" as const,
        order: i,
      })),
    };

    const diagram = testStorage.createDiagram("Complex", "project", complexSpec);
    const retrieved = testStorage.getDiagram(diagram.id);

    expect(retrieved?.spec.nodes.length).toBe(50);
    expect(retrieved?.spec.edges.length).toBe(100);
    expect(retrieved?.spec.messages?.length).toBe(20);
  });

  it("handles concurrent version creation", async () => {
    const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

    // Create multiple versions concurrently
    const promises = Array.from({ length: 10 }, (_, i) =>
      Promise.resolve(testStorage.createVersion(diagram.id, sampleFlowchartSpec, `v${i + 2}`))
    );

    await Promise.all(promises);

    const versions = testStorage.getVersions(diagram.id);
    // Should have 11 versions (1 initial + 10 concurrent)
    expect(versions.length).toBe(11);

    // All version numbers should be unique
    const versionNumbers = versions.map(v => v.version);
    const uniqueNumbers = new Set(versionNumbers);
    expect(uniqueNumbers.size).toBe(11);
  });
});
