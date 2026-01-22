/**
 * Web Server API Tests
 *
 * Comprehensive tests for all API endpoints in web-server.ts
 */

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import type { DiagramSpec, Diagram } from "./types";
import {
  errorResponse,
  notFoundResponse,
  validationErrorResponse,
  operationResponse,
} from "./api/responses";
import { MAX_LIST_OFFSET } from "./api/timeout";

// ==================== Test Database Setup ====================

const TEST_DB_PATH = `./data/api-test-${nanoid(8)}.db`;
const testDb = new Database(TEST_DB_PATH, { create: true });

// Initialize schema
testDb.run(`
  CREATE TABLE IF NOT EXISTS diagrams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project TEXT NOT NULL,
    spec TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
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

testDb.run(`CREATE INDEX IF NOT EXISTS idx_diagrams_project ON diagrams(project)`);
testDb.run(`CREATE INDEX IF NOT EXISTS idx_versions_diagram ON diagram_versions(diagram_id)`);

// Row types
interface DiagramRow {
  id: string;
  name: string;
  project: string;
  spec: string;
  version: number;
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

// Test storage (isolated from production)
const testStorage = {
  createDiagram(name: string, project: string, spec: DiagramSpec): Diagram & { version: number } {
    const id = nanoid(12);
    const now = new Date().toISOString();

    testDb.run(
      `INSERT INTO diagrams (id, name, project, spec, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [id, name, project, JSON.stringify(spec), now, now]
    );

    this.createVersion(id, spec, "Initial version");

    return { id, name, project, spec, version: 1, createdAt: now, updatedAt: now };
  },

  getDiagram(id: string): (Diagram & { version: number }) | null {
    const row = testDb.query<DiagramRow, [string]>(`SELECT * FROM diagrams WHERE id = ?`).get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      project: row.project,
      spec: JSON.parse(row.spec),
      version: row.version,
      thumbnailUrl: row.thumbnail_url || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  updateDiagram(
    id: string,
    spec: DiagramSpec,
    message?: string,
    baseVersion?: number
  ): (Diagram & { version: number }) | null | { conflict: true; currentVersion: number } {
    const now = new Date().toISOString();

    if (baseVersion !== undefined) {
      // Optimistic locking
      const result = testDb.run(
        `UPDATE diagrams SET spec = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
        [JSON.stringify(spec), now, id, baseVersion]
      );

      if (result.changes === 0) {
        const existing = this.getDiagram(id);
        if (!existing) return null;
        return { conflict: true, currentVersion: existing.version };
      }
    } else {
      // Blind update (no version check)
      testDb.run(
        `UPDATE diagrams SET spec = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [JSON.stringify(spec), now, id]
      );
    }

    this.createVersion(id, spec, message);
    return this.getDiagram(id);
  },

  deleteDiagram(id: string): boolean {
    testDb.run(`DELETE FROM diagram_versions WHERE diagram_id = ?`, [id]);
    const result = testDb.run(`DELETE FROM diagrams WHERE id = ?`, [id]);
    return result.changes > 0;
  },

  listDiagrams(project?: string): Diagram[] {
    let rows: DiagramRow[];
    if (project) {
      rows = testDb.query<DiagramRow, [string]>(`SELECT * FROM diagrams WHERE project = ? ORDER BY updated_at DESC`).all(project);
    } else {
      rows = testDb.query<DiagramRow, []>(`SELECT * FROM diagrams ORDER BY updated_at DESC`).all();
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

  createVersion(diagramId: string, spec: DiagramSpec, message?: string) {
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
    return { id, diagramId, version, spec, message, createdAt: now };
  },

  getVersions(diagramId: string) {
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

  getVersion(diagramId: string, version: number) {
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

  getLatestVersion(diagramId: string) {
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

  restoreVersion(diagramId: string, version: number): Diagram | null {
    const targetVersion = this.getVersion(diagramId, version);
    if (!targetVersion) return null;
    const now = new Date().toISOString();
    testDb.run(`UPDATE diagrams SET spec = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(targetVersion.spec), now, diagramId]);
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
    const rows = testDb.query<{ project: string }, []>(`SELECT DISTINCT project FROM diagrams ORDER BY project`).all();
    return rows.map(row => row.project);
  },

  _clearAll() {
    testDb.run(`DELETE FROM diagram_versions`);
    testDb.run(`DELETE FROM diagrams`);
  },
};

// ==================== Test API Application ====================

// Custom error class
class APIError extends Error {
  constructor(public code: string, message: string, public status: number = 400) {
    super(message);
    this.name = "APIError";
  }
}

// Create test Hono app (mirrors production endpoints)
function createTestApp() {
  const app = new Hono();

  app.use("*", cors());

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof APIError) {
      return errorResponse(c, err.code, err.message, err.status as 400 | 404 | 500);
    }
    if (err instanceof SyntaxError) {
      return errorResponse(c, "INVALID_JSON", "Invalid JSON in request body", 400);
    }
    return errorResponse(c, "INTERNAL_ERROR", "Internal server error", 500);
  });

  // 404 handler
  app.notFound((c) => {
    if (c.req.path.startsWith("/api")) {
      return errorResponse(
        c,
        "NOT_FOUND",
        `API endpoint not found: ${c.req.method} ${c.req.path}`,
        404
      );
    }
    return c.text("Not Found", 404);
  });

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // List diagrams
  app.get("/api/diagrams", (c) => {
    try {
      const project = c.req.query("project");
      const limitParam = c.req.query("limit");
      const offsetParam = c.req.query("offset");
      const includeFullSpec = c.req.query("full") === "true";

      const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 50;
      const rawOffset = offsetParam ? parseInt(offsetParam, 10) : 0;

      // Validate offset bounds to prevent memory issues with large offsets
      if (rawOffset > MAX_LIST_OFFSET) {
        return validationErrorResponse(
          c,
          `Offset cannot exceed ${MAX_LIST_OFFSET}. Use search filters to narrow results.`,
          { field: "offset", max: MAX_LIST_OFFSET, received: rawOffset }
        );
      }
      const offset = rawOffset;

      const allDiagrams = testStorage.listDiagrams(project);
      const projects = testStorage.listProjects();
      const total = allDiagrams.length;
      const paginated = allDiagrams.slice(offset, offset + limit);

      return c.json({
        count: paginated.length,
        total,
        offset,
        limit,
        diagrams: paginated.map((d) => ({
          id: d.id,
          name: d.name,
          project: d.project,
          ...(includeFullSpec ? { spec: d.spec } : { nodeCount: d.spec.nodes?.length ?? 0, edgeCount: d.spec.edges?.length ?? 0 }),
          thumbnailUrl: d.thumbnailUrl,
          updatedAt: d.updatedAt,
        })),
        projects,
      });
    } catch (err) {
      throw new APIError("LIST_FAILED", "Failed to list diagrams", 500);
    }
  });

  // Get diagram
  app.get("/api/diagrams/:id", (c) => {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }
    const diagram = testStorage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }
    return c.json(diagram);
  });

  // Create diagram
  app.post("/api/diagrams", async (c) => {
    try {
      const body = await c.req.json<{ name: string; project?: string; spec: DiagramSpec }>();

      if (!body.name?.trim()) {
        return validationErrorResponse(c, "Name is required");
      }
      if (!body.spec) {
        return validationErrorResponse(c, "Spec is required");
      }
      if (!body.spec.type || !body.spec.nodes) {
        return validationErrorResponse(c, "Spec must have type and nodes");
      }

      const diagram = testStorage.createDiagram(body.name.trim(), body.project?.trim() || "default", body.spec);
      return c.json(diagram, 201);
    } catch (err) {
      if (err instanceof SyntaxError) {
        return errorResponse(c, "INVALID_JSON", "Invalid JSON in request body", 400);
      }
      return errorResponse(c, "CREATE_FAILED", "Failed to create diagram", 500);
    }
  });

  // Update diagram with optimistic locking
  app.put("/api/diagrams/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{ spec: DiagramSpec; message?: string; force?: boolean }>();

      if (!body.spec) {
        return validationErrorResponse(c, "Spec is required");
      }

      // Check If-Match header for optimistic locking
      const ifMatch = c.req.header("If-Match");
      let baseVersion: number | undefined;

      if (ifMatch) {
        const versionMatch = ifMatch.replace(/"/g, "").match(/^v?(\d+)$/);
        if (!versionMatch) {
          return validationErrorResponse(
            c,
            "Invalid If-Match header format. Expected \"v{version}\" or \"{version}\""
          );
        }
        baseVersion = parseInt(versionMatch[1], 10);
      }

      // Require version checking unless explicitly forced
      if (baseVersion === undefined && !body.force) {
        return c.json({
          error: {
            code: "VERSION_REQUIRED",
            message: "If-Match header with version is required for safe updates. Use force: true in body to override (may lose concurrent changes).",
            hint: "First GET the diagram to obtain its version, then include If-Match: \"v{version}\" header",
          },
        }, 428); // 428 Precondition Required
      }

      const result = testStorage.updateDiagram(id, body.spec, body.message, baseVersion);

      if (result === null) {
        return notFoundResponse(c, "Diagram", id);
      }

      if (typeof result === "object" && "conflict" in result) {
        return c.json({
          error: {
            code: "VERSION_CONFLICT",
            message: `Version conflict: expected version ${baseVersion}, but current version is ${result.currentVersion}`,
            details: { currentVersion: result.currentVersion },
          },
        }, 409);
      }

      // Set ETag header with new version
      c.header("ETag", `"v${result.version}"`);

      return c.json(result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        return errorResponse(c, "INVALID_JSON", "Invalid JSON in request body", 400);
      }
      return errorResponse(c, "UPDATE_FAILED", "Failed to update diagram", 500);
    }
  });

  // Delete diagram
  app.delete("/api/diagrams/:id", (c) => {
    const id = c.req.param("id");
    if (!testStorage.deleteDiagram(id)) {
      return notFoundResponse(c, "Diagram", id);
    }
    return c.json({ success: true });
  });

  // Get versions
  app.get("/api/diagrams/:id/versions", (c) => {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }
    if (!testStorage.getDiagram(id)) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }
    const versions = testStorage.getVersions(id);
    return c.json({ versions, count: versions.length });
  });

  // Get specific version
  app.get("/api/diagrams/:id/versions/:version", (c) => {
    const id = c.req.param("id");
    const versionParam = c.req.param("version");

    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }

    const versionNum = parseInt(versionParam, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      throw new APIError("INVALID_VERSION", "Version must be a positive integer", 400);
    }

    if (!testStorage.getDiagram(id)) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    const version = testStorage.getVersion(id, versionNum);
    if (!version) {
      throw new APIError("VERSION_NOT_FOUND", `Version ${versionNum} not found`, 404);
    }

    return c.json(version);
  });

  // Restore version
  app.post("/api/diagrams/:id/restore/:version", async (c) => {
    const id = c.req.param("id");
    const versionParam = c.req.param("version");

    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }

    const versionNum = parseInt(versionParam, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      throw new APIError("INVALID_VERSION", "Version must be a positive integer", 400);
    }

    if (!testStorage.getDiagram(id)) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    const targetVersion = testStorage.getVersion(id, versionNum);
    if (!targetVersion) {
      throw new APIError("VERSION_NOT_FOUND", `Version ${versionNum} not found`, 404);
    }

    const restored = testStorage.restoreVersion(id, versionNum);
    return c.json({ success: true, diagram: restored, message: `Restored to version ${versionNum}` });
  });

  // Fork diagram
  app.post("/api/diagrams/:id/fork", async (c) => {
    try {
      const id = c.req.param("id");
      if (!id?.trim()) {
        throw new APIError("INVALID_ID", "Diagram ID is required", 400);
      }

      const body = await c.req.json<{ name?: string; project?: string }>();

      const original = testStorage.getDiagram(id);
      if (!original) {
        throw new APIError("NOT_FOUND", "Diagram not found", 404);
      }

      const newName = body.name || `${original.name} (fork)`;
      const project = body.project || original.project;

      const forked = testStorage.forkDiagram(id, newName, project);
      return c.json({ success: true, diagram: forked, originalId: id });
    } catch (err) {
      if (err instanceof APIError) throw err;
      if (err instanceof SyntaxError) {
        throw new APIError("INVALID_JSON", "Invalid JSON in request body", 400);
      }
      throw new APIError("FORK_FAILED", "Failed to fork diagram", 500);
    }
  });

  // Update thumbnail
  app.put("/api/diagrams/:id/thumbnail", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{ thumbnail: string }>();

      if (!body.thumbnail) {
        return validationErrorResponse(c, "Thumbnail data URL required");
      }

      if (!testStorage.getDiagram(id)) {
        return notFoundResponse(c, "Diagram", id);
      }

      const success = testStorage.updateThumbnail(id, body.thumbnail);
      return operationResponse(c, success);
    } catch (err) {
      if (err instanceof SyntaxError) {
        return errorResponse(c, "INVALID_JSON", "Invalid JSON in request body", 400);
      }
      return errorResponse(c, "THUMBNAIL_FAILED", "Failed to update thumbnail", 500);
    }
  });

  // List projects
  app.get("/api/projects", (c) => {
    const projects = testStorage.listProjects();
    return c.json({ projects, count: projects.length });
  });

  return app;
}

// ==================== Sample Data ====================

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
  ],
  edges: [{ from: "client", to: "server" }],
};

// ==================== Tests ====================

const app = createTestApp();

// Helper to make API requests
async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
) {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  return app.request(`http://localhost${path}`, options);
}

beforeEach(() => {
  testStorage._clearAll();
});

afterAll(() => {
  testDb.close();
  try {
    Bun.spawnSync(["rm", "-f", TEST_DB_PATH]);
  } catch {
    // Ignore cleanup errors
  }
});

describe("Health Check", () => {
  it("GET /api/health returns ok status", async () => {
    const res = await apiRequest("GET", "/api/health");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.timestamp).toBeTruthy();
  });
});

describe("404 Handler", () => {
  it("returns 404 for unknown API endpoints", async () => {
    const res = await apiRequest("GET", "/api/unknown/endpoint");
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toBeTruthy();
    expect(data.error.code).toBe("NOT_FOUND");
  });
});

describe("Diagrams API", () => {
  describe("POST /api/diagrams", () => {
    it("creates a diagram with valid data", async () => {
      const res = await apiRequest("POST", "/api/diagrams", {
        name: "Test Diagram",
        project: "test-project",
        spec: sampleFlowchartSpec,
      });

      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.id).toBeTruthy();
      expect(data.name).toBe("Test Diagram");
      expect(data.project).toBe("test-project");
      expect(data.spec.type).toBe("flowchart");
    });

    it("uses default project when not specified", async () => {
      const res = await apiRequest("POST", "/api/diagrams", {
        name: "Test",
        spec: sampleFlowchartSpec,
      });

      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.project).toBe("default");
    });

    it("returns 400 when name is missing", async () => {
      const res = await apiRequest("POST", "/api/diagrams", {
        spec: sampleFlowchartSpec,
      });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBeTruthy();
      expect(data.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when spec is missing", async () => {
      const res = await apiRequest("POST", "/api/diagrams", {
        name: "Test",
      });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when spec is invalid", async () => {
      const res = await apiRequest("POST", "/api/diagrams", {
        name: "Test",
        spec: { invalid: true },
      });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for malformed JSON", async () => {
      const res = await app.request("http://localhost/api/diagrams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ invalid json }",
      });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error.code).toBe("INVALID_JSON");
    });
  });

  describe("GET /api/diagrams", () => {
    it("returns empty list when no diagrams", async () => {
      const res = await apiRequest("GET", "/api/diagrams");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.count).toBe(0);
      expect(data.total).toBe(0);
      expect(data.diagrams).toEqual([]);
    });

    it("lists all diagrams", async () => {
      testStorage.createDiagram("Diagram 1", "project-a", sampleFlowchartSpec);
      testStorage.createDiagram("Diagram 2", "project-b", sampleArchitectureSpec);

      const res = await apiRequest("GET", "/api/diagrams");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.count).toBe(2);
      expect(data.total).toBe(2);
    });

    it("filters by project", async () => {
      testStorage.createDiagram("Diagram 1", "project-a", sampleFlowchartSpec);
      testStorage.createDiagram("Diagram 2", "project-b", sampleArchitectureSpec);
      testStorage.createDiagram("Diagram 3", "project-a", sampleFlowchartSpec);

      const res = await apiRequest("GET", "/api/diagrams?project=project-a");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.count).toBe(2);
      expect(data.diagrams.every((d: { project: string }) => d.project === "project-a")).toBe(true);
    });

    it("supports pagination", async () => {
      for (let i = 0; i < 5; i++) {
        testStorage.createDiagram(`Diagram ${i}`, "project", sampleFlowchartSpec);
      }

      const res = await apiRequest("GET", "/api/diagrams?limit=2&offset=1");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.count).toBe(2);
      expect(data.total).toBe(5);
      expect(data.offset).toBe(1);
      expect(data.limit).toBe(2);
    });

    it("returns minimal data by default (no spec, just counts)", async () => {
      testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("GET", "/api/diagrams");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.diagrams[0].nodeCount).toBe(2);
      expect(data.diagrams[0].edgeCount).toBe(1);
      expect(data.diagrams[0].spec).toBeUndefined();
    });

    it("returns full spec when full=true", async () => {
      testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("GET", "/api/diagrams?full=true");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.diagrams[0].spec).toBeDefined();
      expect(data.diagrams[0].spec.nodes).toHaveLength(2);
      expect(data.diagrams[0].nodeCount).toBeUndefined();
    });

    it("returns project list", async () => {
      testStorage.createDiagram("D1", "alpha", sampleFlowchartSpec);
      testStorage.createDiagram("D2", "beta", sampleFlowchartSpec);

      const res = await apiRequest("GET", "/api/diagrams");
      const data = await res.json();

      expect(data.projects).toContain("alpha");
      expect(data.projects).toContain("beta");
    });

    it("rejects offset exceeding maximum", async () => {
      // MAX_LIST_OFFSET is 10,000
      const res = await apiRequest("GET", "/api/diagrams?offset=10001");
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error.code).toBe("VALIDATION_ERROR");
      expect(data.error.message).toContain("Offset cannot exceed");
      expect(data.error.message).toContain("10000");
      expect(data.error.details.field).toBe("offset");
      expect(data.error.details.received).toBe(10001);
    });

    it("accepts offset at maximum boundary", async () => {
      // MAX_LIST_OFFSET is 10,000 - should be accepted
      const res = await apiRequest("GET", "/api/diagrams?offset=10000");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.offset).toBe(10000);
    });

    it("clamps limit to maximum 100", async () => {
      const res = await apiRequest("GET", "/api/diagrams?limit=500");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.limit).toBe(100); // Clamped to max
    });
  });

  describe("GET /api/diagrams/:id", () => {
    it("returns diagram by ID", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("GET", `/api/diagrams/${diagram.id}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.id).toBe(diagram.id);
      expect(data.name).toBe("Test");
      expect(data.spec.type).toBe("flowchart");
    });

    it("returns 404 for non-existent diagram", async () => {
      const res = await apiRequest("GET", "/api/diagrams/nonexistent123");
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for empty ID", async () => {
      const res = await apiRequest("GET", "/api/diagrams/%20");
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error.code).toBe("INVALID_ID");
    });
  });

  describe("PUT /api/diagrams/:id", () => {
    it("updates diagram with force flag", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("PUT", `/api/diagrams/${diagram.id}`, {
        spec: sampleArchitectureSpec,
        message: "Updated to architecture",
        force: true,
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.spec.type).toBe("architecture");
    });

    it("updates diagram with If-Match header", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest(
        "PUT",
        `/api/diagrams/${diagram.id}`,
        { spec: sampleArchitectureSpec },
        { "If-Match": `"v${diagram.version}"` }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.spec.type).toBe("architecture");
      expect(data.version).toBe(diagram.version + 1);
    });

    it("returns ETag header with new version", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest(
        "PUT",
        `/api/diagrams/${diagram.id}`,
        { spec: sampleArchitectureSpec },
        { "If-Match": `"v${diagram.version}"` }
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("ETag")).toBe(`"v${diagram.version + 1}"`);
    });

    it("returns 428 Precondition Required when neither If-Match nor force provided", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("PUT", `/api/diagrams/${diagram.id}`, {
        spec: sampleArchitectureSpec,
      });

      expect(res.status).toBe(428);

      const data = await res.json();
      expect(data.error.code).toBe("VERSION_REQUIRED");
      expect(data.error.hint).toContain("If-Match");
    });

    it("returns 409 Conflict on version mismatch", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      // Diagram is at version 1, but we pretend we have version 99
      const wrongVersion = 99;

      const res = await apiRequest(
        "PUT",
        `/api/diagrams/${diagram.id}`,
        { spec: sampleArchitectureSpec },
        { "If-Match": `"v${wrongVersion}"` }
      );

      expect(res.status).toBe(409);

      const data = await res.json();
      expect(data.error.code).toBe("VERSION_CONFLICT");
      expect(data.error.details.currentVersion).toBe(diagram.version);
    });

    it("creates new version on update", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      await apiRequest("PUT", `/api/diagrams/${diagram.id}`, {
        spec: sampleArchitectureSpec,
        force: true,
      });

      const versions = testStorage.getVersions(diagram.id);
      expect(versions.length).toBe(2);
    });

    it("returns 404 for non-existent diagram", async () => {
      const res = await apiRequest("PUT", "/api/diagrams/nonexistent", {
        spec: sampleFlowchartSpec,
        force: true,
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 when spec is missing", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("PUT", `/api/diagrams/${diagram.id}`, { force: true });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error.code).toBe("VALIDATION_ERROR");
    });

    it("detects concurrent modification", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      const initialVersion = diagram.version;

      // Simulate another client updating the diagram (increments version to 2)
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec, "Other client update", initialVersion);

      // Our update should now fail because we're using the old version
      const res = await apiRequest(
        "PUT",
        `/api/diagrams/${diagram.id}`,
        { spec: sampleFlowchartSpec },
        { "If-Match": `"v${initialVersion}"` }
      );

      expect(res.status).toBe(409);

      const data = await res.json();
      expect(data.error.code).toBe("VERSION_CONFLICT");
    });
  });

  describe("DELETE /api/diagrams/:id", () => {
    it("deletes existing diagram", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("DELETE", `/api/diagrams/${diagram.id}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify deletion
      expect(testStorage.getDiagram(diagram.id)).toBeNull();
    });

    it("returns 404 for non-existent diagram", async () => {
      const res = await apiRequest("DELETE", "/api/diagrams/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});

describe("Versions API", () => {
  describe("GET /api/diagrams/:id/versions", () => {
    it("returns versions list", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec, "v2");

      const res = await apiRequest("GET", `/api/diagrams/${diagram.id}/versions`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.count).toBe(2);
      expect(data.versions[0].version).toBe(2);
      expect(data.versions[1].version).toBe(1);
    });

    it("returns 404 for non-existent diagram", async () => {
      const res = await apiRequest("GET", "/api/diagrams/nonexistent/versions");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/diagrams/:id/versions/:version", () => {
    it("returns specific version", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec);

      const res = await apiRequest("GET", `/api/diagrams/${diagram.id}/versions/1`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.version).toBe(1);
      expect(data.spec.type).toBe("flowchart");
    });

    it("returns 404 for non-existent version", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("GET", `/api/diagrams/${diagram.id}/versions/999`);
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error.code).toBe("VERSION_NOT_FOUND");
    });

    it("returns 400 for invalid version number", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("GET", `/api/diagrams/${diagram.id}/versions/abc`);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error.code).toBe("INVALID_VERSION");
    });

    it("returns 400 for negative version", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("GET", `/api/diagrams/${diagram.id}/versions/-1`);
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/diagrams/:id/restore/:version", () => {
    it("restores to previous version", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      testStorage.updateDiagram(diagram.id, sampleArchitectureSpec);

      const res = await apiRequest("POST", `/api/diagrams/${diagram.id}/restore/1`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.diagram.spec.type).toBe("flowchart");
      expect(data.message).toBe("Restored to version 1");
    });

    it("returns 404 for non-existent version", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("POST", `/api/diagrams/${diagram.id}/restore/999`);
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent diagram", async () => {
      const res = await apiRequest("POST", "/api/diagrams/nonexistent/restore/1");
      expect(res.status).toBe(404);
    });
  });
});

