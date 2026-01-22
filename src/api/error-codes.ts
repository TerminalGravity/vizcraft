/**
 * Centralized API Error Codes
 *
 * Single source of truth for all API error codes, status codes, and default messages.
 * This ensures consistency across the API and makes it easy to document errors for clients.
 *
 * Usage:
 *   import { ApiError, errorFromCode } from "./error-codes";
 *   return errorFromCode(c, ApiError.NOT_FOUND);
 *   return errorFromCode(c, ApiError.VALIDATION_ERROR, "Custom message", { field: "name" });
 */

import type { Context } from "hono";
import { errorResponse } from "./responses";

/**
 * Error definition with code, default status, and default message
 */
export interface ErrorDefinition {
  code: string;
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503;
  message: string;
}

/**
 * All API error codes organized by category
 */
export const ApiError = {
  // ==================== Client Errors (4xx) ====================

  // 400 Bad Request - Invalid input
  INVALID_JSON: {
    code: "INVALID_JSON",
    status: 400,
    message: "Invalid JSON in request body",
  },
  VALIDATION_ERROR: {
    code: "VALIDATION_ERROR",
    status: 400,
    message: "Validation failed",
  },
  INVALID_INPUT: {
    code: "INVALID_INPUT",
    status: 400,
    message: "Invalid input provided",
  },
  INVALID_ACTION: {
    code: "INVALID_ACTION",
    status: 400,
    message: "Invalid action specified",
  },
  INVALID_THUMBNAIL: {
    code: "INVALID_THUMBNAIL",
    status: 400,
    message: "Invalid thumbnail data",
  },
  INVALID_FORMAT: {
    code: "INVALID_FORMAT",
    status: 400,
    message: "Invalid format specified",
  },
  MISSING_PARAMETER: {
    code: "MISSING_PARAMETER",
    status: 400,
    message: "Required parameter missing",
  },

  // 401 Unauthorized - Authentication required
  UNAUTHORIZED: {
    code: "UNAUTHORIZED",
    status: 401,
    message: "Authentication required",
  },
  INVALID_TOKEN: {
    code: "INVALID_TOKEN",
    status: 401,
    message: "Invalid or expired authentication token",
  },

  // 403 Forbidden - Authenticated but not authorized
  FORBIDDEN: {
    code: "FORBIDDEN",
    status: 403,
    message: "Access denied",
  },
  ADMIN_REQUIRED: {
    code: "ADMIN_REQUIRED",
    status: 403,
    message: "Admin access required",
  },
  PERMISSION_DENIED: {
    code: "PERMISSION_DENIED",
    status: 403,
    message: "Permission denied for this operation",
  },

  // 404 Not Found
  NOT_FOUND: {
    code: "NOT_FOUND",
    status: 404,
    message: "Resource not found",
  },
  DIAGRAM_NOT_FOUND: {
    code: "DIAGRAM_NOT_FOUND",
    status: 404,
    message: "Diagram not found",
  },
  VERSION_NOT_FOUND: {
    code: "VERSION_NOT_FOUND",
    status: 404,
    message: "Version not found",
  },
  ROOM_NOT_FOUND: {
    code: "ROOM_NOT_FOUND",
    status: 404,
    message: "Collaboration room not found",
  },

  // 409 Conflict
  VERSION_CONFLICT: {
    code: "VERSION_CONFLICT",
    status: 409,
    message: "Version conflict - resource was modified",
  },
  ALREADY_EXISTS: {
    code: "ALREADY_EXISTS",
    status: 409,
    message: "Resource already exists",
  },

  // 422 Unprocessable Entity
  UNPROCESSABLE: {
    code: "UNPROCESSABLE",
    status: 422,
    message: "Request could not be processed",
  },

  // 429 Too Many Requests
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    status: 429,
    message: "Too many requests - please slow down",
  },

  // ==================== Server Errors (5xx) ====================

  // 500 Internal Server Error - General failures
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    status: 500,
    message: "Internal server error",
  },
  SERVER_ERROR: {
    code: "SERVER_ERROR",
    status: 500,
    message: "An unexpected error occurred",
  },

  // 500 - CRUD operation failures
  CREATE_FAILED: {
    code: "CREATE_FAILED",
    status: 500,
    message: "Failed to create resource",
  },
  UPDATE_FAILED: {
    code: "UPDATE_FAILED",
    status: 500,
    message: "Failed to update resource",
  },
  DELETE_FAILED: {
    code: "DELETE_FAILED",
    status: 500,
    message: "Failed to delete resource",
  },

  // 500 - Feature-specific failures
  THUMBNAIL_FAILED: {
    code: "THUMBNAIL_FAILED",
    status: 500,
    message: "Failed to process thumbnail",
  },
  THUMBNAIL_LOAD_FAILED: {
    code: "THUMBNAIL_LOAD_FAILED",
    status: 500,
    message: "Failed to load thumbnail",
  },
  EXPORT_FAILED: {
    code: "EXPORT_FAILED",
    status: 500,
    message: "Failed to export diagram",
  },
  MERMAID_EXPORT_FAILED: {
    code: "MERMAID_EXPORT_FAILED",
    status: 500,
    message: "Failed to export to Mermaid format",
  },
  THEME_APPLY_FAILED: {
    code: "THEME_APPLY_FAILED",
    status: 500,
    message: "Failed to apply theme",
  },
  LAYOUT_FAILED: {
    code: "LAYOUT_FAILED",
    status: 500,
    message: "Failed to apply layout",
  },

  // 500 - Admin/monitoring failures
  STATS_FAILED: {
    code: "STATS_FAILED",
    status: 500,
    message: "Failed to retrieve statistics",
  },
  CACHE_CLEAR_FAILED: {
    code: "CACHE_CLEAR_FAILED",
    status: 500,
    message: "Failed to clear cache",
  },
  AUDIT_FAILED: {
    code: "AUDIT_FAILED",
    status: 500,
    message: "Failed to retrieve audit log",
  },
  AUDIT_STATS_FAILED: {
    code: "AUDIT_STATS_FAILED",
    status: 500,
    message: "Failed to retrieve audit statistics",
  },

  // 500 - Collaboration failures
  COLLAB_STATS_FAILED: {
    code: "COLLAB_STATS_FAILED",
    status: 500,
    message: "Failed to retrieve collaboration statistics",
  },
  ROOM_INFO_FAILED: {
    code: "ROOM_INFO_FAILED",
    status: 500,
    message: "Failed to retrieve room information",
  },

  // 500 - Diagram type/template failures
  LIST_TYPES_FAILED: {
    code: "LIST_TYPES_FAILED",
    status: 500,
    message: "Failed to list diagram types",
  },
  TYPE_INFO_FAILED: {
    code: "TYPE_INFO_FAILED",
    status: 500,
    message: "Failed to retrieve diagram type information",
  },
  TEMPLATE_FAILED: {
    code: "TEMPLATE_FAILED",
    status: 500,
    message: "Failed to retrieve diagram template",
  },
  FORMATS_FAILED: {
    code: "FORMATS_FAILED",
    status: 500,
    message: "Failed to retrieve export formats",
  },

  // 500 - LLM failures
  LLM_STATUS_ERROR: {
    code: "LLM_STATUS_ERROR",
    status: 500,
    message: "Failed to retrieve LLM status",
  },
  LLM_GENERATION_FAILED: {
    code: "LLM_GENERATION_FAILED",
    status: 500,
    message: "LLM generation failed",
  },

  // 502 Bad Gateway
  UPSTREAM_ERROR: {
    code: "UPSTREAM_ERROR",
    status: 502,
    message: "Upstream service error",
  },

  // 503 Service Unavailable
  SERVICE_UNAVAILABLE: {
    code: "SERVICE_UNAVAILABLE",
    status: 503,
    message: "Service temporarily unavailable",
  },
} as const satisfies Record<string, ErrorDefinition>;

