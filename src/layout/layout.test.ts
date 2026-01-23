/**
 * Layout Module Tests
 */

import { describe, it, expect } from "bun:test";
import { layoutDiagram, listLayoutAlgorithms } from "./engine";
import { gridLayout, circularLayout } from "./simple";
import { safePositiveNumber, safeNumber, safePosition } from "./types";
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

describe("Layout Edge Cases", () => {
  it("handles empty diagram (0 nodes)", async () => {
    const emptySpec: DiagramSpec = {
      type: "flowchart",
      nodes: [],
      edges: [],
    };

    const dagreResult = await layoutDiagram(emptySpec, { algorithm: "dagre" });
    expect(dagreResult.success).toBe(true);
    expect(dagreResult.spec?.nodes).toHaveLength(0);

    const gridResult = await layoutDiagram(emptySpec, { algorithm: "grid" });
    expect(gridResult.success).toBe(true);
    expect(gridResult.spec?.nodes).toHaveLength(0);

    const circularResult = await layoutDiagram(emptySpec, { algorithm: "circular" });
    expect(circularResult.success).toBe(true);
    expect(circularResult.spec?.nodes).toHaveLength(0);
  });

  it("handles single node diagram", async () => {
    const singleNodeSpec: DiagramSpec = {
      type: "flowchart",
      nodes: [{ id: "only", label: "Only Node" }],
      edges: [],
    };

    const dagreResult = await layoutDiagram(singleNodeSpec, { algorithm: "dagre" });
    expect(dagreResult.success).toBe(true);
    expect(dagreResult.spec?.nodes[0].position).toBeDefined();

    const gridResult = await layoutDiagram(singleNodeSpec, { algorithm: "grid" });
    expect(gridResult.success).toBe(true);
    expect(gridResult.spec?.nodes[0].position).toBeDefined();

    const circularResult = await layoutDiagram(singleNodeSpec, { algorithm: "circular" });
    expect(circularResult.success).toBe(true);
    expect(circularResult.spec?.nodes[0].position).toBeDefined();
  });

  it("handles large diagram (100+ nodes)", async () => {
    const largeSpec: DiagramSpec = {
      type: "flowchart",
      nodes: Array.from({ length: 100 }, (_, i) => ({
        id: `node-${i}`,
        label: `Node ${i}`,
      })),
      edges: Array.from({ length: 99 }, (_, i) => ({
        from: `node-${i}`,
        to: `node-${i + 1}`,
      })),
    };

    const result = await layoutDiagram(largeSpec, { algorithm: "dagre" });
    expect(result.success).toBe(true);
    expect(result.spec?.nodes).toHaveLength(100);
    // All nodes should have positions
    result.spec?.nodes.forEach((node) => {
      expect(node.position).toBeDefined();
      expect(typeof node.position?.x).toBe("number");
      expect(typeof node.position?.y).toBe("number");
      expect(Number.isNaN(node.position?.x)).toBe(false);
      expect(Number.isNaN(node.position?.y)).toBe(false);
    });
  });

  it("handles disconnected subgraphs", async () => {
    const disconnectedSpec: DiagramSpec = {
      type: "flowchart",
      nodes: [
        { id: "a1", label: "Group A - 1" },
        { id: "a2", label: "Group A - 2" },
        { id: "b1", label: "Group B - 1" },
        { id: "b2", label: "Group B - 2" },
      ],
      edges: [
        { from: "a1", to: "a2" },
        { from: "b1", to: "b2" },
        // No edges connecting groups A and B
      ],
    };

    const result = await layoutDiagram(disconnectedSpec, { algorithm: "dagre" });
    expect(result.success).toBe(true);
    result.spec?.nodes.forEach((node) => {
      expect(node.position).toBeDefined();
    });
  });

  it("handles self-referential edges", async () => {
    const selfRefSpec: DiagramSpec = {
      type: "flowchart",
      nodes: [
        { id: "loop", label: "Self Loop" },
        { id: "next", label: "Next" },
      ],
      edges: [
        { from: "loop", to: "loop" }, // Self-referential
        { from: "loop", to: "next" },
      ],
    };

    const result = await layoutDiagram(selfRefSpec, { algorithm: "dagre" });
    expect(result.success).toBe(true);
    result.spec?.nodes.forEach((node) => {
      expect(node.position).toBeDefined();
    });
  });

  it("handles edges with non-existent node references gracefully", async () => {
    const invalidEdgeSpec: DiagramSpec = {
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "nonexistent" }, // Invalid reference
      ],
    };

    // Should either succeed with valid nodes positioned or fail gracefully
    const result = await layoutDiagram(invalidEdgeSpec, { algorithm: "dagre" });
    // Layout should still work for valid nodes even if some edges are invalid
    expect(result.spec?.nodes[0].position || result.success === false).toBeTruthy();
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

  it("grid layout handles empty graph", () => {
    const emptyGraph = { nodes: [], edges: [] };
    const result = gridLayout(emptyGraph, { algorithm: "grid" });
    expect(result.success).toBe(true);
    expect(Object.keys(result.positions)).toHaveLength(0);
  });

  it("grid layout handles single node", () => {
    const singleGraph = {
      nodes: [{ id: "only", width: 100, height: 50 }],
      edges: [],
    };
    const result = gridLayout(singleGraph, { algorithm: "grid" });
    expect(result.success).toBe(true);
    expect(result.positions["only"]).toBeDefined();
    // Single node should have a valid numeric position
    expect(typeof result.positions["only"].x).toBe("number");
    expect(typeof result.positions["only"].y).toBe("number");
    expect(Number.isNaN(result.positions["only"].x)).toBe(false);
    expect(Number.isNaN(result.positions["only"].y)).toBe(false);
  });

  it("circular layout handles empty graph", () => {
    const emptyGraph = { nodes: [], edges: [] };
    const result = circularLayout(emptyGraph, { algorithm: "circular" });
    expect(result.success).toBe(true);
    expect(Object.keys(result.positions)).toHaveLength(0);
  });

  it("circular layout handles single node", () => {
    const singleGraph = {
      nodes: [{ id: "only", width: 100, height: 50 }],
      edges: [],
    };
    const result = circularLayout(singleGraph, { algorithm: "circular" });
    expect(result.success).toBe(true);
    expect(result.positions["only"]).toBeDefined();
  });

  it("grid layout handles non-square counts", () => {
    // 5 nodes should arrange in 3x2 grid (not perfectly square)
    const fiveNodeGraph = {
      nodes: [
        { id: "a", width: 100, height: 50 },
        { id: "b", width: 100, height: 50 },
        { id: "c", width: 100, height: 50 },
        { id: "d", width: 100, height: 50 },
        { id: "e", width: 100, height: 50 },
      ],
      edges: [],
    };
    const result = gridLayout(fiveNodeGraph, { algorithm: "grid" });
    expect(result.success).toBe(true);
    expect(Object.keys(result.positions)).toHaveLength(5);
  });
});

