/**
 * Protected Storage Tests
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { protectedStorage } from "./protected-storage";
import { circuitBreakers } from "../utils/circuit-breaker";
import { resetMetrics, getMetricValues } from "../metrics";
import type { DiagramSpec } from "../types";

describe("Protected Storage", () => {
  const testSpec: DiagramSpec = {
    type: "flowchart",
    nodes: [{ id: "1", label: "Test Node" }],
    edges: [],
  };

  let createdDiagramId: string | null = null;

  beforeEach(() => {
    // Reset circuit breaker and metrics before each test
    circuitBreakers.database.reset();
    resetMetrics();
  });

  afterEach(async () => {
    // Cleanup created diagram
    if (createdDiagramId) {
      try {
        await protectedStorage.deleteDiagram(createdDiagramId);
      } catch {
        // Ignore cleanup errors
      }
      createdDiagramId = null;
    }
  });

  describe("basic operations", () => {
    test("createDiagram creates a diagram", () => {
      const diagram = protectedStorage.createDiagram(
        "Protected Test",
        "test-project",
        testSpec
      );

      createdDiagramId = diagram.id;

      expect(diagram.name).toBe("Protected Test");
      expect(diagram.project).toBe("test-project");
      expect(diagram.spec).toEqual(testSpec);
    });

    test("getDiagram retrieves a diagram", () => {
      const created = protectedStorage.createDiagram(
        "Get Test",
        "test-project",
        testSpec
      );
      createdDiagramId = created.id;

      const retrieved = protectedStorage.getDiagram(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe("Get Test");
    });

    test("getDiagram returns null for non-existent diagram", () => {
      const result = protectedStorage.getDiagram("non-existent-id");
      expect(result).toBeNull();
    });

    test("updateDiagram updates a diagram", () => {
      const created = protectedStorage.createDiagram(
        "Update Test",
        "test-project",
        testSpec
      );
      createdDiagramId = created.id;

      const newSpec: DiagramSpec = {
        type: "flowchart",
        nodes: [{ id: "1", label: "Updated Node" }],
        edges: [],
      };

      const updated = protectedStorage.updateDiagram(created.id, newSpec, "Updated");

      expect(updated).not.toBeNull();
      expect("conflict" in updated!).toBe(false);
      expect((updated as { spec: DiagramSpec }).spec.nodes[0].label).toBe("Updated Node");
    });

    test("deleteDiagram removes a diagram", async () => {
      const created = protectedStorage.createDiagram(
        "Delete Test",
        "test-project",
        testSpec
      );

      const deleted = await protectedStorage.deleteDiagram(created.id);
      expect(deleted).toBe(true);

      const retrieved = protectedStorage.getDiagram(created.id);
      expect(retrieved).toBeNull();

      // Don't try to cleanup in afterEach
      createdDiagramId = null;
    });

    test("listDiagrams returns diagrams", () => {
      const created = protectedStorage.createDiagram(
        "List Test",
        "protected-test-project-unique",
        testSpec
      );
      createdDiagramId = created.id;

      const diagrams = protectedStorage.listDiagrams("protected-test-project-unique");

      expect(Array.isArray(diagrams)).toBe(true);
      expect(diagrams.length).toBeGreaterThanOrEqual(1);
      expect(diagrams.some((d) => d.id === created.id)).toBe(true);
    });

    test("countDiagrams returns count", () => {
      const count = protectedStorage.countDiagrams();
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe("metrics tracking", () => {
    test("tracks successful operations in metrics", () => {
      const created = protectedStorage.createDiagram(
        "Metrics Test",
        "test-project",
        testSpec
      );
      createdDiagramId = created.id;

      protectedStorage.getDiagram(created.id);

      const { counters, histograms } = getMetricValues();

      // Should have tracked db_operations_total
      expect(counters.get("db_operations_total")).toBeDefined();

      // Should have tracked operation duration
      expect(histograms.get("db_operation_duration_ms")).toBeDefined();
    });

    test("tracks operation types correctly", async () => {
      const created = protectedStorage.createDiagram(
        "Op Types Test",
        "test-project",
        testSpec
      );

      protectedStorage.getDiagram(created.id);
      await protectedStorage.deleteDiagram(created.id);

      const { counters } = getMetricValues();
      const ops = counters.get("db_operations_total") || [];

      // Check that we tracked INSERT, SELECT, and DELETE
      const operations = ops.map((v) => v.labels.operation);
      expect(operations).toContain("INSERT");
      expect(operations).toContain("SELECT");
      expect(operations).toContain("DELETE");
    });
  });

  describe("circuit breaker integration", () => {
    test("getCircuitBreakerStats returns stats", () => {
      const stats = protectedStorage.getCircuitBreakerStats();

      expect(stats.state).toBe("CLOSED");
      expect(typeof stats.totalCalls).toBe("number");
      expect(typeof stats.totalFailures).toBe("number");
    });

    test("resetCircuitBreaker resets state", () => {
      // Force some state change
      circuitBreakers.database.forceState("OPEN");
      expect(protectedStorage.getCircuitBreakerStats().state).toBe("OPEN");

      // Reset
      protectedStorage.resetCircuitBreaker();
      expect(protectedStorage.getCircuitBreakerStats().state).toBe("CLOSED");
    });

    test("raw storage is accessible for unprotected operations", () => {
      const raw = protectedStorage.raw;

      expect(raw).toBeDefined();
      expect(typeof raw.createDiagram).toBe("function");
      expect(typeof raw.getDiagram).toBe("function");
    });
  });

  describe("version history", () => {
    test("getVersions returns versions", () => {
      const created = protectedStorage.createDiagram(
        "Version History Test",
        "test-project",
        testSpec
      );
      createdDiagramId = created.id;

      const versions = protectedStorage.getVersions(created.id);

      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThanOrEqual(1);
    });

    test("getVersion returns specific version", () => {
      const created = protectedStorage.createDiagram(
        "Get Version Test",
        "test-project",
        testSpec
      );
      createdDiagramId = created.id;

      const version = protectedStorage.getVersion(created.id, 1);

      expect(version).toBeDefined();
      expect(version?.version).toBe(1);
    });
  });

  describe("fork and projects", () => {
    test("forkDiagram creates a copy", async () => {
      const original = protectedStorage.createDiagram(
        "Fork Original",
        "test-project",
        testSpec
      );

      const forked = protectedStorage.forkDiagram(original.id, "Forked Diagram");

      // Clean up both
      await protectedStorage.deleteDiagram(original.id);
      if (forked) {
        await protectedStorage.deleteDiagram(forked.id);
      }

      expect(forked).not.toBeNull();
      expect(forked?.name).toBe("Forked Diagram");
      expect(forked?.id).not.toBe(original.id);
    });

    test("listProjects returns unique projects", () => {
      const projects = protectedStorage.listProjects();

      expect(Array.isArray(projects)).toBe(true);
    });
  });
});
