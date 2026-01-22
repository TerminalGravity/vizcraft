/**
 * Templates Module Tests
 */

import { describe, it, expect } from "bun:test";
import {
  DIAGRAM_TYPES,
  listDiagramTypes,
  getDiagramTypeInfo,
  getDiagramTemplate,
} from "./diagram-types";
import { exportToMermaid, getSupportedExportFormats } from "./mermaid-export";
import type { DiagramSpec, DiagramType } from "../types";

describe("Diagram Types", () => {
  it("lists all diagram types", () => {
    const types = listDiagramTypes();
    expect(types.length).toBeGreaterThan(0);

    const expectedTypes = ["flowchart", "architecture", "sequence", "er", "state", "class", "mindmap", "network", "freeform"];
    for (const type of expectedTypes) {
      expect(types.some((t) => t.id === type)).toBe(true);
    }
  });

  it("has valid metadata for each type", () => {
    for (const [typeId, info] of Object.entries(DIAGRAM_TYPES)) {
      expect(info.id).toBe(typeId);
      expect(info.name).toBeTruthy();
      expect(info.description).toBeTruthy();
      expect(info.icon).toBeTruthy();
      expect(info.nodeShapes.length).toBeGreaterThan(0);
      expect(info.edgeStyles.length).toBeGreaterThan(0);
      expect(info.features.length).toBeGreaterThan(0);
    }
  });

  it("gets type info correctly", () => {
    const flowchartInfo = getDiagramTypeInfo("flowchart");
    expect(flowchartInfo.id).toBe("flowchart");
    expect(flowchartInfo.name).toBe("Flowchart");
    expect(flowchartInfo.nodeShapes).toContain("diamond");
  });

  it("falls back to freeform for unknown types", () => {
    const unknownInfo = getDiagramTypeInfo("unknown" as DiagramType);
    expect(unknownInfo.id).toBe("freeform");
  });
});

describe("Diagram Templates", () => {
  const allTypes: DiagramType[] = [
    "flowchart", "architecture", "sequence", "er",
    "state", "class", "mindmap", "network", "freeform"
  ];

  for (const type of allTypes) {
    it(`has valid template for ${type}`, () => {
      const template = getDiagramTemplate(type);
      expect(template.type).toBe(type);
      expect(template.nodes.length).toBeGreaterThan(0);
      // All nodes should have id and label
      for (const node of template.nodes) {
        expect(node.id).toBeTruthy();
        expect(typeof node.label).toBe("string");
      }
    });
  }

  it("returns deep copy of template", () => {
    const template1 = getDiagramTemplate("flowchart");
    const template2 = getDiagramTemplate("flowchart");

    template1.nodes[0].label = "Modified";
    expect(template2.nodes[0].label).not.toBe("Modified");
  });
});

describe("Mermaid Export", () => {
  it("exports flowchart correctly", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: [
        { id: "a", label: "Start", type: "circle" },
        { id: "b", label: "Process", type: "box" },
        { id: "c", label: "Decision", type: "diamond" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c", label: "next" },
      ],
    };

    const mermaid = exportToMermaid(spec);

    expect(mermaid).toContain("flowchart TD");
    expect(mermaid).toContain("a((Start))");
    expect(mermaid).toContain("b[Process]");
    expect(mermaid).toContain("c{Decision}");
    expect(mermaid).toContain("a --> b");
    expect(mermaid).toContain("b -->|next| c");
  });

  it("exports sequence diagram correctly", () => {
    const spec: DiagramSpec = {
      type: "sequence",
      nodes: [
        { id: "user", label: "User", type: "actor" },
        { id: "api", label: "API", type: "lifeline" },
      ],
      edges: [],
      messages: [
        { from: "user", to: "api", label: "request", type: "sync", order: 1 },
        { from: "api", to: "user", label: "response", type: "return", order: 2 },
      ],
    };

    const mermaid = exportToMermaid(spec);

    expect(mermaid).toContain("sequenceDiagram");
    expect(mermaid).toContain("actor user");
    expect(mermaid).toContain("participant api");
    expect(mermaid).toContain("user->>api: request");
    expect(mermaid).toContain("api-->>user: response");
  });

  it("exports state diagram correctly", () => {
    const spec: DiagramSpec = {
      type: "state",
      nodes: [
        { id: "idle", label: "Idle", type: "state" },
        { id: "loading", label: "Loading", type: "state" },
        { id: "final", label: "", type: "final" },
      ],
      edges: [
        { from: "idle", to: "loading", label: "start" },
        { from: "loading", to: "final", label: "done" },
      ],
    };

    const mermaid = exportToMermaid(spec);

    expect(mermaid).toContain("stateDiagram-v2");
    expect(mermaid).toContain("idle: Idle");
    expect(mermaid).toContain("loading: Loading");
    expect(mermaid).toContain("idle --> loading: start");
    expect(mermaid).toContain("loading --> [*]: done");
  });

  it("exports ER diagram correctly", () => {
    const spec: DiagramSpec = {
      type: "er",
      nodes: [
        { id: "user", label: "User", type: "entity", attributes: ["id PK", "name", "email"] },
        { id: "post", label: "Post", type: "entity", attributes: ["id PK", "title"] },
      ],
      edges: [],
      relationships: [
        { entity1: "user", entity2: "post", label: "writes", cardinality: "1:N" },
      ],
    };

    const mermaid = exportToMermaid(spec);

    expect(mermaid).toContain("erDiagram");
    expect(mermaid).toContain("user {");
    expect(mermaid).toContain("user ||--o{ post : writes");
  });

  it("exports class diagram correctly", () => {
    const spec: DiagramSpec = {
      type: "class",
      nodes: [
        {
          id: "Animal",
          label: "Animal",
          type: "abstract",
          stereotype: "abstract",
          attributes: ["- name: string"],
          methods: ["+ eat(): void"],
        },
        { id: "Dog", label: "Dog", type: "class", methods: ["+ bark(): void"] },
      ],
      edges: [{ from: "Dog", to: "Animal", label: "extends", style: "dashed" }],
    };

    const mermaid = exportToMermaid(spec);

    expect(mermaid).toContain("classDiagram");
    expect(mermaid).toContain("class Animal {");
    expect(mermaid).toContain("<<abstract>>");
    expect(mermaid).toContain("- name: string");
    expect(mermaid).toContain("+ eat(): void");
    expect(mermaid).toContain("Dog ..|> Animal");
  });

  it("exports mindmap correctly", () => {
    const spec: DiagramSpec = {
      type: "mindmap",
      nodes: [
        { id: "root", label: "Main Topic", type: "central" },
        { id: "b1", label: "Branch 1", type: "branch" },
        { id: "t1", label: "Topic 1", type: "topic" },
      ],
      edges: [
        { from: "root", to: "b1" },
        { from: "b1", to: "t1" },
      ],
    };

    const mermaid = exportToMermaid(spec);

    expect(mermaid).toContain("mindmap");
    expect(mermaid).toContain("root((Main Topic))");
    expect(mermaid).toContain("Branch 1");
    expect(mermaid).toContain("Topic 1");
  });
});

describe("Export Formats", () => {
  it("lists supported formats", () => {
    const formats = getSupportedExportFormats();
    expect(formats.length).toBeGreaterThan(0);
    expect(formats.some((f) => f.id === "mermaid")).toBe(true);
    expect(formats.some((f) => f.id === "json")).toBe(true);

    for (const format of formats) {
      expect(format.extension).toMatch(/^\.\w+$/);
    }
  });
});
