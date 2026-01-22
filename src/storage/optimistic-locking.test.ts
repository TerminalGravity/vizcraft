/**
 * Optimistic Locking Tests for Storage Layer
 *
 * Tests the version-based conflict detection in storage.updateDiagram()
 */

import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { storage } from "./db";
import type { DiagramSpec } from "../types";

const testSpec: DiagramSpec = {
  type: "flowchart",
  nodes: [
    { id: "start", label: "Start", type: "circle" },
    { id: "end", label: "End", type: "circle" },
  ],
  edges: [{ from: "start", to: "end" }],
};

const updatedSpec: DiagramSpec = {
  type: "flowchart",
  nodes: [
    { id: "start", label: "Start", type: "circle" },
    { id: "process", label: "Process", type: "box" },
    { id: "end", label: "End", type: "circle" },
  ],
  edges: [
    { from: "start", to: "process" },
    { from: "process", to: "end" },
  ],
};

describe("Optimistic Locking - Storage Layer", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    // Cleanup all created diagrams
    for (const id of createdIds) {
      await storage.deleteDiagram(id);
    }
  });

  describe("Version tracking", () => {
    test("new diagram starts at version 1", () => {
      const diagram = storage.createDiagram("Version Test", "test-lock", testSpec);
      createdIds.push(diagram.id);

      expect(diagram.version).toBe(1);
    });

    test("update increments version", () => {
      const diagram = storage.createDiagram("Update Test", "test-lock", testSpec);
      createdIds.push(diagram.id);

      expect(diagram.version).toBe(1);

      const updated = storage.updateDiagram(diagram.id, updatedSpec, "First update");

      expect(updated).not.toBeNull();
      expect((updated as typeof diagram).version).toBe(2);

      // Update again
      const updated2 = storage.updateDiagram(diagram.id, testSpec, "Second update");
      expect((updated2 as typeof diagram).version).toBe(3);
    });
  });

  describe("Optimistic locking with baseVersion", () => {
    test("update succeeds when baseVersion matches current version", () => {
      const diagram = storage.createDiagram("Lock Match Test", "test-lock", testSpec);
      createdIds.push(diagram.id);

      // Update with correct baseVersion
      const result = storage.updateDiagram(diagram.id, updatedSpec, "Correct version", diagram.version);

      expect(result).not.toBeNull();
      expect(typeof result === "object" && "conflict" in result).toBe(false);
      expect((result as typeof diagram).version).toBe(2);
    });

    test("update fails with conflict when baseVersion is stale", () => {
      const diagram = storage.createDiagram("Lock Conflict Test", "test-lock", testSpec);
      createdIds.push(diagram.id);

      // First update - succeeds
      storage.updateDiagram(diagram.id, updatedSpec, "First update");

      // Now diagram is at version 2, try to update with version 1
      const result = storage.updateDiagram(diagram.id, testSpec, "Stale update", 1);

      // Should return conflict object
      expect(result).not.toBeNull();
      expect(typeof result === "object" && "conflict" in result).toBe(true);
      if (typeof result === "object" && "conflict" in result) {
        expect(result.conflict).toBe(true);
        expect(result.currentVersion).toBe(2);
      }
    });

    test("returns null when diagram doesn't exist (with baseVersion)", () => {
      const result = storage.updateDiagram("nonexistent-id", testSpec, "Message", 1);
      expect(result).toBeNull();
    });
  });

  describe("Backwards compatibility (no baseVersion)", () => {
    test("update without baseVersion always succeeds (no conflict check)", () => {
      const diagram = storage.createDiagram("No Lock Test", "test-lock", testSpec);
      createdIds.push(diagram.id);

      // Update without baseVersion - always works
      const result1 = storage.updateDiagram(diagram.id, updatedSpec, "Update 1");
      expect(result1).not.toBeNull();
      expect((result1 as typeof diagram).version).toBe(2);

      // Another update without baseVersion
      const result2 = storage.updateDiagram(diagram.id, testSpec, "Update 2");
      expect(result2).not.toBeNull();
      expect((result2 as typeof diagram).version).toBe(3);
    });
  });

  describe("Concurrent update simulation", () => {
    test("simulates two clients with stale versions", () => {
      // Create diagram
      const diagram = storage.createDiagram("Concurrent Test", "test-lock", testSpec);
      createdIds.push(diagram.id);

      // Client A reads version 1
      const clientAVersion = diagram.version; // 1

      // Client B reads version 1
      const clientBVersion = diagram.version; // 1

      // Client A updates with version 1 -> succeeds, now at version 2
      const updateA = storage.updateDiagram(
        diagram.id,
        { ...testSpec, nodes: [...testSpec.nodes, { id: "a", label: "A", type: "box" }] },
        "Client A update",
        clientAVersion
      );
      expect(updateA).not.toBeNull();
      expect(typeof updateA === "object" && "conflict" in updateA).toBe(false);

      // Client B tries to update with version 1 -> should conflict
      const updateB = storage.updateDiagram(
        diagram.id,
        { ...testSpec, nodes: [...testSpec.nodes, { id: "b", label: "B", type: "box" }] },
        "Client B update",
        clientBVersion
      );
      expect(updateB).not.toBeNull();
      expect(typeof updateB === "object" && "conflict" in updateB).toBe(true);

      if (typeof updateB === "object" && "conflict" in updateB) {
        expect(updateB.currentVersion).toBe(2);
      }

      // Client B retries with correct version -> succeeds
      const retryB = storage.updateDiagram(
        diagram.id,
        { ...testSpec, nodes: [...testSpec.nodes, { id: "b", label: "B", type: "box" }] },
        "Client B retry",
        2 // Correct version now
      );
      expect(retryB).not.toBeNull();
      expect(typeof retryB === "object" && "conflict" in retryB).toBe(false);
      expect((retryB as typeof diagram).version).toBe(3);
    });
  });

  describe("forceUpdateDiagram", () => {
    test("force update bypasses version check", () => {
      const diagram = storage.createDiagram("Force Update Test", "test-lock", testSpec);
      createdIds.push(diagram.id);

      // Update normally
      storage.updateDiagram(diagram.id, updatedSpec, "Normal update");
      // Now at version 2

      // Force update always works regardless of version
      const result = storage.forceUpdateDiagram(diagram.id, testSpec, "Force update");
      expect(result).not.toBeNull();
      expect((result as typeof diagram).version).toBe(3);
    });
  });

  describe("Version in diagram response", () => {
    test("getDiagram returns version field", () => {
      const created = storage.createDiagram("Get Version Test", "test-lock", testSpec);
      createdIds.push(created.id);

      const retrieved = storage.getDiagram(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.version).toBe(1);

      // Update and check version
      storage.updateDiagram(created.id, updatedSpec);
      const retrieved2 = storage.getDiagram(created.id);
      expect(retrieved2?.version).toBe(2);
    });
  });
});
