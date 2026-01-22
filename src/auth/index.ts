/**
 * Authentication and Authorization Module
 *
 * Provides JWT-based authentication with role-based access control
 * and ownership-based diagram permissions.
 */

// JWT utilities
export { signJWT, verifyJWT, decodeJWT, isTokenExpiringSoon, type JWTPayload, type TokenValidationResult } from "./jwt";

// Middleware
export {
  requireAuth,
  optionalAuth,
  requireRole,
  getCurrentUser,
  assertAuthenticated,
  type UserContext,
} from "./middleware";

// Permissions
export {
  getEffectivePermission,
  canRead,
  canWrite,
  canDelete,
  canShare,
  canExport,
  getPermissions,
  createOwnership,
  parseOwnership,
  serializeShares,
  PermissionDeniedError,
  assertPermission,
  type Permission,
  type DiagramOwnership,
} from "./permissions";
