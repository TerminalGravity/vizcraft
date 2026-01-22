/**
 * Web API Integration Tests
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { storage } from "./storage/db";
import type { DiagramSpec } from "./types";

// Note: These tests run against the storage layer directly
// For full API tests, the web server would need to be running

const testSpec: DiagramSpec = {
  type: "architecture",
  theme: "professional",
  nodes: [
    { id: "api", label: "API Gateway", type: "box" },
    { id: "auth", label: "Auth Service", type: "box" },
    { id: "db", label: "Database", type: "database" },
  ],
  edges: [
    { from: "api", to: "auth", label: "authenticate" },
    { from: "auth", to: "db", label: "query" },
  ],
};

describe("Web API Integration", () => {
  let diagramId: string;

  beforeAll(() => {
    // Create a test diagram
    const diagram = storage.createDiagram("API Test Diagram", "api-tests", testSpec);
    diagramId = diagram.id;
  });

  afterAll(async () => {
    // Cleanup
    await storage.deleteDiagram(diagramId);
  });

  describe("Diagram CRUD", () => {
    test("creates diagram with all fields", () => {
      const diagram = storage.getDiagram(diagramId);

      expect(diagram).not.toBeNull();
      expect(diagram?.name).toBe("API Test Diagram");
      expect(diagram?.project).toBe("api-tests");
      expect(diagram?.spec.type).toBe("architecture");
      expect(diagram?.spec.theme).toBe("professional");
      expect(diagram?.spec.nodes).toHaveLength(3);
      expect(diagram?.spec.edges).toHaveLength(2);
    });

    test("update creates version history", () => {
      const newSpec: DiagramSpec = {
        ...testSpec,
        nodes: [...testSpec.nodes, { id: "cache", label: "Cache", type: "cylinder" }],
      };

      storage.updateDiagram(diagramId, newSpec, "Added cache layer");
      const versions = storage.getVersions(diagramId);

      expect(versions.length).toBeGreaterThanOrEqual(2);
      expect(versions[0].message).toBe("Added cache layer");
    });

    test("lists diagrams by project", () => {
      const diagrams = storage.listDiagrams("api-tests");

      expect(diagrams.length).toBeGreaterThan(0);
      expect(diagrams.every((d) => d.project === "api-tests")).toBe(true);
    });

    test("lists all projects", () => {
      const projects = storage.listProjects();

      expect(projects).toContain("api-tests");
    });
  });

  describe("Error Handling", () => {
    test("returns null for non-existent diagram", () => {
      const diagram = storage.getDiagram("fake-id-12345");
      expect(diagram).toBeNull();
    });

    test("delete returns false for non-existent diagram", async () => {
      const result = await storage.deleteDiagram("fake-id-12345");
      expect(result).toBe(false);
    });

    test("update returns null for non-existent diagram", () => {
      const result = storage.updateDiagram("fake-id-12345", testSpec);
      expect(result).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    test("handles empty node/edge arrays", async () => {
      const emptySpec: DiagramSpec = {
        type: "freeform",
        nodes: [],
        edges: [],
      };

      const diagram = storage.createDiagram("Empty Diagram", "api-tests", emptySpec);
      expect(diagram.spec.nodes).toHaveLength(0);
      expect(diagram.spec.edges).toHaveLength(0);

      await storage.deleteDiagram(diagram.id);
    });

    test("handles special characters in names", async () => {
      const diagram = storage.createDiagram("Test & <Diagram> \"Quote\"", "api-tests", testSpec);
      expect(diagram.name).toBe("Test & <Diagram> \"Quote\"");

      await storage.deleteDiagram(diagram.id);
    });

    test("handles unicode in labels", async () => {
      const unicodeSpec: DiagramSpec = {
        type: "flowchart",
        nodes: [
          { id: "start", label: "开始 🚀" },
          { id: "end", label: "終わり 🎉" },
        ],
        edges: [{ from: "start", to: "end", label: "进行 → 完成" }],
      };

      const diagram = storage.createDiagram("Unicode Test", "api-tests", unicodeSpec);
      expect(diagram.spec.nodes[0].label).toBe("开始 🚀");

      await storage.deleteDiagram(diagram.id);
    });
  });
});
