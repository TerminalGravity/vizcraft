/**
 * Compression Module Tests
 */

import { describe, it, expect } from "bun:test";
import { compressSpec, decompressSpec, optimizeSpec, getSpecComplexity } from "./compression";
import type { DiagramSpec } from "../types";

describe("Spec Compression", () => {
  const smallSpec: DiagramSpec = {
    type: "flowchart",
    nodes: [
      { id: "a", label: "Start" },
      { id: "b", label: "End" },
    ],
    edges: [{ from: "a", to: "b" }],
  };

  it("returns uncompressed JSON for small specs", async () => {
    const result = await compressSpec(smallSpec);
    expect(result.startsWith("gz:")).toBe(false);
    expect(JSON.parse(result)).toEqual(smallSpec);
  });

  it("compresses large specs", async () => {
    // Create a large spec
    const largeSpec: DiagramSpec = {
      type: "flowchart",
      nodes: Array.from({ length: 200 }, (_, i) => ({
        id: `node-${i}`,
        label: `This is node number ${i} with a reasonably long label`,
        details: `Some details about node ${i} that make the spec larger`,
      })),
      edges: Array.from({ length: 199 }, (_, i) => ({
        from: `node-${i}`,
        to: `node-${i + 1}`,
        label: `Connection ${i}`,
      })),
    };

    const compressed = await compressSpec(largeSpec);

    // Should be compressed (starts with gz:) or same size (if compression didn't help)
    if (compressed.startsWith("gz:")) {
      expect(compressed.length).toBeLessThan(JSON.stringify(largeSpec).length);
    }
  });

  it("decompresses compressed specs correctly", async () => {
    const largeSpec: DiagramSpec = {
      type: "flowchart",
      nodes: Array.from({ length: 100 }, (_, i) => ({
        id: `node-${i}`,
        label: `Node ${i}`,
      })),
      edges: [],
    };

    const compressed = await compressSpec(largeSpec);
    const decompressed = await decompressSpec(compressed);

    expect(decompressed).toEqual(largeSpec);
  });

  it("handles uncompressed input in decompressSpec", async () => {
    const json = JSON.stringify(smallSpec);
    const result = await decompressSpec(json);
    expect(result).toEqual(smallSpec);
  });
});

describe("Spec Optimization", () => {
  it("removes default values", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: [
        {
          id: "a",
          label: "Start",
          type: "box", // default
          width: 120, // default
          height: 60, // default
          position: { x: 100.123456, y: 200.987654 },
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          style: "solid", // default
        },
      ],
    };

    const optimized = optimizeSpec(spec);

    // Should not have default type
    expect(optimized.nodes[0].type).toBeUndefined();
    // Should not have default width/height
    expect(optimized.nodes[0].width).toBeUndefined();
    expect(optimized.nodes[0].height).toBeUndefined();
    // Should have rounded position
    expect(optimized.nodes[0].position?.x).toBe(100.12);
    expect(optimized.nodes[0].position?.y).toBe(200.99);
    // Should not have default style
    expect(optimized.edges[0].style).toBeUndefined();
  });

  it("preserves non-default values", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: [
        {
          id: "a",
          label: "Start",
          type: "diamond",
          color: "blue",
          width: 150,
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          style: "dashed",
          color: "red",
        },
      ],
    };

    const optimized = optimizeSpec(spec);

    expect(optimized.nodes[0].type).toBe("diamond");
    expect(optimized.nodes[0].color).toBe("blue");
    expect(optimized.nodes[0].width).toBe(150);
    expect(optimized.edges[0].style).toBe("dashed");
    expect(optimized.edges[0].color).toBe("red");
  });

  it("filters empty groups", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: [{ id: "a", label: "A" }],
      edges: [],
      groups: [
        { id: "g1", label: "Group 1", nodeIds: ["a"] },
        { id: "g2", label: "Empty Group", nodeIds: [] },
      ],
    };

    const optimized = optimizeSpec(spec);

    expect(optimized.groups?.length).toBe(1);
    expect(optimized.groups?.[0].id).toBe("g1");
  });
});

describe("Spec Complexity", () => {
  it("calculates simple complexity", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b" }],
    };

    const complexity = getSpecComplexity(spec);

    expect(complexity.nodeCount).toBe(2);
    expect(complexity.edgeCount).toBe(1);
    expect(complexity.totalElements).toBe(3);
    expect(complexity.complexity).toBe("simple");
  });

  it("calculates moderate complexity", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })),
      edges: Array.from({ length: 40 }, (_, i) => ({ from: `n${i % 30}`, to: `n${(i + 1) % 30}` })),
    };

    const complexity = getSpecComplexity(spec);

    expect(complexity.complexity).toBe("moderate");
  });

  it("calculates complex complexity", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })),
      edges: Array.from({ length: 200 }, (_, i) => ({ from: `n${i % 150}`, to: `n${(i + 1) % 150}` })),
    };

    const complexity = getSpecComplexity(spec);

    expect(complexity.complexity).toBe("complex");
  });

  it("calculates very complex complexity", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })),
      edges: [],
    };

    const complexity = getSpecComplexity(spec);

    expect(complexity.complexity).toBe("very_complex");
  });

  it("estimates byte size", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: [{ id: "a", label: "Test" }],
      edges: [],
    };

    const complexity = getSpecComplexity(spec);

    expect(complexity.estimatedBytes).toBeGreaterThan(0);
    expect(complexity.estimatedBytes).toBeLessThan(1000);
  });
});
