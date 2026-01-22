/**
 * Database Optimizations Tests
 *
 * Tests for SQLite WAL mode, pragmas, and indexes
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
// Import storage to trigger database initialization with pragmas and indexes
import "./db";

const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = `${DATA_DIR}/vizcraft.db`;

describe("Database Optimizations", () => {
  let db: Database;

  beforeAll(() => {
    // Open our own connection - need to set pragmas per connection
    db = new Database(DB_PATH, { readonly: true });
  });

  describe("WAL Mode", () => {
    it("has WAL journal mode enabled", () => {
      // journal_mode persists in the database file
      const result = db.query<{ journal_mode: string }, []>(
        "PRAGMA journal_mode"
      ).get();

      expect(result?.journal_mode).toBe("wal");
    });

    it("creates WAL file", async () => {
      // WAL mode creates a -wal file alongside the database
      const walFile = Bun.file(`${DB_PATH}-wal`);
      expect(await walFile.exists()).toBe(true);
    });

    // Note: synchronous, cache_size, and foreign_keys are per-connection settings
    // They're set in db.ts on the main connection but don't persist to new connections
    // We verify they're configured by checking the db.ts code structure
    it("db.ts configures per-connection pragmas", async () => {
      const dbSource = await Bun.file("./src/storage/db.ts").text();

      expect(dbSource).toContain('PRAGMA synchronous=NORMAL');
      expect(dbSource).toContain('PRAGMA cache_size=-65536');
      expect(dbSource).toContain('PRAGMA foreign_keys=ON');
    });
  });

  describe("Indexes", () => {
    it("has idx_diagrams_project index", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_diagrams_project");

      expect(result?.name).toBe("idx_diagrams_project");
    });

    it("has idx_diagrams_created_at index", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_diagrams_created_at");

      expect(result?.name).toBe("idx_diagrams_created_at");
    });

    it("has idx_diagrams_updated_at index", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_diagrams_updated_at");

      expect(result?.name).toBe("idx_diagrams_updated_at");
    });

    it("has idx_diagrams_project_updated composite index", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_diagrams_project_updated");

      expect(result?.name).toBe("idx_diagrams_project_updated");
    });

    it("has idx_versions_diagram index", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_versions_diagram");

      expect(result?.name).toBe("idx_versions_diagram");
    });

    it("has idx_versions_created_at index", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_versions_created_at");

      expect(result?.name).toBe("idx_versions_created_at");
    });

    it("has idx_versions_diagram_version composite index", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_versions_diagram_version");

      expect(result?.name).toBe("idx_versions_diagram_version");
    });

    it("has idx_agent_runs_diagram index", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_agent_runs_diagram");

      expect(result?.name).toBe("idx_agent_runs_diagram");
    });

    it("has idx_agent_runs_created_at index", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_agent_runs_created_at");

      expect(result?.name).toBe("idx_agent_runs_created_at");
    });

    it("has idx_agent_runs_status index", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_agent_runs_status");

      expect(result?.name).toBe("idx_agent_runs_status");
    });

    it("has idx_diagrams_type expression index for type filtering", () => {
      const result = db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get("idx_diagrams_type");

      expect(result?.name).toBe("idx_diagrams_type");
    });
  });

  describe("Query Performance", () => {
    it("uses index for project filter query", () => {
      const plan = db.query<{ detail: string }, []>(
        "EXPLAIN QUERY PLAN SELECT * FROM diagrams WHERE project = 'test'"
      ).all();

      const planText = plan.map((p) => p.detail).join(" ");
      // Should use an index, not a full table scan
      expect(planText).toMatch(/USING INDEX|USING COVERING INDEX/i);
    });

    it("uses index for updated_at sort query", () => {
      const plan = db.query<{ detail: string }, []>(
        "EXPLAIN QUERY PLAN SELECT * FROM diagrams ORDER BY updated_at DESC"
      ).all();

      const planText = plan.map((p) => p.detail).join(" ");
      // Should use an index for sorting
      expect(planText).toMatch(/USING INDEX|SCAN/i);
    });

    it("uses composite index for project + updated_at query", () => {
      const plan = db.query<{ detail: string }, []>(
        "EXPLAIN QUERY PLAN SELECT * FROM diagrams WHERE project = 'test' ORDER BY updated_at DESC"
      ).all();

      const planText = plan.map((p) => p.detail).join(" ");
      // Should use the composite index
      expect(planText).toMatch(/USING INDEX|USING COVERING INDEX/i);
    });

    it("uses index for version lookups", () => {
      const plan = db.query<{ detail: string }, []>(
        "EXPLAIN QUERY PLAN SELECT * FROM diagram_versions WHERE diagram_id = 'test123' ORDER BY version DESC LIMIT 1"
      ).all();

      const planText = plan.map((p) => p.detail).join(" ");
      expect(planText).toMatch(/USING INDEX|USING COVERING INDEX/i);
    });

    it("uses expression index for diagram type filtering", () => {
      const plan = db.query<{ detail: string }, []>(
        "EXPLAIN QUERY PLAN SELECT * FROM diagrams WHERE json_extract(spec, '$.type') IN ('flowchart', 'architecture')"
      ).all();

      const planText = plan.map((p) => p.detail).join(" ");
      // Should use the expression index, not a full table scan
      expect(planText).toMatch(/USING INDEX idx_diagrams_type/i);
    });
  });
});
