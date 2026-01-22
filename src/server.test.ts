/**
 * Vizcraft Server Tests
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { storage } from "./storage/db";
import type { DiagramSpec } from "./types";

const testSpec: DiagramSpec = {
  type: "flowchart",
  theme: "dark",
  nodes: [
    { id: "a", label: "Start" },
    { id: "b", label: "Process" },
    { id: "c", label: "End" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
};

let testDiagramId: string;

test("create diagram", () => {
  const diagram = storage.createDiagram("Test Diagram", "test-project", testSpec);

  expect(diagram).toBeDefined();
  expect(diagram.id).toBeDefined();
  expect(diagram.name).toBe("Test Diagram");
  expect(diagram.project).toBe("test-project");
  expect(diagram.spec.nodes).toHaveLength(3);
  expect(diagram.spec.edges).toHaveLength(2);

  testDiagramId = diagram.id;
});

test("get diagram", () => {
  const diagram = storage.getDiagram(testDiagramId);

  expect(diagram).toBeDefined();
  expect(diagram?.name).toBe("Test Diagram");
  expect(diagram?.spec.type).toBe("flowchart");
});

test("list diagrams", () => {
  const all = storage.listDiagrams();
  expect(all.length).toBeGreaterThan(0);

  const filtered = storage.listDiagrams("test-project");
  expect(filtered.length).toBeGreaterThan(0);
  expect(filtered[0].project).toBe("test-project");
});

test("update diagram", () => {
  const newSpec: DiagramSpec = {
    ...testSpec,
    nodes: [
      ...testSpec.nodes,
      { id: "d", label: "New Node" },
    ],
  };

  const updated = storage.updateDiagram(testDiagramId, newSpec, "Added new node");

  expect(updated).toBeDefined();
  expect(updated?.spec.nodes).toHaveLength(4);
});

test("get versions", () => {
  const versions = storage.getVersions(testDiagramId);

  expect(versions.length).toBeGreaterThanOrEqual(2);
  expect(versions[0].version).toBeGreaterThan(versions[1].version);
});

test("list projects", () => {
  const projects = storage.listProjects();

  expect(projects).toContain("test-project");
});

test("delete diagram", async () => {
  const deleted = await storage.deleteDiagram(testDiagramId);
  expect(deleted).toBe(true);

  const diagram = storage.getDiagram(testDiagramId);
  expect(diagram).toBeNull();
});

test("get non-existent diagram returns null", () => {
  const diagram = storage.getDiagram("non-existent-id");
  expect(diagram).toBeNull();
});