describe("Fork API", () => {
  describe("POST /api/diagrams/:id/fork", () => {
    it("forks diagram with default name", async () => {
      const original = testStorage.createDiagram("Original", "project", sampleFlowchartSpec);

      const res = await apiRequest("POST", `/api/diagrams/${original.id}/fork`, {});
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.diagram.name).toBe("Original (fork)");
      expect(data.diagram.id).not.toBe(original.id);
      expect(data.originalId).toBe(original.id);
    });

    it("forks with custom name", async () => {
      const original = testStorage.createDiagram("Original", "project", sampleFlowchartSpec);

      const res = await apiRequest("POST", `/api/diagrams/${original.id}/fork`, {
        name: "Custom Fork Name",
      });

      const data = await res.json();
      expect(data.diagram.name).toBe("Custom Fork Name");
    });

    it("forks to different project", async () => {
      const original = testStorage.createDiagram("Original", "project-a", sampleFlowchartSpec);

      const res = await apiRequest("POST", `/api/diagrams/${original.id}/fork`, {
        project: "project-b",
      });

      const data = await res.json();
      expect(data.diagram.project).toBe("project-b");
    });

    it("returns 404 for non-existent diagram", async () => {
      const res = await apiRequest("POST", "/api/diagrams/nonexistent/fork", {});
      expect(res.status).toBe(404);
    });
  });
});

