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
});
