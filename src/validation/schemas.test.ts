/**
 * Validation Schema Tests
 */

import { describe, it, expect } from "bun:test";
import {
  DiagramNodeSchema,
  DiagramEdgeSchema,
  DiagramGroupSchema,
  DiagramSpecSchema,
  CreateDiagramRequestSchema,
  UpdateDiagramRequestSchema,
  ForkDiagramRequestSchema,
  UpdateThumbnailRequestSchema,
  ApplyLayoutRequestSchema,
  SequenceMessageSchema,
  ERRelationshipSchema,
  ColorSchema,
  PositionSchema,
  NodeShapeSchema,
  DiagramTypeSchema,
  validateRequest,
  ValidationError,
  safeParseSpec,
  parseSpecStrict,
  LIMITS,
} from "./schemas";

describe("ColorSchema", () => {
  it("accepts valid hex colors", () => {
    expect(ColorSchema.safeParse("#fff").success).toBe(true);
    expect(ColorSchema.safeParse("#ffffff").success).toBe(true);
    expect(ColorSchema.safeParse("#FFFFFF").success).toBe(true);
    expect(ColorSchema.safeParse("#ffffffaa").success).toBe(true);
  });

  it("accepts CSS color names", () => {
    expect(ColorSchema.safeParse("red").success).toBe(true);
    expect(ColorSchema.safeParse("blue").success).toBe(true);
    expect(ColorSchema.safeParse("transparent").success).toBe(true);
  });

  it("rejects invalid colors", () => {
    expect(ColorSchema.safeParse("not-a-color-123").success).toBe(false);
    expect(ColorSchema.safeParse("#gg0000").success).toBe(false);
    expect(ColorSchema.safeParse("123").success).toBe(false);
  });
});

describe("PositionSchema", () => {
  it("accepts valid positions", () => {
    expect(PositionSchema.safeParse({ x: 0, y: 0 }).success).toBe(true);
    expect(PositionSchema.safeParse({ x: 100, y: 200 }).success).toBe(true);
    expect(PositionSchema.safeParse({ x: -500, y: 500 }).success).toBe(true);
  });

  it("rejects out-of-bounds positions", () => {
    expect(PositionSchema.safeParse({ x: 999999, y: 0 }).success).toBe(false);
    expect(PositionSchema.safeParse({ x: 0, y: -999999 }).success).toBe(false);
  });

  it("rejects missing coordinates", () => {
    expect(PositionSchema.safeParse({ x: 100 }).success).toBe(false);
    expect(PositionSchema.safeParse({ y: 100 }).success).toBe(false);
  });
});

describe("NodeShapeSchema", () => {
  it("accepts all valid shapes", () => {
    const validShapes = [
      "box", "diamond", "circle", "database", "cloud", "cylinder",
      "actor", "lifeline", "activation",
      "entity", "attribute", "relationship", "weak-entity",
      "state", "initial", "final", "choice", "fork", "join",
      "class", "interface", "abstract", "enum",
      "central", "branch", "topic",
      "server", "router", "switch", "firewall", "client", "internet",
    ];

    for (const shape of validShapes) {
      expect(NodeShapeSchema.safeParse(shape).success).toBe(true);
    }
  });

  it("rejects invalid shapes", () => {
    expect(NodeShapeSchema.safeParse("invalid").success).toBe(false);
    expect(NodeShapeSchema.safeParse("rectangle").success).toBe(false);
  });
});

