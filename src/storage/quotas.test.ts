/**
 * Quota Enforcement Tests
 *
 * Tests for diagram size quotas and resource limits
 */

import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import {
  QUOTAS,
  validateSpecQuotas,
  checkUserDiagramQuota,
  QuotaExceededError,
  formatBytes,
  getQuotaConfig,
} from "./quotas";
import { storage } from "./db";
import type { DiagramSpec } from "../types";

// ==================== Unit Tests ====================

describe("Quota Configuration", () => {
  test("QUOTAS has all expected fields", () => {
    expect(QUOTAS.MAX_NODES_PER_DIAGRAM).toBeGreaterThan(0);
    expect(QUOTAS.MAX_EDGES_PER_DIAGRAM).toBeGreaterThan(0);
    expect(QUOTAS.MAX_GROUPS_PER_DIAGRAM).toBeGreaterThan(0);
    expect(QUOTAS.MAX_SPEC_SIZE_BYTES).toBeGreaterThan(0);
    expect(QUOTAS.MAX_DIAGRAMS_PER_USER).toBeGreaterThan(0);
    expect(QUOTAS.MAX_MESSAGES_PER_DIAGRAM).toBeGreaterThan(0);
    expect(QUOTAS.MAX_RELATIONSHIPS_PER_DIAGRAM).toBeGreaterThan(0);
  });

  test("getQuotaConfig returns copy of config", () => {
    const config = getQuotaConfig();
    expect(config).toEqual(QUOTAS);
    expect(config).not.toBe(QUOTAS); // Should be a copy
  });
});

describe("formatBytes", () => {
  test("formats bytes correctly", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});

describe("validateSpecQuotas", () => {
  const validSpec: DiagramSpec = {
    type: "flowchart",
    nodes: [
      { id: "n1", label: "Node 1" },
      { id: "n2", label: "Node 2" },
    ],
    edges: [{ from: "n1", to: "n2" }],
  };

  test("accepts valid spec", () => {
    const result = validateSpecQuotas(validSpec);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.specSize).toBeGreaterThan(0);
    }
  });

  test("rejects spec with too many nodes", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: Array.from({ length: QUOTAS.MAX_NODES_PER_DIAGRAM + 1 }, (_, i) => ({
        id: `n${i}`,
        label: `Node ${i}`,
      })),
      edges: [],
    };

    const result = validateSpecQuotas(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe("QUOTA_NODES_EXCEEDED");
      expect(result.error.limit).toBe(QUOTAS.MAX_NODES_PER_DIAGRAM);
      expect(result.error.actual).toBe(QUOTAS.MAX_NODES_PER_DIAGRAM + 1);
    }
  });

  test("rejects spec with too many edges", () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      id: `n${i}`,
      label: `Node ${i}`,
    }));

    const spec: DiagramSpec = {
      type: "flowchart",
      nodes,
      edges: Array.from({ length: QUOTAS.MAX_EDGES_PER_DIAGRAM + 1 }, (_, i) => ({
        from: `n${i % 100}`,
        to: `n${(i + 1) % 100}`,
      })),
    };

    const result = validateSpecQuotas(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe("QUOTA_EDGES_EXCEEDED");
    }
  });

  test("rejects spec with too many groups", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: [{ id: "n1", label: "Node" }],
      edges: [],
      groups: Array.from({ length: QUOTAS.MAX_GROUPS_PER_DIAGRAM + 1 }, (_, i) => ({
        id: `g${i}`,
        label: `Group ${i}`,
        nodeIds: ["n1"],
      })),
    };

    const result = validateSpecQuotas(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe("QUOTA_GROUPS_EXCEEDED");
    }
  });

  test("rejects spec that exceeds size limit", () => {
    // Create a spec with very long details to exceed size limit
    const largeDetails = "x".repeat(QUOTAS.MAX_SPEC_SIZE_BYTES + 1000);
    const spec: DiagramSpec = {
      type: "flowchart",
      nodes: [{ id: "n1", label: "Node", details: largeDetails }],
      edges: [],
    };

    const result = validateSpecQuotas(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe("QUOTA_SPEC_SIZE_EXCEEDED");
    }
  });

  test("rejects spec with too many sequence messages", () => {
    const spec: DiagramSpec = {
      type: "sequence",
      nodes: [
        { id: "a", label: "Actor A" },
        { id: "b", label: "Actor B" },
      ],
      edges: [],
      messages: Array.from({ length: QUOTAS.MAX_MESSAGES_PER_DIAGRAM + 1 }, (_, i) => ({
        id: `m${i}`,
        from: "a",
        to: "b",
        label: `Message ${i}`,
        type: "sync" as const,
        order: i,
      })),
    };

    const result = validateSpecQuotas(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe("QUOTA_MESSAGES_EXCEEDED");
    }
  });

  test("rejects spec with too many ER relationships", () => {
    const spec: DiagramSpec = {
      type: "er",
      nodes: [
        { id: "e1", label: "Entity 1" },
        { id: "e2", label: "Entity 2" },
      ],
      edges: [],
      relationships: Array.from({ length: QUOTAS.MAX_RELATIONSHIPS_PER_DIAGRAM + 1 }, (_, i) => ({
        id: `r${i}`,
        entity1: "e1",
        entity2: "e2",
        cardinality: "1:N" as const,
      })),
    };

    const result = validateSpecQuotas(spec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe("QUOTA_RELATIONSHIPS_EXCEEDED");
    }
  });
});

