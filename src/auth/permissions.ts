/**
 * Permission System for Diagram Access Control
 *
 * Implements ownership-based access control with sharing support.
 * Permissions: owner (full control), editor (read/write), viewer (read-only)
 */

import type { UserContext } from "./middleware";
import type { Diagram } from "../types";
import { createLogger } from "../logging";

const log = createLogger("permissions");

export type Permission = "owner" | "editor" | "viewer" | "none";

export interface DiagramOwnership {
  /** User ID of the diagram owner */
  ownerId: string | null;
  /** Whether the diagram is publicly viewable */
  isPublic: boolean;
  /** Shared access list (userId -> permission) */
  shares?: Map<string, "editor" | "viewer">;
}

/**
 * Calculate effective permission for a user on a diagram
 *
 * Permission hierarchy:
 * - Admin users have full access (owner permission)
 * - Owners get owner permission, but viewer-role users are restricted
 * - Explicit shares grant editor/viewer permission
 * - Anonymous-owned public diagrams are editable by authenticated users
 * - Public diagrams are viewable by anyone
 */
export function getEffectivePermission(
  user: UserContext | null,
  ownership: DiagramOwnership
): Permission {
  // Admin users have full access
  if (user?.role === "admin") {
    return "owner";
  }

  // Owner has full control (unless they have viewer role)
  if (user && ownership.ownerId === user.id) {
    // Viewer role users have restricted permissions even on their own diagrams
    // They can read and export but cannot write or delete
    if (user.role === "viewer") {
      return "viewer";
    }
    return "owner";
  }

  // Check explicit shares
  if (user && ownership.shares) {
    const sharePermission = ownership.shares.get(user.id);
    if (sharePermission) {
      return sharePermission;
    }
  }

  // Anonymous-owned public diagrams are editable by any authenticated user
  // This allows collaborative editing of orphaned diagrams
  if (ownership.ownerId === null && ownership.isPublic && user) {
    return "editor";
  }

  // Public diagrams are viewable by anyone
  if (ownership.isPublic) {
    return "viewer";
  }

  // No permission
  return "none";
}

/**
 * Check if user can perform a specific action
 *
 * These functions support two calling conventions:
 * 1. canRead(permission) - Check a pre-computed permission
 * 2. canRead(user, ownership) - Compute permission from user and ownership
 */
export function canRead(permission: Permission): boolean;
export function canRead(user: UserContext | null, ownership: DiagramOwnership): boolean;
export function canRead(
  permissionOrUser: Permission | UserContext | null,
  ownership?: DiagramOwnership
): boolean {
  const permission =
    ownership !== undefined
      ? getEffectivePermission(permissionOrUser as UserContext | null, ownership)
      : (permissionOrUser as Permission);
  return permission !== "none";
}

export function canWrite(permission: Permission): boolean;
export function canWrite(user: UserContext | null, ownership: DiagramOwnership): boolean;
export function canWrite(
  permissionOrUser: Permission | UserContext | null,
  ownership?: DiagramOwnership
): boolean {
  const permission =
    ownership !== undefined
      ? getEffectivePermission(permissionOrUser as UserContext | null, ownership)
      : (permissionOrUser as Permission);
  return permission === "owner" || permission === "editor";
}

export function canDelete(permission: Permission): boolean;
export function canDelete(user: UserContext | null, ownership: DiagramOwnership): boolean;
export function canDelete(
  permissionOrUser: Permission | UserContext | null,
  ownership?: DiagramOwnership
): boolean {
  const permission =
    ownership !== undefined
      ? getEffectivePermission(permissionOrUser as UserContext | null, ownership)
      : (permissionOrUser as Permission);
  return permission === "owner";
}

export function canShare(permission: Permission): boolean;
export function canShare(user: UserContext | null, ownership: DiagramOwnership): boolean;
export function canShare(
  permissionOrUser: Permission | UserContext | null,
  ownership?: DiagramOwnership
): boolean {
  const permission =
    ownership !== undefined
      ? getEffectivePermission(permissionOrUser as UserContext | null, ownership)
      : (permissionOrUser as Permission);
  return permission === "owner";
}

export function canExport(permission: Permission): boolean;
export function canExport(user: UserContext | null, ownership: DiagramOwnership): boolean;
export function canExport(
  permissionOrUser: Permission | UserContext | null,
  ownership?: DiagramOwnership
): boolean {
  const permission =
    ownership !== undefined
      ? getEffectivePermission(permissionOrUser as UserContext | null, ownership)
      : (permissionOrUser as Permission);
  return permission !== "none";
}

/**
 * Convenience function to check all permissions at once
 */
