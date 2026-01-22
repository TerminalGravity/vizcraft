/**
 * SQL-Level Pagination Tests
 *
 * Tests for listDiagramsPaginated method with LIMIT/OFFSET,
 * sorting, searching, and filtering capabilities.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { storage } from "./db";
import type { DiagramSpec } from "../types";

describe("SQL-Level Pagination", () => {
  // Test diagram IDs to clean up
  const testDiagramIds: string[] = [];
  const testProject = "pagination-test-project";

  // Create test diagrams before all tests
  beforeAll(() => {
    // Create 25 test diagrams with varied names and types
    for (let i = 0; i < 25; i++) {
      const spec: DiagramSpec = {
        type: i % 3 === 0 ? "flowchart" : i % 3 === 1 ? "architecture" : "sequence",
        nodes: [{ id: `node-${i}`, label: `Node ${i}` }],
        edges: [],
      };
      const name = i < 10 ? `Diagram 0${i}` : `Diagram ${i}`;
      const diagram = storage.createDiagram(name, testProject, spec);
      testDiagramIds.push(diagram.id);
    }
  });

  // Clean up test diagrams after all tests
  afterAll(async () => {
    for (const id of testDiagramIds) {
      await storage.deleteDiagram(id);
    }
  });

  describe("Basic Pagination", () => {
    it("returns paginated results with default limit", () => {
      const result = storage.listDiagramsPaginated({ project: testProject });

      expect(result.data.length).toBeLessThanOrEqual(20); // Default limit
      expect(result.total).toBe(25);
    });

    it("respects custom limit", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 5,
      });

      expect(result.data.length).toBe(5);
      expect(result.total).toBe(25);
    });

    it("respects offset for pagination", () => {
      const page1 = storage.listDiagramsPaginated({
        project: testProject,
        limit: 10,
        offset: 0,
      });

      const page2 = storage.listDiagramsPaginated({
        project: testProject,
        limit: 10,
        offset: 10,
      });

      const page3 = storage.listDiagramsPaginated({
        project: testProject,
        limit: 10,
        offset: 20,
      });

      // Each page should have different diagrams
      expect(page1.data[0].id).not.toBe(page2.data[0].id);
      expect(page2.data[0].id).not.toBe(page3.data[0].id);

      // Page 3 should have only 5 items (25 total, offset 20)
      expect(page3.data.length).toBe(5);

      // Total should be consistent
      expect(page1.total).toBe(25);
      expect(page2.total).toBe(25);
      expect(page3.total).toBe(25);
    });

    it("returns empty array when offset exceeds total", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 10,
        offset: 100,
      });

      expect(result.data.length).toBe(0);
      expect(result.total).toBe(25);
    });
  });

  describe("Sorting", () => {
    it("sorts by updatedAt descending by default", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 25,
      });

      // Check descending order (most recent first)
      for (let i = 0; i < result.data.length - 1; i++) {
        const current = new Date(result.data[i].updatedAt).getTime();
        const next = new Date(result.data[i + 1].updatedAt).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });

    it("sorts by name ascending", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 25,
        sortBy: "name",
        sortOrder: "asc",
      });

      // Check ascending alphabetical order
      for (let i = 0; i < result.data.length - 1; i++) {
        expect(result.data[i].name.localeCompare(result.data[i + 1].name)).toBeLessThanOrEqual(0);
      }
    });

    it("sorts by name descending", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 25,
        sortBy: "name",
        sortOrder: "desc",
      });

      // Check descending alphabetical order
      for (let i = 0; i < result.data.length - 1; i++) {
        expect(result.data[i].name.localeCompare(result.data[i + 1].name)).toBeGreaterThanOrEqual(0);
      }
    });

    it("sorts by createdAt", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
      });

      // Check descending order
      for (let i = 0; i < result.data.length - 1; i++) {
        const current = new Date(result.data[i].createdAt).getTime();
        const next = new Date(result.data[i + 1].createdAt).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });
  });

  describe("Search", () => {
    it("filters by name search (case-insensitive)", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        search: "diagram 0",
        limit: 25,
      });

      // Should match "Diagram 00" through "Diagram 09"
      expect(result.data.length).toBe(10);
      expect(result.total).toBe(10);

      // All results should contain the search term
      for (const diagram of result.data) {
        expect(diagram.name.toLowerCase()).toContain("diagram 0");
      }
    });

    it("returns empty when search has no matches", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        search: "nonexistent-xyz-123",
      });

      expect(result.data.length).toBe(0);
      expect(result.total).toBe(0);
    });

    it("search is case-insensitive", () => {
      const lowerResult = storage.listDiagramsPaginated({
        project: testProject,
        search: "diagram",
        limit: 25,
      });

      const upperResult = storage.listDiagramsPaginated({
        project: testProject,
        search: "DIAGRAM",
        limit: 25,
      });

      expect(lowerResult.total).toBe(upperResult.total);
    });
  });

  describe("Type Filtering", () => {
    it("filters by single type", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        types: ["flowchart"],
        limit: 25,
      });

      // Should have 9 flowcharts (indices 0, 3, 6, 9, 12, 15, 18, 21, 24)
      expect(result.data.length).toBe(9);
      expect(result.total).toBe(9);

      for (const diagram of result.data) {
        expect(diagram.spec.type).toBe("flowchart");
      }
    });

    it("filters by multiple types", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        types: ["flowchart", "architecture"],
        limit: 25,
      });

      // Should have 9 flowcharts + 8 architecture = 17
      expect(result.data.length).toBe(17);
      expect(result.total).toBe(17);

      for (const diagram of result.data) {
        expect(["flowchart", "architecture"]).toContain(diagram.spec.type);
      }
    });

    it("returns empty when type has no matches", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        types: ["nonexistent-type"],
      });

      expect(result.data.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe("Combined Filters", () => {
    it("combines search and type filter", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        search: "diagram 0",
        types: ["flowchart"],
        limit: 25,
      });

      // "Diagram 0X" AND flowchart (indices 0, 3, 6, 9)
      expect(result.total).toBe(4);

      for (const diagram of result.data) {
        expect(diagram.name.toLowerCase()).toContain("diagram 0");
        expect(diagram.spec.type).toBe("flowchart");
      }
    });

    it("combines search, type filter, and pagination", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        search: "diagram",
        types: ["architecture"],
        limit: 3,
        offset: 0,
        sortBy: "name",
        sortOrder: "asc",
      });

      expect(result.data.length).toBe(3);
      // Total architecture diagrams is 8
      expect(result.total).toBe(8);

      // Should be sorted by name
      for (const diagram of result.data) {
        expect(diagram.spec.type).toBe("architecture");
      }
    });
  });

  describe("Project Filtering", () => {
    it("returns only diagrams from specified project", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 50,
      });

      expect(result.total).toBe(25);

      for (const diagram of result.data) {
        expect(diagram.project).toBe(testProject);
      }
    });

    it("returns all diagrams when project not specified", () => {
      const allResult = storage.listDiagramsPaginated({
        limit: 100,
      });

      // Should include at least our test diagrams
      expect(allResult.total).toBeGreaterThanOrEqual(25);
    });
  });

  describe("countDiagrams", () => {
    it("counts all diagrams", () => {
      const count = storage.countDiagrams();
      expect(count).toBeGreaterThanOrEqual(25);
    });

    it("counts diagrams by project", () => {
      const count = storage.countDiagrams(testProject);
      expect(count).toBe(25);
    });

    it("returns 0 for non-existent project", () => {
      const count = storage.countDiagrams("nonexistent-project-xyz");
      expect(count).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("handles limit of 0", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 0,
      });

      expect(result.data.length).toBe(0);
      expect(result.total).toBe(25);
    });

    it("handles very large limit", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 1000,
      });

      expect(result.data.length).toBe(25); // Only 25 exist
      expect(result.total).toBe(25);
    });

    it("handles empty search string", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        search: "",
        limit: 25,
      });

      // Empty search should return all
      expect(result.total).toBe(25);
    });

    it("handles empty types array", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        types: [],
        limit: 25,
      });

      // Empty types array should return all
      expect(result.total).toBe(25);
    });
  });
});
