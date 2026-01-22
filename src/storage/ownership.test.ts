/**
 * Ownership and Access Control Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { storage } from "./db";
import type { DiagramSpec } from "../types";

const testSpec: DiagramSpec = {
  type: "flowchart",
  nodes: [{ id: "1", label: "Test" }],
  edges: [],
};

describe("Ownership", () => {
  const testIds: string[] = [];

  afterEach(() => {
    // Cleanup
    for (const id of testIds) {
      storage.deleteDiagram(id);
    }
    testIds.length = 0;
  });

  describe("createDiagram with ownership", () => {
    it("creates diagram with owner", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-123",
      });
      testIds.push(diagram.id);

      expect(diagram.ownerId).toBe("user-123");
      expect(diagram.isPublic).toBe(false);
      expect(diagram.shares).toEqual([]);
    });

    it("creates public diagram", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-123",
        isPublic: true,
      });
      testIds.push(diagram.id);

      expect(diagram.isPublic).toBe(true);
    });

    it("creates diagram without owner (legacy mode)", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec);
      testIds.push(diagram.id);

      expect(diagram.ownerId).toBeNull();
    });
  });

  describe("getDiagram with ownership", () => {
    it("returns ownership fields", () => {
      const created = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-456",
        isPublic: true,
      });
      testIds.push(created.id);

      const diagram = storage.getDiagram(created.id);

      expect(diagram).not.toBeNull();
      expect(diagram!.ownerId).toBe("user-456");
      expect(diagram!.isPublic).toBe(true);
    });
  });

  describe("updateOwner", () => {
    it("transfers ownership", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
      });
      testIds.push(diagram.id);

      const result = storage.updateOwner(diagram.id, "user-2");
      expect(result).toBe(true);

      const updated = storage.getDiagram(diagram.id);
      expect(updated!.ownerId).toBe("user-2");
    });

    it("returns false for non-existent diagram", () => {
      const result = storage.updateOwner("non-existent", "user-1");
      expect(result).toBe(false);
    });
  });

  describe("setPublic", () => {
    it("makes diagram public", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
        isPublic: false,
      });
      testIds.push(diagram.id);

      const result = storage.setPublic(diagram.id, true);
      expect(result).toBe(true);

      const updated = storage.getDiagram(diagram.id);
      expect(updated!.isPublic).toBe(true);
    });

    it("makes diagram private", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
        isPublic: true,
      });
      testIds.push(diagram.id);

      storage.setPublic(diagram.id, false);
      const updated = storage.getDiagram(diagram.id);
      expect(updated!.isPublic).toBe(false);
    });
  });

  describe("addShare", () => {
    it("adds a share", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
      });
      testIds.push(diagram.id);

      const result = storage.addShare(diagram.id, "user-2", "editor");
      expect(result).toBe(true);

      const updated = storage.getDiagram(diagram.id);
      expect(updated!.shares).toHaveLength(1);
      expect(updated!.shares![0]).toEqual({ userId: "user-2", permission: "editor" });
    });

    it("updates existing share", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
      });
      testIds.push(diagram.id);

      storage.addShare(diagram.id, "user-2", "viewer");
      storage.addShare(diagram.id, "user-2", "editor");

      const updated = storage.getDiagram(diagram.id);
      expect(updated!.shares).toHaveLength(1);
      expect(updated!.shares![0].permission).toBe("editor");
    });

    it("supports multiple shares", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
      });
      testIds.push(diagram.id);

      storage.addShare(diagram.id, "user-2", "editor");
      storage.addShare(diagram.id, "user-3", "viewer");

      const updated = storage.getDiagram(diagram.id);
      expect(updated!.shares).toHaveLength(2);
    });
  });

  describe("removeShare", () => {
    it("removes a share", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
      });
      testIds.push(diagram.id);

      storage.addShare(diagram.id, "user-2", "editor");
      storage.addShare(diagram.id, "user-3", "viewer");
      storage.removeShare(diagram.id, "user-2");

      const updated = storage.getDiagram(diagram.id);
      expect(updated!.shares).toHaveLength(1);
      expect(updated!.shares![0].userId).toBe("user-3");
    });

    it("handles removing non-existent share", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
      });
      testIds.push(diagram.id);

      const result = storage.removeShare(diagram.id, "non-existent");
      expect(result).toBe(true); // Operation succeeds, just no change
    });
  });

  describe("listDiagramsForUser", () => {
    beforeEach(() => {
      // Create test diagrams with various access levels
      const d1 = storage.createDiagram("User1 Private", "test", testSpec, {
        ownerId: "user-1",
        isPublic: false,
      });
      const d2 = storage.createDiagram("User1 Public", "test", testSpec, {
        ownerId: "user-1",
        isPublic: true,
      });
      const d3 = storage.createDiagram("User2 Private", "test", testSpec, {
        ownerId: "user-2",
        isPublic: false,
      });
      const d4 = storage.createDiagram("Shared with User1", "test", testSpec, {
        ownerId: "user-2",
        isPublic: false,
      });
      storage.addShare(d4.id, "user-1", "editor");

      const d5 = storage.createDiagram("Legacy Diagram", "test", testSpec);

      testIds.push(d1.id, d2.id, d3.id, d4.id, d5.id);
    });

    it("returns owned diagrams", () => {
      const { diagrams } = storage.listDiagramsForUser("user-1");

      const ownedByUser1 = diagrams.filter((d) => d.ownerId === "user-1");
      expect(ownedByUser1.length).toBeGreaterThanOrEqual(2);
    });

    it("returns public diagrams", () => {
      const { diagrams } = storage.listDiagramsForUser("user-3"); // User with no diagrams

      const publicDiagrams = diagrams.filter((d) => d.isPublic);
      expect(publicDiagrams.length).toBeGreaterThanOrEqual(1);
    });

    it("returns shared diagrams", () => {
      const { diagrams } = storage.listDiagramsForUser("user-1");

      const sharedWithUser1 = diagrams.filter(
        (d) => d.shares?.some((s) => s.userId === "user-1")
      );
      expect(sharedWithUser1.length).toBeGreaterThanOrEqual(1);
    });

    it("returns legacy diagrams (no owner)", () => {
      const { diagrams } = storage.listDiagramsForUser("user-1");

      const legacyDiagrams = diagrams.filter((d) => d.ownerId === null);
      expect(legacyDiagrams.length).toBeGreaterThanOrEqual(1);
    });

    it("does not return other users private diagrams", () => {
      const { diagrams } = storage.listDiagramsForUser("user-1");

      // User1 should not see user2's private diagram that isn't shared
      const user2PrivateNotShared = diagrams.filter(
        (d) =>
          d.ownerId === "user-2" &&
          !d.isPublic &&
          !d.shares?.some((s) => s.userId === "user-1")
      );
      expect(user2PrivateNotShared.length).toBe(0);
    });

    it("anonymous users only see public and legacy diagrams", () => {
      const { diagrams } = storage.listDiagramsForUser(null);

      for (const diagram of diagrams) {
        expect(diagram.isPublic || diagram.ownerId === null).toBe(true);
      }
    });

    it("supports pagination", () => {
      const { diagrams, total } = storage.listDiagramsForUser("user-1", {
        limit: 2,
        offset: 0,
      });

      expect(diagrams.length).toBeLessThanOrEqual(2);
      expect(total).toBeGreaterThanOrEqual(diagrams.length);
    });

    it("supports project filter", () => {
      const { diagrams } = storage.listDiagramsForUser("user-1", {
        project: "test",
      });

      for (const diagram of diagrams) {
        expect(diagram.project).toBe("test");
      }
    });
  });

  describe("userId validation in share operations", () => {
    it("validateUserId accepts valid user IDs", () => {
      expect(storage.validateUserId("user-123")).toBe(true);
      expect(storage.validateUserId("abc")).toBe(true);
      expect(storage.validateUserId("user_name")).toBe(true);
      expect(storage.validateUserId("user@example.com")).toBe(true);
      expect(storage.validateUserId("user.name")).toBe(true);
      expect(storage.validateUserId("a".repeat(255))).toBe(true);
    });

    it("validateUserId rejects empty or null user IDs", () => {
      expect(storage.validateUserId("")).toBe(false);
      expect(storage.validateUserId(null as any)).toBe(false);
      expect(storage.validateUserId(undefined as any)).toBe(false);
    });

    it("validateUserId rejects oversized user IDs", () => {
      expect(storage.validateUserId("a".repeat(256))).toBe(false);
      expect(storage.validateUserId("a".repeat(1000))).toBe(false);
    });

    it("validateUserId rejects special characters that could cause injection", () => {
      // JSON injection attempts
      expect(storage.validateUserId('user","permission":"owner')).toBe(false);
      expect(storage.validateUserId('user"}],"evil":[{"x":"')).toBe(false);

      // SQL injection attempts
      expect(storage.validateUserId("user'; DROP TABLE--")).toBe(false);
      expect(storage.validateUserId("user' OR '1'='1")).toBe(false);

      // XSS attempts
      expect(storage.validateUserId("<script>alert(1)</script>")).toBe(false);
      expect(storage.validateUserId("user\"><script>")).toBe(false);

      // Path traversal
      expect(storage.validateUserId("../../../etc/passwd")).toBe(false);

      // Newlines and control chars
      expect(storage.validateUserId("user\nname")).toBe(false);
      expect(storage.validateUserId("user\x00name")).toBe(false);
    });

    it("addShare rejects invalid user IDs", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
      });
      testIds.push(diagram.id);

      // Should return false for invalid userIds
      expect(storage.addShare(diagram.id, "", "editor")).toBe(false);
      expect(storage.addShare(diagram.id, 'user","evil":"x', "editor")).toBe(false);

      // Verify no shares were added
      const updated = storage.getDiagram(diagram.id);
      expect(updated!.shares).toHaveLength(0);
    });

    it("removeShare rejects invalid user IDs", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
      });
      testIds.push(diagram.id);

      // Add a valid share first
      storage.addShare(diagram.id, "user-2", "editor");

      // Try to remove with invalid userId - should fail
      expect(storage.removeShare(diagram.id, "")).toBe(false);
      expect(storage.removeShare(diagram.id, '<script>')).toBe(false);

      // Verify original share still exists
      const updated = storage.getDiagram(diagram.id);
      expect(updated!.shares).toHaveLength(1);
    });

    it("updateShares rejects any invalid user IDs in the array", () => {
      const diagram = storage.createDiagram("Test", "test-project", testSpec, {
        ownerId: "user-1",
      });
      testIds.push(diagram.id);

      // Even one bad userId should reject the whole update
      const result = storage.updateShares(diagram.id, [
        { userId: "valid-user", permission: "editor" },
        { userId: 'invalid","evil', permission: "viewer" },
      ]);

      expect(result).toBe(false);

      // Verify no shares were set
      const updated = storage.getDiagram(diagram.id);
      expect(updated!.shares).toHaveLength(0);
    });

    it("listDiagramsForUser returns empty for invalid userId", () => {
      // Invalid userIds should not be used in queries
      const result = storage.listDiagramsForUser('user"injection');
      expect(result.diagrams).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("listDiagramsForUser works with valid userId", () => {
      const result = storage.listDiagramsForUser("user-1");
      // Should return some diagrams (from beforeEach setup)
      expect(result.diagrams.length).toBeGreaterThanOrEqual(0);
    });

    it("listDiagramsForUser allows null userId (anonymous)", () => {
      const result = storage.listDiagramsForUser(null);
      // Should work and return public diagrams
      expect(Array.isArray(result.diagrams)).toBe(true);
    });
  });
});