/**
 * Type for any valid API error
 */
export type ApiErrorType = (typeof ApiError)[keyof typeof ApiError];

/**
 * Type for error code strings
 */
export type ApiErrorCode = ApiErrorType["code"];

/**
 * Create an error response from a predefined error definition
 *
 * @param c - Hono context
 * @param error - Error definition from ApiError
 * @param customMessage - Optional custom message (overrides default)
 * @param details - Optional additional details
 */
export function errorFromCode(
  c: Context,
  error: ErrorDefinition,
  customMessage?: string,
  details?: unknown
) {
  return errorResponse(
    c,
    error.code,
    customMessage ?? error.message,
    error.status,
    details
  );
}

/**
 * Get error definition by code string (for dynamic lookup)
 */
export function getErrorByCode(code: string): ErrorDefinition | undefined {
  return Object.values(ApiError).find((e) => e.code === code);
}

/**
 * List all error codes (useful for documentation)
 */
export function listErrorCodes(): Array<{
  code: string;
  status: number;
  message: string;
  category: string;
}> {
  return Object.entries(ApiError).map(([key, error]) => ({
    code: error.code,
    status: error.status,
    message: error.message,
    category: error.status < 500 ? "client" : "server",
  }));
}

/**
 * Check if an error code exists
 */
export function isValidErrorCode(code: string): boolean {
  return Object.values(ApiError).some((e) => e.code === code);
}