describe("Thumbnail API", () => {
  describe("PUT /api/diagrams/:id/thumbnail", () => {
    it("updates thumbnail", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);
      const thumbnailData = "data:image/png;base64,iVBORw0KGgo...";

      const res = await apiRequest("PUT", `/api/diagrams/${diagram.id}/thumbnail`, {
        thumbnail: thumbnailData,
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify update
      const updated = testStorage.getDiagram(diagram.id);
      expect(updated?.thumbnailUrl).toBe(thumbnailData);
    });

    it("returns 400 when thumbnail is missing", async () => {
      const diagram = testStorage.createDiagram("Test", "project", sampleFlowchartSpec);

      const res = await apiRequest("PUT", `/api/diagrams/${diagram.id}/thumbnail`, {});

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 for non-existent diagram", async () => {
      const res = await apiRequest("PUT", "/api/diagrams/nonexistent/thumbnail", {
        thumbnail: "data:image/png;base64,...",
      });

      expect(res.status).toBe(404);
    });
  });
});

describe("Projects API", () => {
  describe("GET /api/projects", () => {
    it("returns empty list when no projects", async () => {
      const res = await apiRequest("GET", "/api/projects");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.count).toBe(0);
      expect(data.projects).toEqual([]);
    });

    it("returns unique projects", async () => {
      testStorage.createDiagram("D1", "alpha", sampleFlowchartSpec);
      testStorage.createDiagram("D2", "beta", sampleFlowchartSpec);
      testStorage.createDiagram("D3", "alpha", sampleFlowchartSpec);

      const res = await apiRequest("GET", "/api/projects");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.count).toBe(2);
      expect(data.projects).toContain("alpha");
      expect(data.projects).toContain("beta");
    });
  });
});

