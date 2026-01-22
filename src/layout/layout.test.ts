/**
 * Layout Module Tests
 */

import { describe, it, expect } from "bun:test";
import { layoutDiagram, listLayoutAlgorithms } from "./engine";
import { gridLayout, circularLayout } from "./simple";
import type { DiagramSpec } from "../types";

const testSpec: DiagramSpec = {
  type: "flowchart",
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

describe("Layout Engine", () => {
  it("lists available layout algorithms", () => {
    const algorithms = listLayoutAlgorithms();
    expect(algorithms.length).toBeGreaterThan(0);
    expect(algorithms.some((a) => a.id === "dagre")).toBe(true);
    expect(algorithms.some((a) => a.id === "elk-layered")).toBe(true);
    expect(algorithms.some((a) => a.id === "grid")).toBe(true);
    expect(algorithms.some((a) => a.id === "circular")).toBe(true);
  });

  it("applies dagre layout", async () => {
    const result = await layoutDiagram(testSpec, { algorithm: "dagre" });
    expect(result.success).toBe(true);
    expect(result.spec).toBeDefined();
    expect(result.spec?.nodes[0].position).toBeDefined();
    expect(result.spec?.nodes[1].position).toBeDefined();
    expect(result.spec?.nodes[2].position).toBeDefined();
  });

  it("applies elk-layered layout", async () => {
    const result = await layoutDiagram(testSpec, { algorithm: "elk-layered" });
    expect(result.success).toBe(true);
    expect(result.spec).toBeDefined();
    expect(result.spec?.nodes[0].position).toBeDefined();
  });

  it("applies elk-force layout", async () => {
    const result = await layoutDiagram(testSpec, { algorithm: "elk-force" });
    expect(result.success).toBe(true);
    expect(result.spec).toBeDefined();
  });

  it("applies grid layout", async () => {
    const result = await layoutDiagram(testSpec, { algorithm: "grid" });
    expect(result.success).toBe(true);
    expect(result.spec).toBeDefined();
    expect(result.spec?.nodes[0].position).toBeDefined();
  });

  it("applies circular layout", async () => {
    const result = await layoutDiagram(testSpec, { algorithm: "circular" });
    expect(result.success).toBe(true);
    expect(result.spec).toBeDefined();
    expect(result.spec?.nodes[0].position).toBeDefined();
  });

  it("returns error for unknown algorithm", async () => {
    const result = await layoutDiagram(testSpec, { algorithm: "unknown" as any });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown layout algorithm");
  });

  it("respects direction option", async () => {
    const resultDown = await layoutDiagram(testSpec, { algorithm: "dagre", direction: "DOWN" });
    const resultRight = await layoutDiagram(testSpec, { algorithm: "dagre", direction: "RIGHT" });

    expect(resultDown.success).toBe(true);
    expect(resultRight.success).toBe(true);

    // In DOWN layout, nodes should be stacked vertically (y increases)
    // In RIGHT layout, nodes should be stacked horizontally (x increases)
    const downNodes = resultDown.spec!.nodes;
    const rightNodes = resultRight.spec!.nodes;

    // Start node should be above/left of end node depending on direction
    const downYDiff = downNodes[2].position!.y - downNodes[0].position!.y;
    const rightXDiff = rightNodes[2].position!.x - rightNodes[0].position!.x;

    expect(downYDiff).toBeGreaterThan(0); // End below Start
    expect(rightXDiff).toBeGreaterThan(0); // End right of Start
  });
});

describe("Simple Layouts", () => {
  const graph = {
    nodes: [
      { id: "a", width: 100, height: 50 },
      { id: "b", width: 100, height: 50 },
      { id: "c", width: 100, height: 50 },
      { id: "d", width: 100, height: 50 },
    ],
    edges: [],
  };

  it("grid layout arranges in grid pattern", () => {
    const result = gridLayout(graph, { algorithm: "grid", spacing: { nodeSpacing: 20 } });
    expect(result.success).toBe(true);

    // With 4 nodes, should be 2x2 grid
    const positions = Object.values(result.positions);
    expect(positions.length).toBe(4);

    // Check that nodes are in a grid
    const xs = [...new Set(positions.map((p) => p.x))];
    const ys = [...new Set(positions.map((p) => p.y))];

    expect(xs.length).toBe(2); // 2 columns
    expect(ys.length).toBe(2); // 2 rows
  });

  it("circular layout arranges in circle", () => {
    const result = circularLayout(graph, { algorithm: "circular" });
    expect(result.success).toBe(true);

    const positions = Object.values(result.positions);
    expect(positions.length).toBe(4);

    // Calculate center of all positions
    const centerX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
    const centerY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;

    // All nodes should be roughly equidistant from center
    const distances = positions.map((p) =>
      Math.sqrt(Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2))
    );

    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const maxDeviation = Math.max(...distances.map((d) => Math.abs(d - avgDistance)));

    // Allow some tolerance (nodes have different sizes at center vs edge)
    expect(maxDeviation).toBeLessThan(avgDistance * 0.5);
  });
});