describe("checkUserDiagramQuota", () => {
  test("allows anonymous users regardless of count", () => {
    const error = checkUserDiagramQuota(1000, null);
    expect(error).toBeNull();
  });

  test("allows users under quota", () => {
    const error = checkUserDiagramQuota(QUOTAS.MAX_DIAGRAMS_PER_USER - 1, "user-123");
    expect(error).toBeNull();
  });

  test("rejects users at quota", () => {
    const error = checkUserDiagramQuota(QUOTAS.MAX_DIAGRAMS_PER_USER, "user-123");
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error?.code).toBe("QUOTA_USER_DIAGRAMS_EXCEEDED");
  });

  test("rejects users over quota", () => {
    const error = checkUserDiagramQuota(QUOTAS.MAX_DIAGRAMS_PER_USER + 10, "user-123");
    expect(error).toBeInstanceOf(QuotaExceededError);
  });
});

describe("QuotaExceededError", () => {
  test("has correct properties", () => {
    const error = new QuotaExceededError(
      "Test message",
      "TEST_CODE",
      "test_resource",
      100,
      150
    );

    expect(error.name).toBe("QuotaExceededError");
    expect(error.message).toBe("Test message");
    expect(error.code).toBe("TEST_CODE");
    expect(error.resource).toBe("test_resource");
    expect(error.limit).toBe(100);
    expect(error.actual).toBe(150);
  });

  test("toResponse returns correct format", () => {
    const error = new QuotaExceededError(
      "Too many nodes",
      "QUOTA_NODES_EXCEEDED",
      "nodes",
      500,
      600
    );

    const response = error.toResponse();
    expect(response.error).toBe("Too many nodes");
    expect(response.code).toBe("QUOTA_NODES_EXCEEDED");
    expect(response.details.resource).toBe("nodes");
    expect(response.details.limit).toBe(500);
    expect(response.details.actual).toBe(600);
  });
});

// ==================== Integration Tests ====================