describe("Error Handling", () => {
  it("handles JSON parse errors gracefully", async () => {
    const res = await app.request("http://localhost/api/diagrams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });

    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error.code).toBe("INVALID_JSON");
  });
});

describe("Edge Cases", () => {
  it("handles special characters in diagram name", async () => {
    const res = await apiRequest("POST", "/api/diagrams", {
      name: "Test <script>alert('xss')</script>",
      spec: sampleFlowchartSpec,
    });

    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.name).toBe("Test <script>alert('xss')</script>");
  });

  it("handles unicode in diagram name", async () => {
    const res = await apiRequest("POST", "/api/diagrams", {
      name: "测试图表 🎨",
      spec: sampleFlowchartSpec,
    });

    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.name).toBe("测试图表 🎨");
  });

  it("handles very long diagram name", async () => {
    const longName = "A".repeat(10000);

    const res = await apiRequest("POST", "/api/diagrams", {
      name: longName,
      spec: sampleFlowchartSpec,
    });

    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.name.length).toBe(10000);
  });

  it("handles empty string project", async () => {
    const res = await apiRequest("POST", "/api/diagrams", {
      name: "Test",
      project: "",
      spec: sampleFlowchartSpec,
    });

    expect(res.status).toBe(201);

    const data = await res.json();
    // Empty string should default to "default"
    expect(data.project).toBe("default");
  });
});