export function getPermissions(permission: Permission): {
  read: boolean;
  write: boolean;
  delete: boolean;
  share: boolean;
  export: boolean;
} {
  return {
    read: canRead(permission),
    write: canWrite(permission),
    delete: canDelete(permission),
    share: canShare(permission),
    export: canExport(permission),
  };
}

/**
 * Create an ownership object for a new diagram
 */
export function createOwnership(userId: string | null, isPublic = false): DiagramOwnership {
  return {
    ownerId: userId,
    isPublic,
    shares: new Map(),
  };
}

/**
 * Parse ownership data from database JSON or extract from a Diagram object
 *
 * Supports two calling conventions:
 * 1. parseOwnership(ownerId, isPublic, sharesJson) - Parse from raw database values
 * 2. parseOwnership(diagram) - Extract from a Diagram object
 */
export function parseOwnership(
  ownerId: string | null,
  isPublic: number | boolean,
  sharesJson: string | null
): DiagramOwnership;
export function parseOwnership(diagram: Diagram): DiagramOwnership;
export function parseOwnership(
  ownerIdOrDiagram: string | null | Diagram,
  isPublic?: number | boolean,
  sharesJson?: string | null
): DiagramOwnership {
  // If first argument is a Diagram object
  if (
    ownerIdOrDiagram !== null &&
    typeof ownerIdOrDiagram === "object" &&
    "id" in ownerIdOrDiagram &&
    "spec" in ownerIdOrDiagram
  ) {
    const diagram = ownerIdOrDiagram as Diagram;
    const shares = new Map<string, "editor" | "viewer">();

    if (diagram.shares) {
      for (const share of diagram.shares) {
        if (share.permission === "editor" || share.permission === "viewer") {
          shares.set(share.userId, share.permission);
        }
      }
    }

    return {
      ownerId: diagram.ownerId ?? null,
      isPublic: diagram.isPublic ?? false,
      shares,
    };
  }

  // Original implementation for raw database values
  const ownerId = ownerIdOrDiagram as string | null;
  const shares = new Map<string, "editor" | "viewer">();

  if (sharesJson) {
    try {
      const parsed = JSON.parse(sharesJson);
      if (Array.isArray(parsed)) {
        for (const share of parsed) {
          if (share.userId && (share.permission === "editor" || share.permission === "viewer")) {
            shares.set(share.userId, share.permission);
          }
        }
      }
    } catch (error) {
      // Log malformed shares JSON - may indicate data corruption or tampering
      log.warn("Failed to parse shares JSON", {
        error: error instanceof Error ? error.message : String(error),
        // Don't log the actual JSON to avoid leaking sensitive data in logs
        jsonLength: sharesJson.length,
      });
    }
  }

  return {
    ownerId,
    isPublic: Boolean(isPublic),
    shares,
  };
}

/**
 * Serialize shares to JSON for database storage
 */
export function serializeShares(shares: Map<string, "editor" | "viewer">): string {
  const arr = Array.from(shares.entries()).map(([userId, permission]) => ({
    userId,
    permission,
  }));
  return JSON.stringify(arr);
}

/**
 * Error class for permission denied
 *
 * Supports two calling conventions:
 * 1. new PermissionDeniedError(action, resourceType, resourceId)
 * 2. new PermissionDeniedError(action, resourceId) - Assumes resourceType is "diagram"
 */
export class PermissionDeniedError extends Error {
  code = "PERMISSION_DENIED" as const;
  statusCode = 403 as const;
  action: string;
  resourceType: string;
  resourceId: string;

  constructor(action: string, resourceTypeOrId: string, resourceId?: string) {
    const actualResourceType = resourceId !== undefined ? resourceTypeOrId : "diagram";
    const actualResourceId = resourceId !== undefined ? resourceId : resourceTypeOrId;

    super(`Permission denied: cannot ${action} ${actualResourceType} ${actualResourceId}`);
    this.name = "PermissionDeniedError";
    this.action = action;
    this.resourceType = actualResourceType;
    this.resourceId = actualResourceId;
  }
}

/**
 * Assert user has permission, throw if not
 */
export function assertPermission(
  permission: Permission,
  requiredPermission: "read" | "write" | "delete" | "share" | "export",
  resourceType: string,
  resourceId: string
): void {
  const allowed =
    requiredPermission === "read"
      ? canRead(permission)
      : requiredPermission === "write"
        ? canWrite(permission)
        : requiredPermission === "delete"
          ? canDelete(permission)
          : requiredPermission === "share"
            ? canShare(permission)
            : canExport(permission);

  if (!allowed) {
    throw new PermissionDeniedError(requiredPermission, resourceType, resourceId);
  }
}