describe("Layout Validation Utilities", () => {
  describe("safePositiveNumber", () => {
    it("returns value when valid positive number", () => {
      expect(safePositiveNumber(50, 100)).toBe(50);
      expect(safePositiveNumber(0, 100)).toBe(0);
      expect(safePositiveNumber(0.5, 100)).toBe(0.5);
    });

    it("returns default for undefined", () => {
      expect(safePositiveNumber(undefined, 100)).toBe(100);
    });

    it("returns default for negative numbers", () => {
      expect(safePositiveNumber(-1, 100)).toBe(100);
      expect(safePositiveNumber(-100, 50)).toBe(50);
    });

    it("returns default for NaN", () => {
      expect(safePositiveNumber(NaN, 100)).toBe(100);
    });

    it("returns default for Infinity", () => {
      expect(safePositiveNumber(Infinity, 100)).toBe(100);
      expect(safePositiveNumber(-Infinity, 100)).toBe(100);
    });
  });

  describe("safeNumber", () => {
    it("returns value when valid finite number", () => {
      expect(safeNumber(50, 100)).toBe(50);
      expect(safeNumber(-50, 100)).toBe(-50);
      expect(safeNumber(0, 100)).toBe(0);
    });

    it("returns default for undefined", () => {
      expect(safeNumber(undefined, 100)).toBe(100);
    });

    it("returns default for NaN", () => {
      expect(safeNumber(NaN, 100)).toBe(100);
    });

    it("returns default for Infinity", () => {
      expect(safeNumber(Infinity, 100)).toBe(100);
      expect(safeNumber(-Infinity, 100)).toBe(100);
    });
  });

  describe("safePosition", () => {
    it("returns position when valid", () => {
      const pos = { x: 100, y: 200 };
      expect(safePosition(pos)).toEqual(pos);
    });

    it("returns undefined for undefined input", () => {
      expect(safePosition(undefined)).toBeUndefined();
    });

    it("returns undefined when x is NaN", () => {
      expect(safePosition({ x: NaN, y: 100 })).toBeUndefined();
    });

    it("returns undefined when y is NaN", () => {
      expect(safePosition({ x: 100, y: NaN })).toBeUndefined();
    });

    it("returns undefined when x is Infinity", () => {
      expect(safePosition({ x: Infinity, y: 100 })).toBeUndefined();
    });

    it("returns undefined when y is Infinity", () => {
      expect(safePosition({ x: 100, y: -Infinity })).toBeUndefined();
    });
  });

  describe("Layout with invalid inputs", () => {
    it("grid layout handles invalid spacing gracefully", () => {
      const graph = {
        nodes: [{ id: "a", width: 100, height: 50 }],
        edges: [],
      };
      const result = gridLayout(graph, {
        algorithm: "grid",
        spacing: { nodeSpacing: NaN },
        padding: Infinity,
      });
      expect(result.success).toBe(true);
      // Should use default values instead of invalid ones
      expect(Number.isFinite(result.positions["a"]?.x)).toBe(true);
      expect(Number.isFinite(result.positions["a"]?.y)).toBe(true);
    });

    it("circular layout handles invalid padding gracefully", () => {
      const graph = {
        nodes: [
          { id: "a", width: 100, height: 50 },
          { id: "b", width: 100, height: 50 },
        ],
        edges: [],
      };
      const result = circularLayout(graph, {
        algorithm: "circular",
        padding: -100, // Invalid negative padding
      });
      expect(result.success).toBe(true);
      expect(Number.isFinite(result.positions["a"]?.x)).toBe(true);
      expect(Number.isFinite(result.positions["b"]?.y)).toBe(true);
    });
  });
});