describe("DiagramTypeSchema", () => {
  it("accepts all valid types", () => {
    const validTypes = [
      "flowchart", "architecture", "sequence", "er",
      "state", "class", "mindmap", "network", "freeform",
    ];

    for (const type of validTypes) {
      expect(DiagramTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects invalid types", () => {
    expect(DiagramTypeSchema.safeParse("invalid").success).toBe(false);
    expect(DiagramTypeSchema.safeParse("uml").success).toBe(false);
  });
});

describe("DiagramNodeSchema", () => {
  it("accepts valid node", () => {
    const result = DiagramNodeSchema.safeParse({
      id: "node-1",
      label: "Test Node",
    });
    expect(result.success).toBe(true);
  });

  it("accepts node with all optional fields", () => {
    const result = DiagramNodeSchema.safeParse({
      id: "node-1",
      label: "Test Node",
      type: "box",
      color: "#ff0000",
      position: { x: 100, y: 200 },
      details: "Some details",
      width: 150,
      height: 80,
      stereotype: "service",
      attributes: ["attr1", "attr2"],
      methods: ["method1()"],
      swimlane: "Lane 1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty id", () => {
    const result = DiagramNodeSchema.safeParse({
      id: "",
      label: "Test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects too long id", () => {
    const result = DiagramNodeSchema.safeParse({
      id: "a".repeat(LIMITS.ID_MAX + 1),
      label: "Test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid type", () => {
    const result = DiagramNodeSchema.safeParse({
      id: "node-1",
      label: "Test",
      type: "invalid-type",
    });
    expect(result.success).toBe(false);
  });
});

describe("DiagramEdgeSchema", () => {
  it("accepts valid edge", () => {
    const result = DiagramEdgeSchema.safeParse({
      from: "node-1",
      to: "node-2",
    });
    expect(result.success).toBe(true);
  });

  it("accepts edge with optional fields", () => {
    const result = DiagramEdgeSchema.safeParse({
      id: "edge-1",
      from: "node-1",
      to: "node-2",
      label: "connects to",
      style: "dashed",
      color: "#3b82f6",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty from", () => {
    const result = DiagramEdgeSchema.safeParse({
      from: "",
      to: "node-2",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid style", () => {
    const result = DiagramEdgeSchema.safeParse({
      from: "node-1",
      to: "node-2",
      style: "thick",
    });
    expect(result.success).toBe(false);
  });
});

describe("DiagramGroupSchema", () => {
  it("accepts valid group", () => {
    const result = DiagramGroupSchema.safeParse({
      id: "group-1",
      label: "Group 1",
      nodeIds: ["node-1", "node-2"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts group with color", () => {
    const result = DiagramGroupSchema.safeParse({
      id: "group-1",
      label: "Group 1",
      nodeIds: [],
      color: "#10b981",
    });
    expect(result.success).toBe(true);
  });

  it("rejects too many nodeIds", () => {
    const result = DiagramGroupSchema.safeParse({
      id: "group-1",
      label: "Group 1",
      nodeIds: Array(LIMITS.MAX_NODE_IDS_IN_GROUP + 1).fill("node-1"),
    });
    expect(result.success).toBe(false);
  });
});

describe("SequenceMessageSchema", () => {
  it("accepts valid message", () => {
    const result = SequenceMessageSchema.safeParse({
      from: "user",
      to: "api",
      label: "Request",
      type: "sync",
      order: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts all message types", () => {
    const types = ["sync", "async", "return", "create", "destroy"];
    for (const type of types) {
      const result = SequenceMessageSchema.safeParse({
        from: "a",
        to: "b",
        label: "msg",
        type,
        order: 1,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects negative order", () => {
    const result = SequenceMessageSchema.safeParse({
      from: "a",
      to: "b",
      label: "msg",
      type: "sync",
      order: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("ERRelationshipSchema", () => {
  it("accepts valid relationship", () => {
    const result = ERRelationshipSchema.safeParse({
      entity1: "user",
      entity2: "post",
      cardinality: "1:N",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all cardinality types", () => {
    const cardinalities = ["1:1", "1:N", "N:1", "N:M"];
    for (const card of cardinalities) {
      const result = ERRelationshipSchema.safeParse({
        entity1: "a",
        entity2: "b",
        cardinality: card,
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts with participation", () => {
    const result = ERRelationshipSchema.safeParse({
      entity1: "user",
      entity2: "post",
      cardinality: "1:N",
      participation1: "total",
      participation2: "partial",
    });
    expect(result.success).toBe(true);
  });
});

describe("DiagramSpecSchema", () => {
  it("accepts valid minimal spec", () => {
    const result = DiagramSpecSchema.safeParse({
      type: "flowchart",
      nodes: [{ id: "a", label: "A" }],
      edges: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts spec with edges referencing existing nodes", () => {
    const result = DiagramSpecSchema.safeParse({
      type: "flowchart",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects edges referencing non-existent nodes", () => {
    const result = DiagramSpecSchema.safeParse({
      type: "flowchart",
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "nonexistent" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Edges must reference existing node IDs");
    }
  });

  it("rejects groups referencing non-existent nodes", () => {
    const result = DiagramSpecSchema.safeParse({
      type: "flowchart",
      nodes: [{ id: "a", label: "A" }],
      edges: [],
      groups: [{ id: "g1", label: "Group", nodeIds: ["nonexistent"] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects sequence messages referencing non-existent nodes", () => {
    const result = DiagramSpecSchema.safeParse({
      type: "sequence",
      nodes: [{ id: "a", label: "A" }],
      edges: [],
      messages: [{ from: "a", to: "nonexistent", label: "msg", type: "sync", order: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects ER relationships referencing non-existent nodes", () => {
    const result = DiagramSpecSchema.safeParse({
      type: "er",
      nodes: [{ id: "user", label: "User" }],
      edges: [],
      relationships: [{ entity1: "user", entity2: "nonexistent", cardinality: "1:N" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects too many nodes", () => {
    const result = DiagramSpecSchema.safeParse({
      type: "flowchart",
      nodes: Array(LIMITS.MAX_NODES + 1).fill(null).map((_, i) => ({ id: `n${i}`, label: `Node ${i}` })),
      edges: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateDiagramRequestSchema", () => {
  it("accepts valid request", () => {
    const result = CreateDiagramRequestSchema.safeParse({
      name: "My Diagram",
      project: "my-project",
      spec: {
        type: "flowchart",
        nodes: [{ id: "a", label: "A" }],
        edges: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it("trims name and project", () => {
    const result = CreateDiagramRequestSchema.safeParse({
      name: "  My Diagram  ",
      project: "  my-project  ",
      spec: {
        type: "flowchart",
        nodes: [{ id: "a", label: "A" }],
        edges: [],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("My Diagram");
      expect(result.data.project).toBe("my-project");
    }
  });

  it("rejects empty name", () => {
    const result = CreateDiagramRequestSchema.safeParse({
      name: "",
      spec: {
        type: "flowchart",
        nodes: [{ id: "a", label: "A" }],
        edges: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing spec", () => {
    const result = CreateDiagramRequestSchema.safeParse({
      name: "Test",
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateDiagramRequestSchema", () => {
  it("accepts valid request", () => {
    const result = UpdateDiagramRequestSchema.safeParse({
      spec: {
        type: "flowchart",
        nodes: [{ id: "a", label: "A" }],
        edges: [],
      },
      message: "Updated nodes",
    });
    expect(result.success).toBe(true);
  });

  it("accepts without message", () => {
    const result = UpdateDiagramRequestSchema.safeParse({
      spec: {
        type: "flowchart",
        nodes: [{ id: "a", label: "A" }],
        edges: [],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("ForkDiagramRequestSchema", () => {
  it("accepts empty object (all optional)", () => {
    const result = ForkDiagramRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts with name and project", () => {
    const result = ForkDiagramRequestSchema.safeParse({
      name: "Fork Name",
      project: "new-project",
    });
    expect(result.success).toBe(true);
  });
});

describe("UpdateThumbnailRequestSchema", () => {
  it("accepts valid data URL", () => {
    const result = UpdateThumbnailRequestSchema.safeParse({
      thumbnail: "data:image/png;base64,iVBORw0KGgo...",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-data-URL", () => {
    const result = UpdateThumbnailRequestSchema.safeParse({
      thumbnail: "https://example.com/image.png",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty thumbnail", () => {
    const result = UpdateThumbnailRequestSchema.safeParse({
      thumbnail: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects too large thumbnail", () => {
    const result = UpdateThumbnailRequestSchema.safeParse({
      thumbnail: "data:image/png;base64," + "A".repeat(LIMITS.THUMBNAIL_MAX_LENGTH),
    });
    expect(result.success).toBe(false);
  });
});

describe("ApplyLayoutRequestSchema", () => {
  it("accepts valid layout request", () => {
    const result = ApplyLayoutRequestSchema.safeParse({
      algorithm: "dagre",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all algorithms", () => {
    const algorithms = ["dagre", "elk-layered", "elk-force", "elk-radial", "grid", "circular"];
    for (const alg of algorithms) {
      const result = ApplyLayoutRequestSchema.safeParse({ algorithm: alg });
      expect(result.success).toBe(true);
    }
  });

  it("accepts with options", () => {
    const result = ApplyLayoutRequestSchema.safeParse({
      algorithm: "dagre",
      direction: "RIGHT",
      spacing: {
        nodeSpacing: 50,
        layerSpacing: 100,
      },
      padding: 20,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid algorithm", () => {
    const result = ApplyLayoutRequestSchema.safeParse({
      algorithm: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

describe("validateRequest helper", () => {
  it("returns success with data for valid input", () => {
    const result = validateRequest(DiagramNodeSchema, {
      id: "test",
      label: "Test",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("test");
    }
  });

  it("returns error with formatted message for invalid input", () => {
    const result = validateRequest(DiagramNodeSchema, {
      id: "",
      label: "Test",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("id");
      expect(result.details.length).toBeGreaterThan(0);
    }
  });
});

describe("ValidationError", () => {
  it("has correct properties", () => {
    const error = new ValidationError("Test error", []);

    expect(error.message).toBe("Test error");
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(400);
    expect(error.name).toBe("ValidationError");
  });
});

describe("safeParseSpec", () => {
  it("parses valid spec JSON", () => {
    const json = JSON.stringify({
      type: "flowchart",
      nodes: [{ id: "a", label: "A" }],
      edges: [],
    });

    const result = safeParseSpec(json);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.spec.type).toBe("flowchart");
      expect(result.spec.nodes).toHaveLength(1);
    }
  });

  it("returns valid=false for invalid spec but still returns data", () => {
    const json = JSON.stringify({
      type: "unknown-type", // Invalid type
      nodes: [],
      edges: [],
    });

    const result = safeParseSpec(json);

    expect(result.valid).toBe(false);
    // Still returns the parsed data for backwards compatibility
    expect(result.spec).toBeDefined();
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.raw).toBeDefined();
    }
  });

  it("handles JSON parse errors gracefully", () => {
    const badJson = "not valid json {{{";

    const result = safeParseSpec(badJson);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("JSON parse error");
      // Returns fallback freeform spec
      expect(result.spec.type).toBe("freeform");
      expect(result.spec.nodes).toEqual([]);
      expect(result.spec.edges).toEqual([]);
    }
  });

  it("validates edge references", () => {
    const json = JSON.stringify({
      type: "flowchart",
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "nonexistent" }], // Invalid reference
    });

    const result = safeParseSpec(json);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("Edges must reference existing node IDs"))).toBe(true);
    }
  });

  it("logs warning with context when provided", () => {
    // This test verifies behavior - in practice, console.warn would be called
    const json = JSON.stringify({
      type: "invalid-type",
      nodes: [],
      edges: [],
    });

    // Should not throw even with invalid data
    const result = safeParseSpec(json, "diagram:test-123");
    expect(result.valid).toBe(false);
  });
});

describe("parseSpecStrict", () => {
  it("returns spec for valid JSON", () => {
    const json = JSON.stringify({
      type: "flowchart",
      nodes: [{ id: "a", label: "A" }],
      edges: [],
    });

    const spec = parseSpecStrict(json);

    expect(spec.type).toBe("flowchart");
    expect(spec.nodes).toHaveLength(1);
  });

  it("throws for invalid spec", () => {
    const json = JSON.stringify({
      type: "invalid",
      nodes: [],
      edges: [],
    });

    expect(() => parseSpecStrict(json)).toThrow("Invalid diagram spec");
  });

  it("throws for invalid JSON", () => {
    const badJson = "not valid json";

    expect(() => parseSpecStrict(badJson)).toThrow("Invalid diagram spec");
  });

  it("includes context in error message", () => {
    const badJson = "{}";

    expect(() => parseSpecStrict(badJson, "test-context")).toThrow("(test-context)");
  });
});
