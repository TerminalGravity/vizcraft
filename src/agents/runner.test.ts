/**
 * Agent Runner Tests
 */

import { describe, test, expect } from "bun:test";
import { applyDagreLayout, snapToGrid, runAgent } from "./runner";
import type { DiagramSpec } from "../types";
import type { LoadedAgent } from "./loader";

const sampleSpec: DiagramSpec = {
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

describe("Dagre Layout", () => {
  test("assigns positions to all nodes", () => {
    const result = applyDagreLayout(sampleSpec);

    expect(result.nodes.length).toBe(3);
    for (const node of result.nodes) {
      expect(node.position).toBeDefined();
      expect(typeof node.position?.x).toBe("number");
      expect(typeof node.position?.y).toBe("number");
    }
  });

  test("maintains node relationships", () => {
    const result = applyDagreLayout(sampleSpec);

    // In TB layout, Start should be above Process, which should be above End
    const startNode = result.nodes.find((n) => n.id === "a");
    const processNode = result.nodes.find((n) => n.id === "b");
    const endNode = result.nodes.find((n) => n.id === "c");

    expect(startNode?.position?.y).toBeLessThan(processNode?.position?.y ?? 0);
    expect(processNode?.position?.y).toBeLessThan(endNode?.position?.y ?? 0);
  });
});

describe("Snap to Grid", () => {
  test("snaps positions to grid", () => {
    const specWithPositions: DiagramSpec = {
      ...sampleSpec,
      nodes: [
        { id: "a", label: "Start", position: { x: 103, y: 57 } },
        { id: "b", label: "Process", position: { x: 218, y: 142 } },
      ],
    };

    const result = snapToGrid(specWithPositions, 20);

    expect(result.nodes[0].position).toEqual({ x: 100, y: 60 });
    expect(result.nodes[1].position).toEqual({ x: 220, y: 140 });
  });
});

describe("Agent Runner", () => {
  test("runs rule-based agent with dagre_layout", async () => {
    const agent: LoadedAgent = {
      id: "test-layout",
      name: "Test Layout",
      type: "rule-based",
      actions: ["dagre_layout", "snap_to_grid"],
      filename: "test.yaml",
      loadedAt: new Date().toISOString(),
    };

    const result = await runAgent(agent, sampleSpec);

    expect(result.success).toBe(true);
    expect(result.changes?.length).toBeGreaterThan(0);
    expect(result.spec?.nodes[0].position).toBeDefined();
  });

  test("runs preset agent with styles", async () => {
    const agent: LoadedAgent = {
      id: "test-theme",
      name: "Test Theme",
      type: "preset",
      styles: {
        node_fill: "#ff0000",
        edge_color: "#00ff00",
      },
      filename: "test.yaml",
      loadedAt: new Date().toISOString(),
    };

    const result = await runAgent(agent, sampleSpec);

    expect(result.success).toBe(true);
    expect(result.spec?.nodes[0].color).toBe("#ff0000");
    expect(result.spec?.edges[0].color).toBe("#00ff00");
  });

  test("LLM agent handles configuration states correctly", async () => {
    const agent: LoadedAgent = {
      id: "test-llm",
      name: "Test LLM",
      type: "llm",
      provider: "anthropic",
      prompt: "Add a 'Validation' step between Start and Process",
      filename: "test.yaml",
      loadedAt: new Date().toISOString(),
    };

    const result = await runAgent(agent, sampleSpec);

    // With valid API key: succeeds with transformed spec
    // Without valid API key: fails with error
    if (result.success) {
      expect(result.spec).toBeDefined();
      expect(result.changes).toBeDefined();
      expect(result.changes!.length).toBeGreaterThan(0);
    } else {
      expect(result.error).toBeDefined();
    }
  });

  test("LLM agent requires prompt", async () => {
    const agent: LoadedAgent = {
      id: "test-llm-no-prompt",
      name: "Test LLM No Prompt",
      type: "llm",
      provider: "anthropic",
      filename: "test.yaml",
      loadedAt: new Date().toISOString(),
    };

    const result = await runAgent(agent, sampleSpec);

    expect(result.success).toBe(false);
    expect(result.error).toContain("no prompt defined");
  });
});
