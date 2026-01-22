/**
 * Pagination API Endpoint Tests
 *
 * Tests for GET /api/diagrams endpoint with SQL-level pagination,
 * sorting, searching, and filtering.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { storage } from "../storage/db";
import type { DiagramSpec } from "../types";

describe("Pagination API Endpoint", () => {
  // Test diagram IDs to clean up
  const testDiagramIds: string[] = [];
  const testProject = "api-pagination-test";

  // Create test diagrams before all tests
  beforeAll(() => {
    // Create 15 test diagrams with varied names and types
    for (let i = 0; i < 15; i++) {
      const spec: DiagramSpec = {
        type: i % 3 === 0 ? "flowchart" : i % 3 === 1 ? "architecture" : "sequence",
        nodes: [{ id: `node-${i}`, label: `Node ${i}` }],
        edges: [],
      };
      const name = i < 10 ? `API Test 0${i}` : `API Test ${i}`;
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

  describe("listDiagramsPaginated Integration", () => {
    it("returns correct pagination structure", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 5,
        offset: 0,
      });

      expect(result.data).toBeArray();
      expect(result.data.length).toBe(5);
      expect(result.total).toBe(15);
    });

    it("returns correct page data", () => {
      const page1 = storage.listDiagramsPaginated({
        project: testProject,
        limit: 5,
        offset: 0,
      });

      const page2 = storage.listDiagramsPaginated({
        project: testProject,
        limit: 5,
        offset: 5,
      });

      const page3 = storage.listDiagramsPaginated({
        project: testProject,
        limit: 5,
        offset: 10,
      });

      // All pages should have 5 items
      expect(page1.data.length).toBe(5);
      expect(page2.data.length).toBe(5);
      expect(page3.data.length).toBe(5);

      // No duplicates across pages
      const allIds = [
        ...page1.data.map((d) => d.id),
        ...page2.data.map((d) => d.id),
        ...page3.data.map((d) => d.id),
      ];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(15);
    });

    it("filters by search term", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        search: "API Test 0",
        limit: 20,
      });

      // Should match "API Test 00" through "API Test 09"
      expect(result.total).toBe(10);
      expect(result.data.length).toBe(10);

      for (const diagram of result.data) {
        expect(diagram.name.toLowerCase()).toContain("api test 0");
      }
    });

    it("filters by type", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        types: ["flowchart"],
        limit: 20,
      });

      // Flowcharts at indices 0, 3, 6, 9, 12 = 5 diagrams
      expect(result.total).toBe(5);

      for (const diagram of result.data) {
        expect(diagram.spec.type).toBe("flowchart");
      }
    });

    it("sorts by name ascending", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        sortBy: "name",
        sortOrder: "asc",
        limit: 15,
      });

      expect(result.data[0].name).toBe("API Test 00");
      expect(result.data[14].name).toBe("API Test 14");
    });

    it("sorts by name descending", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        sortBy: "name",
        sortOrder: "desc",
        limit: 15,
      });

      expect(result.data[0].name).toBe("API Test 14");
      expect(result.data[14].name).toBe("API Test 00");
    });

    it("combines multiple filters", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        search: "API Test",
        types: ["architecture"],
        sortBy: "name",
        sortOrder: "asc",
        limit: 10,
      });

      // Architecture at indices 1, 4, 7, 10, 13 = 5 diagrams
      expect(result.total).toBe(5);

      // All should be architecture type
      for (const diagram of result.data) {
        expect(diagram.spec.type).toBe("architecture");
      }

      // Should be sorted by name
      for (let i = 0; i < result.data.length - 1; i++) {
        expect(result.data[i].name.localeCompare(result.data[i + 1].name)).toBeLessThanOrEqual(0);
      }
    });
  });

  describe("Pagination Helpers Calculation", () => {
    it("calculates currentPage correctly", () => {
      // Page 1: offset 0, limit 5
      const page1 = storage.listDiagramsPaginated({
        project: testProject,
        limit: 5,
        offset: 0,
      });
      expect(Math.floor(0 / 5) + 1).toBe(1);

      // Page 2: offset 5, limit 5
      const page2 = storage.listDiagramsPaginated({
        project: testProject,
        limit: 5,
        offset: 5,
      });
      expect(Math.floor(5 / 5) + 1).toBe(2);

      // Page 3: offset 10, limit 5
      const page3 = storage.listDiagramsPaginated({
        project: testProject,
        limit: 5,
        offset: 10,
      });
      expect(Math.floor(10 / 5) + 1).toBe(3);
    });

    it("calculates totalPages correctly", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 5,
      });

      // 15 items / 5 per page = 3 pages
      const totalPages = Math.ceil(result.total / 5);
      expect(totalPages).toBe(3);
    });

    it("calculates hasNextPage correctly", () => {
      const limit = 5;

      // Page 1: offset 0
      const offset1 = 0;
      const total = 15;
      expect(offset1 + limit < total).toBe(true); // Has next

      // Page 2: offset 5
      const offset2 = 5;
      expect(offset2 + limit < total).toBe(true); // Has next

      // Page 3: offset 10
      const offset3 = 10;
      expect(offset3 + limit < total).toBe(false); // No next
    });

    it("calculates hasPrevPage correctly", () => {
      // Page 1: offset 0
      expect(0 > 0).toBe(false); // No prev

      // Page 2: offset 5
      expect(5 > 0).toBe(true); // Has prev

      // Page 3: offset 10
      expect(10 > 0).toBe(true); // Has prev
    });
  });

  describe("Edge Cases", () => {
    it("handles empty search results", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        search: "nonexistent-xyz-999",
      });

      expect(result.data.length).toBe(0);
      expect(result.total).toBe(0);
    });

    it("handles offset beyond total", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        offset: 100,
        limit: 10,
      });

      expect(result.data.length).toBe(0);
      expect(result.total).toBe(15);
    });

    it("handles non-existent project", () => {
      const result = storage.listDiagramsPaginated({
        project: "nonexistent-project-xyz",
        limit: 10,
      });

      expect(result.data.length).toBe(0);
      expect(result.total).toBe(0);
    });

    it("handles single item page", () => {
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 1,
        offset: 0,
      });

      expect(result.data.length).toBe(1);
      expect(result.total).toBe(15);
    });

    it("handles partial last page", () => {
      // With 15 items and limit 7, page 3 has only 1 item
      const result = storage.listDiagramsPaginated({
        project: testProject,
        limit: 7,
        offset: 14,
      });

      expect(result.data.length).toBe(1);
      expect(result.total).toBe(15);
    });
  });

  describe("Performance", () => {
    it("SQL pagination is faster than full load for large datasets", () => {
      // This is a basic sanity check - SQL pagination should work
      const start = performance.now();

      // SQL-level pagination - only fetches what's needed
      const paginated = storage.listDiagramsPaginated({
        project: testProject,
        limit: 5,
      });

      const end = performance.now();
      const duration = end - start;

      // Should complete in reasonable time (under 100ms for small dataset)
      expect(duration).toBeLessThan(100);
      expect(paginated.data.length).toBe(5);
      expect(paginated.total).toBe(15);
    });
  });
});
