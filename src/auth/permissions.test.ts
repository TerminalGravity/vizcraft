/**
 * Permissions System Tests
 */

import { describe, it, expect } from "bun:test";
import {
  getEffectivePermission,
  canRead,
  canWrite,
  canDelete,
  canShare,
  getPermissions,
  createOwnership,
  parseOwnership,
  serializeShares,
  assertPermission,
  PermissionDeniedError,
  type DiagramOwnership,
} from "./permissions";
import type { UserContext } from "./middleware";

function createUser(id: string, role: "admin" | "user" | "viewer" = "user"): UserContext {
  return {
    id,
    role,
    payload: { sub: id, iss: "vizcraft", iat: 0, exp: 0, role },
  };
}

describe("Permissions", () => {
  describe("getEffectivePermission", () => {
    it("grants owner permission to diagram owner", () => {
      const user = createUser("user-1");
      const ownership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: false,
      };

      expect(getEffectivePermission(user, ownership)).toBe("owner");
    });

    it("grants owner permission to admins", () => {
      const admin = createUser("admin-1", "admin");
      const ownership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: false,
      };

      expect(getEffectivePermission(admin, ownership)).toBe("owner");
    });

    it("grants viewer permission for public diagrams", () => {
      const user = createUser("user-2");
      const ownership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: true,
      };

      expect(getEffectivePermission(user, ownership)).toBe("viewer");
    });

    it("grants shared permission from shares map", () => {
      const user = createUser("user-2");
      const ownership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: false,
        shares: new Map([["user-2", "editor"]]),
      };

      expect(getEffectivePermission(user, ownership)).toBe("editor");
    });

    it("denies access to private diagrams for non-owners", () => {
      const user = createUser("user-2");
      const ownership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: false,
      };

      expect(getEffectivePermission(user, ownership)).toBe("none");
    });

    it("allows anonymous users to view public diagrams", () => {
      const ownership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: true,
      };

      expect(getEffectivePermission(null, ownership)).toBe("viewer");
    });

    it("denies anonymous users from private diagrams", () => {
      const ownership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: false,
      };

      expect(getEffectivePermission(null, ownership)).toBe("none");
    });

    it("restricts viewer-role users to viewer permission on their own diagrams", () => {
      // A user with "viewer" role should only get viewer permission,
      // even on diagrams they own - the role acts as a ceiling
      const viewerUser = createUser("user-1", "viewer");
      const ownership: DiagramOwnership = {
        ownerId: "user-1",  // Same as user - they own it
        isPublic: false,
      };

      expect(getEffectivePermission(viewerUser, ownership)).toBe("viewer");
    });

    it("allows viewer-role users to read their own diagrams", () => {
      const viewerUser = createUser("user-1", "viewer");
      const ownership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: false,
      };

      const permission = getEffectivePermission(viewerUser, ownership);
      expect(canRead(permission)).toBe(true);
    });

    it("prevents viewer-role users from writing to their own diagrams", () => {
      const viewerUser = createUser("user-1", "viewer");
      const ownership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: false,
      };

      const permission = getEffectivePermission(viewerUser, ownership);
      expect(canWrite(permission)).toBe(false);
    });

    it("prevents viewer-role users from deleting their own diagrams", () => {
      const viewerUser = createUser("user-1", "viewer");
      const ownership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: false,
      };

      const permission = getEffectivePermission(viewerUser, ownership);
      expect(canDelete(permission)).toBe(false);
    });

    it("grants editor permission to authenticated users for anonymous-owned public diagrams", () => {
      // Diagrams with ownerId=null and isPublic=true are editable by any authenticated user
      // This enables collaborative editing of orphaned diagrams
      const user = createUser("any-user");
      const ownership: DiagramOwnership = {
        ownerId: null,  // Anonymous/orphaned diagram
        isPublic: true,
      };

      expect(getEffectivePermission(user, ownership)).toBe("editor");
    });

    it("grants only viewer permission to anonymous users for anonymous-owned public diagrams", () => {
      const ownership: DiagramOwnership = {
        ownerId: null,
        isPublic: true,
      };

      // Unauthenticated users can view but not edit
      expect(getEffectivePermission(null, ownership)).toBe("viewer");
    });

    it("denies all access to anonymous-owned private diagrams", () => {
      // This is an edge case - a diagram with no owner and not public
      const user = createUser("any-user");
      const ownership: DiagramOwnership = {
        ownerId: null,
        isPublic: false,
      };

      expect(getEffectivePermission(user, ownership)).toBe("none");
      expect(getEffectivePermission(null, ownership)).toBe("none");
    });
  });

  describe("permission checks", () => {
    it("owner can do everything", () => {
      const perms = getPermissions("owner");
      expect(perms.read).toBe(true);
      expect(perms.write).toBe(true);
      expect(perms.delete).toBe(true);
      expect(perms.share).toBe(true);
      expect(perms.export).toBe(true);
    });

    it("editor can read, write, export but not delete or share", () => {
      const perms = getPermissions("editor");
      expect(perms.read).toBe(true);
      expect(perms.write).toBe(true);
      expect(perms.delete).toBe(false);
      expect(perms.share).toBe(false);
      expect(perms.export).toBe(true);
    });

    it("viewer can only read and export", () => {
      const perms = getPermissions("viewer");
      expect(perms.read).toBe(true);
      expect(perms.write).toBe(false);
      expect(perms.delete).toBe(false);
      expect(perms.share).toBe(false);
      expect(perms.export).toBe(true);
    });

    it("none has no permissions", () => {
      const perms = getPermissions("none");
      expect(perms.read).toBe(false);
      expect(perms.write).toBe(false);
      expect(perms.delete).toBe(false);
      expect(perms.share).toBe(false);
      expect(perms.export).toBe(false);
    });
  });

  describe("helper functions", () => {
    it("canRead returns correct values", () => {
      expect(canRead("owner")).toBe(true);
      expect(canRead("editor")).toBe(true);
      expect(canRead("viewer")).toBe(true);
      expect(canRead("none")).toBe(false);
    });

    it("canWrite returns correct values", () => {
      expect(canWrite("owner")).toBe(true);
      expect(canWrite("editor")).toBe(true);
      expect(canWrite("viewer")).toBe(false);
      expect(canWrite("none")).toBe(false);
    });

    it("canDelete returns correct values", () => {
      expect(canDelete("owner")).toBe(true);
      expect(canDelete("editor")).toBe(false);
      expect(canDelete("viewer")).toBe(false);
      expect(canDelete("none")).toBe(false);
    });

    it("canShare returns correct values", () => {
      expect(canShare("owner")).toBe(true);
      expect(canShare("editor")).toBe(false);
      expect(canShare("viewer")).toBe(false);
      expect(canShare("none")).toBe(false);
    });
  });

  describe("two-argument overloads", () => {
    // Test that canRead(user, ownership) works as a convenience function
    const testOwnership: DiagramOwnership = {
      ownerId: "user-1",
      isPublic: false,
    };

    it("canRead(user, ownership) computes permission correctly", () => {
      const owner = createUser("user-1");
      const other = createUser("user-2");

      expect(canRead(owner, testOwnership)).toBe(true);  // Owner can read
      expect(canRead(other, testOwnership)).toBe(false); // Non-owner cannot read private
    });

    it("canWrite(user, ownership) computes permission correctly", () => {
      const owner = createUser("user-1");
      const other = createUser("user-2");

      expect(canWrite(owner, testOwnership)).toBe(true);  // Owner can write
      expect(canWrite(other, testOwnership)).toBe(false); // Non-owner cannot write
    });

    it("canDelete(user, ownership) computes permission correctly", () => {
      const owner = createUser("user-1");
      const editor = createUser("user-2");
      const ownershipWithEditor: DiagramOwnership = {
        ...testOwnership,
        shares: new Map([["user-2", "editor"]]),
      };

      expect(canDelete(owner, ownershipWithEditor)).toBe(true);   // Owner can delete
      expect(canDelete(editor, ownershipWithEditor)).toBe(false); // Editor cannot delete
    });

    it("canShare(user, ownership) computes permission correctly", () => {
      const owner = createUser("user-1");
      const admin = createUser("admin-1", "admin");
      const editor = createUser("user-2");
      const ownershipWithEditor: DiagramOwnership = {
        ...testOwnership,
        shares: new Map([["user-2", "editor"]]),
      };

      expect(canShare(owner, ownershipWithEditor)).toBe(true);   // Owner can share
      expect(canShare(admin, ownershipWithEditor)).toBe(true);   // Admin can share (owner permission)
      expect(canShare(editor, ownershipWithEditor)).toBe(false); // Editor cannot share
    });

    it("works with null user for anonymous access", () => {
      const publicOwnership: DiagramOwnership = {
        ownerId: "user-1",
        isPublic: true,
      };

      expect(canRead(null, publicOwnership)).toBe(true);   // Anonymous can read public
      expect(canWrite(null, publicOwnership)).toBe(false); // Anonymous cannot write
    });
  });

  describe("createOwnership", () => {
    it("creates ownership with user ID", () => {
      const ownership = createOwnership("user-123");

      expect(ownership.ownerId).toBe("user-123");
      expect(ownership.isPublic).toBe(false);
      expect(ownership.shares).toBeInstanceOf(Map);
      expect(ownership.shares?.size).toBe(0);
    });

    it("creates public ownership", () => {
      const ownership = createOwnership("user-123", true);

      expect(ownership.isPublic).toBe(true);
    });

    it("handles null owner for anonymous diagrams", () => {
      const ownership = createOwnership(null, true);

      expect(ownership.ownerId).toBeNull();
    });
  });

  describe("parseOwnership", () => {
    it("parses ownership from database values", () => {
      const ownership = parseOwnership(
        "user-123",
        1,
        '[{"userId":"user-456","permission":"editor"}]'
      );

      expect(ownership.ownerId).toBe("user-123");
      expect(ownership.isPublic).toBe(true);
      expect(ownership.shares?.get("user-456")).toBe("editor");
    });

    it("handles null shares", () => {
      const ownership = parseOwnership("user-123", 0, null);

      expect(ownership.shares?.size).toBe(0);
    });

    it("handles invalid JSON", () => {
      const ownership = parseOwnership("user-123", 0, "invalid-json");

      expect(ownership.shares?.size).toBe(0);
    });

    it("filters invalid share entries", () => {
      const ownership = parseOwnership(
        "user-123",
        0,
        '[{"userId":"user-1","permission":"invalid"},{"userId":"user-2","permission":"viewer"}]'
      );

      expect(ownership.shares?.size).toBe(1);
      expect(ownership.shares?.get("user-2")).toBe("viewer");
    });

    it("parses ownership from Diagram object", () => {
      const diagram = {
        id: "diagram-123",
        name: "Test Diagram",
        spec: { type: "flowchart" as const, nodes: [], edges: [] },
        ownerId: "user-456",
        isPublic: true,
        shares: [
          { userId: "user-789", permission: "editor" as const },
          { userId: "user-abc", permission: "viewer" as const },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const ownership = parseOwnership(diagram);

      expect(ownership.ownerId).toBe("user-456");
      expect(ownership.isPublic).toBe(true);
      expect(ownership.shares?.get("user-789")).toBe("editor");
      expect(ownership.shares?.get("user-abc")).toBe("viewer");
    });

    it("handles Diagram with no shares", () => {
      const diagram = {
        id: "diagram-123",
        name: "Test Diagram",
        spec: { type: "flowchart" as const, nodes: [], edges: [] },
        ownerId: "user-456",
        isPublic: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const ownership = parseOwnership(diagram);

      expect(ownership.ownerId).toBe("user-456");
      expect(ownership.isPublic).toBe(false);
      expect(ownership.shares?.size).toBe(0);
    });

    it("handles Diagram with undefined ownerId", () => {
      const diagram = {
        id: "diagram-123",
        name: "Test Diagram",
        spec: { type: "flowchart" as const, nodes: [], edges: [] },
        ownerId: undefined,
        isPublic: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const ownership = parseOwnership(diagram);

      expect(ownership.ownerId).toBeNull();
    });

    it("filters invalid share permissions from Diagram object", () => {
      const diagram = {
        id: "diagram-123",
        name: "Test Diagram",
        spec: { type: "flowchart" as const, nodes: [], edges: [] },
        ownerId: "user-1",
        isPublic: false,
        shares: [
          { userId: "user-2", permission: "editor" as const },
          { userId: "user-3", permission: "owner" as any }, // Invalid - should be filtered
          { userId: "user-4", permission: "viewer" as const },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const ownership = parseOwnership(diagram);

      // "owner" is not a valid share permission, should be filtered
      expect(ownership.shares?.size).toBe(2);
      expect(ownership.shares?.has("user-2")).toBe(true);
      expect(ownership.shares?.has("user-3")).toBe(false);
      expect(ownership.shares?.has("user-4")).toBe(true);
    });
  });

  describe("serializeShares", () => {
    it("serializes shares to JSON", () => {
      const shares = new Map<string, "editor" | "viewer">([
        ["user-1", "editor"],
        ["user-2", "viewer"],
      ]);

      const json = serializeShares(shares);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(2);
      expect(parsed.find((s: { userId: string }) => s.userId === "user-1").permission).toBe("editor");
      expect(parsed.find((s: { userId: string }) => s.userId === "user-2").permission).toBe("viewer");
    });

    it("handles empty shares", () => {
      const json = serializeShares(new Map());

      expect(json).toBe("[]");
    });
  });

  describe("assertPermission", () => {
    it("does not throw when permission is sufficient", () => {
      expect(() => assertPermission("owner", "delete", "diagram", "123")).not.toThrow();
      expect(() => assertPermission("editor", "write", "diagram", "123")).not.toThrow();
      expect(() => assertPermission("viewer", "read", "diagram", "123")).not.toThrow();
    });

    it("throws PermissionDeniedError when permission is insufficient", () => {
      expect(() => assertPermission("viewer", "write", "diagram", "123")).toThrow(PermissionDeniedError);
      expect(() => assertPermission("editor", "delete", "diagram", "123")).toThrow(PermissionDeniedError);
      expect(() => assertPermission("none", "read", "diagram", "123")).toThrow(PermissionDeniedError);
    });

    it("PermissionDeniedError has correct properties", () => {
      try {
        assertPermission("none", "read", "diagram", "123");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(PermissionDeniedError);
        const permError = error as PermissionDeniedError;
        expect(permError.action).toBe("read");
        expect(permError.resourceType).toBe("diagram");
        expect(permError.resourceId).toBe("123");
        expect(permError.code).toBe("PERMISSION_DENIED");
        expect(permError.statusCode).toBe(403);
      }
    });
  });

  describe("PermissionDeniedError", () => {
    it("supports three-argument constructor", () => {
      const error = new PermissionDeniedError("delete", "diagram", "diag-123");

      expect(error.action).toBe("delete");
      expect(error.resourceType).toBe("diagram");
      expect(error.resourceId).toBe("diag-123");
      expect(error.message).toContain("cannot delete diagram diag-123");
    });

    it("supports two-argument constructor (defaults to diagram)", () => {
      // Convenience form: new PermissionDeniedError(action, diagramId)
      const error = new PermissionDeniedError("write", "diag-456");

      expect(error.action).toBe("write");
      expect(error.resourceType).toBe("diagram");
      expect(error.resourceId).toBe("diag-456");
      expect(error.message).toContain("cannot write diagram diag-456");
    });

    it("has correct code and statusCode", () => {
      const error = new PermissionDeniedError("share", "test-id");

      expect(error.code).toBe("PERMISSION_DENIED");
      expect(error.statusCode).toBe(403);
      expect(error.name).toBe("PermissionDeniedError");
    });
  });
});