describe("Storage Quota Enforcement", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    // Cleanup
    for (const id of createdIds) {
      await storage.deleteDiagram(id);
    }
  });

  const validSpec: DiagramSpec = {
    type: "flowchart",
    nodes: [{ id: "n1", label: "Node 1" }],
    edges: [],
  };

  describe("createDiagram", () => {
    test("allows creating diagram with valid spec", () => {
      const diagram = storage.createDiagram("Test Diagram", "quota-test", validSpec);
      createdIds.push(diagram.id);

      expect(diagram.id).toBeDefined();
      expect(diagram.name).toBe("Test Diagram");
    });

    test("rejects diagram with too many nodes", () => {
      const spec: DiagramSpec = {
        type: "flowchart",
        nodes: Array.from({ length: QUOTAS.MAX_NODES_PER_DIAGRAM + 1 }, (_, i) => ({
          id: `n${i}`,
          label: `Node ${i}`,
        })),
        edges: [],
      };

      expect(() => {
        storage.createDiagram("Too Many Nodes", "quota-test", spec);
      }).toThrow(QuotaExceededError);
    });
  });

  describe("updateDiagram", () => {
    test("allows updating with valid spec", () => {
      const diagram = storage.createDiagram("Update Test", "quota-test", validSpec);
      createdIds.push(diagram.id);

      const updatedSpec: DiagramSpec = {
        type: "flowchart",
        nodes: [
          { id: "n1", label: "Updated Node 1" },
          { id: "n2", label: "Node 2" },
        ],
        edges: [{ from: "n1", to: "n2" }],
      };

      const updated = storage.updateDiagram(diagram.id, updatedSpec);
      expect(updated).not.toBeNull();
      if (updated && !("conflict" in updated)) {
        expect(updated.spec.nodes).toHaveLength(2);
      }
    });

    test("rejects update with too many edges", () => {
      const diagram = storage.createDiagram("Edge Test", "quota-test", validSpec);
      createdIds.push(diagram.id);

      const nodes = Array.from({ length: 100 }, (_, i) => ({
        id: `n${i}`,
        label: `Node ${i}`,
      }));

      const invalidSpec: DiagramSpec = {
        type: "flowchart",
        nodes,
        edges: Array.from({ length: QUOTAS.MAX_EDGES_PER_DIAGRAM + 1 }, (_, i) => ({
          from: `n${i % 100}`,
          to: `n${(i + 1) % 100}`,
        })),
      };

      expect(() => {
        storage.updateDiagram(diagram.id, invalidSpec);
      }).toThrow(QuotaExceededError);
    });
  });

  describe("transformDiagram", () => {
    test("allows transform with valid result", () => {
      const diagram = storage.createDiagram("Transform Test", "quota-test", validSpec);
      createdIds.push(diagram.id);

      const result = storage.transformDiagram(
        diagram.id,
        (spec) => ({
          ...spec,
          nodes: [...spec.nodes, { id: "n2", label: "New Node" }],
        }),
        "Added node"
      );

      expect(result).not.toBeNull();
      if (result && !("error" in result)) {
        expect(result.spec.nodes).toHaveLength(2);
      }
    });

    test("rejects transform that exceeds quota", () => {
      const diagram = storage.createDiagram("Transform Quota Test", "quota-test", validSpec);
      createdIds.push(diagram.id);

      expect(() => {
        storage.transformDiagram(
          diagram.id,
          (spec) => ({
            ...spec,
            nodes: Array.from({ length: QUOTAS.MAX_NODES_PER_DIAGRAM + 1 }, (_, i) => ({
              id: `n${i}`,
              label: `Node ${i}`,
            })),
          }),
          "Too many nodes"
        );
      }).toThrow(QuotaExceededError);
    });
  });

  describe("countUserDiagrams", () => {
    test("counts diagrams for a user", () => {
      const userId = `quota-user-${Date.now()}`;

      // Create a few diagrams for this user
      for (let i = 0; i < 3; i++) {
        const diagram = storage.createDiagram(
          `User Diagram ${i}`,
          "quota-test",
          validSpec,
          { ownerId: userId }
        );
        createdIds.push(diagram.id);
      }

      const count = storage.countUserDiagrams(userId);
      expect(count).toBe(3);
    });

    test("returns 0 for user with no diagrams", () => {
      const count = storage.countUserDiagrams("nonexistent-user");
      expect(count).toBe(0);
    });
  });
});
