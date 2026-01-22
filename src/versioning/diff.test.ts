/**
 * Versioning Diff Tests
 */

import { describe, it, expect } from "bun:test";
import { diffSpecs, generateChangelog } from "./diff";
import type { DiagramSpec } from "../types";

describe("Diagram Diff", () => {
  const baseSpec: DiagramSpec = {
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
    groups: [{ id: "g1", label: "Main Flow", nodeIds: ["a", "b", "c"] }],
  };

  it("detects no changes when specs are identical", () => {
    const diff = diffSpecs(baseSpec, { ...baseSpec });
    expect(diff.hasChanges).toBe(false);
    expect(diff.summary).toBe("No changes");
  });

  it("detects added nodes", () => {
    const newSpec: DiagramSpec = {
      ...baseSpec,
      nodes: [...baseSpec.nodes, { id: "d", label: "New Node" }],
    };
    const diff = diffSpecs(baseSpec, newSpec);

    expect(diff.hasChanges).toBe(true);
    expect(diff.stats.nodesAdded).toBe(1);
    expect(diff.nodeChanges[0].type).toBe("added");
    expect(diff.nodeChanges[0].nodeId).toBe("d");
  });

  it("detects removed nodes", () => {
    const newSpec: DiagramSpec = {
      ...baseSpec,
      nodes: baseSpec.nodes.slice(0, 2), // Remove "c"
    };
    const diff = diffSpecs(baseSpec, newSpec);

    expect(diff.hasChanges).toBe(true);
    expect(diff.stats.nodesRemoved).toBe(1);
    expect(diff.nodeChanges.some((c) => c.type === "removed" && c.nodeId === "c")).toBe(true);
  });

  it("detects modified nodes", () => {
    const newSpec: DiagramSpec = {
      ...baseSpec,
      nodes: baseSpec.nodes.map((n) =>
        n.id === "b" ? { ...n, label: "Updated Process", color: "blue" } : n
      ),
    };
    const diff = diffSpecs(baseSpec, newSpec);

    expect(diff.hasChanges).toBe(true);
    expect(diff.stats.nodesModified).toBe(1);
    const modifiedChange = diff.nodeChanges.find((c) => c.type === "modified");
    expect(modifiedChange?.nodeId).toBe("b");
    expect(modifiedChange?.changes).toContain('label: "Process" → "Updated Process"');
  });

  it("detects added edges", () => {
    const newSpec: DiagramSpec = {
      ...baseSpec,
      edges: [...baseSpec.edges, { from: "a", to: "c" }],
    };
    const diff = diffSpecs(baseSpec, newSpec);

    expect(diff.hasChanges).toBe(true);
    expect(diff.stats.edgesAdded).toBe(1);
    expect(diff.edgeChanges[0].type).toBe("added");
    expect(diff.edgeChanges[0].edgeKey).toBe("a->c");
  });

  it("detects removed edges", () => {
    const newSpec: DiagramSpec = {
      ...baseSpec,
      edges: baseSpec.edges.slice(0, 1), // Remove b->c
    };
    const diff = diffSpecs(baseSpec, newSpec);

    expect(diff.hasChanges).toBe(true);
    expect(diff.stats.edgesRemoved).toBe(1);
    expect(diff.edgeChanges.some((c) => c.type === "removed" && c.edgeKey === "b->c")).toBe(true);
  });

  it("detects modified edges", () => {
    const newSpec: DiagramSpec = {
      ...baseSpec,
      edges: baseSpec.edges.map((e) =>
        e.from === "a" && e.to === "b" ? { ...e, label: "Step 1", style: "dashed" as const } : e
      ),
    };
    const diff = diffSpecs(baseSpec, newSpec);

    expect(diff.hasChanges).toBe(true);
    expect(diff.stats.edgesModified).toBe(1);
  });

  it("detects spec-level changes", () => {
    const newSpec: DiagramSpec = {
      ...baseSpec,
      type: "architecture",
      theme: "light",
    };
    const diff = diffSpecs(baseSpec, newSpec);

    expect(diff.hasChanges).toBe(true);
    expect(diff.specChanges).toHaveLength(2);
    expect(diff.specChanges.some((c) => c.field === "type")).toBe(true);
    expect(diff.specChanges.some((c) => c.field === "theme")).toBe(true);
  });

  it("detects group changes", () => {
    const newSpec: DiagramSpec = {
      ...baseSpec,
      groups: [
        { id: "g1", label: "Main Flow", nodeIds: ["a", "b"] }, // Modified
        { id: "g2", label: "New Group", nodeIds: ["c"] }, // Added
      ],
    };
    const diff = diffSpecs(baseSpec, newSpec);

    expect(diff.hasChanges).toBe(true);
    expect(diff.stats.groupsModified).toBe(1);
    expect(diff.stats.groupsAdded).toBe(1);
  });

  it("generates correct summary", () => {
    const newSpec: DiagramSpec = {
      ...baseSpec,
      nodes: [...baseSpec.nodes, { id: "d", label: "New" }],
      edges: baseSpec.edges.slice(0, 1),
    };
    const diff = diffSpecs(baseSpec, newSpec);

    expect(diff.summary).toContain("+1 node(s)");
    expect(diff.summary).toContain("-1 edge(s)");
  });
});

describe("Changelog Generation", () => {
  it("generates human-readable changelog", () => {
    const before: DiagramSpec = {
      type: "flowchart",
      nodes: [{ id: "a", label: "Start" }],
      edges: [],
    };
    const after: DiagramSpec = {
      type: "architecture",
      nodes: [
        { id: "a", label: "Begin" },
        { id: "b", label: "End" },
      ],
      edges: [{ from: "a", to: "b" }],
    };

    const diff = diffSpecs(before, after);
    const changelog = generateChangelog(diff);

    expect(changelog).toContain('Changed type from "flowchart" to "architecture"');
    expect(changelog).toContain('Modified node "Start"');
    expect(changelog).toContain('Added node "End"');
    expect(changelog).toContain("Added connection a->b");
  });

  it("returns 'No changes' for identical specs", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: [{ id: "a", label: "Start" }],
      edges: [],
    };
    const diff = diffSpecs(spec, spec);
    const changelog = generateChangelog(diff);

    expect(changelog).toBe("No changes");
  });
});
