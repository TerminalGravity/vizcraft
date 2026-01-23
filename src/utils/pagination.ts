/**
 * Pagination Utilities
 *
 * Centralized pagination parameter parsing with validation.
 * Ensures consistent handling across all paginated API endpoints.
 */

/**
 * Pagination configuration
 */
export interface PaginationConfig {
  /** Default limit if not specified (default: 50) */
  defaultLimit?: number;
  /** Maximum allowed limit (default: 100) */
  maxLimit?: number;
  /** Minimum allowed limit (default: 1) */
  minLimit?: number;
  /** Default offset if not specified (default: 0) */
  defaultOffset?: number;
}

/**
 * Parsed pagination parameters
 */
export interface PaginationParams {
  /** Number of items to return */
  limit: number;
  /** Number of items to skip */
  offset: number;
}

/**
 * Default pagination configuration
 */
const DEFAULT_CONFIG: Required<PaginationConfig> = {
  defaultLimit: 50,
  maxLimit: 100,
  minLimit: 1,
  defaultOffset: 0,
};

/**
 * Parse and validate pagination parameters from query strings
 *
 * Handles:
 * - Missing/undefined parameters (uses defaults)
 * - Invalid/non-numeric values (uses defaults)
 * - Out-of-bounds values (clamps to min/max)
 * - NaN protection
 *
 * @param limitParam - Raw limit query parameter
 * @param offsetParam - Raw offset query parameter
 * @param config - Custom configuration for defaults and bounds
 * @returns Validated pagination parameters
 *
 * @example
 * ```ts
 * // Basic usage with query params
 * const { limit, offset } = parsePagination(
 *   c.req.query("limit"),
 *   c.req.query("offset")
 * );
 *
 * // With custom config
 * const { limit, offset } = parsePagination(
 *   c.req.query("limit"),
 *   c.req.query("offset"),
 *   { defaultLimit: 20, maxLimit: 50 }
 * );
 * ```
 */
export function parsePagination(
  limitParam: string | undefined,
  offsetParam: string | undefined,
  config: PaginationConfig = {}
): PaginationParams {
  const {
    defaultLimit,
    maxLimit,
    minLimit,
    defaultOffset,
  } = { ...DEFAULT_CONFIG, ...config };

  // Parse limit with validation
  let limit = defaultLimit;
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed)) {
      // Clamp to valid range
      limit = Math.min(Math.max(parsed, minLimit), maxLimit);
    }
  }

  // Parse offset with validation
  let offset = defaultOffset;
  if (offsetParam !== undefined) {
    const parsed = parseInt(offsetParam, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }

  return { limit, offset };
}

/**
 * Parse limit-only parameter (for endpoints that don't support offset)
 *
 * @param limitParam - Raw limit query parameter
 * @param config - Custom configuration for defaults and bounds
 * @returns Validated limit value
 */
export function parseLimit(
  limitParam: string | undefined,
  config: PaginationConfig = {}
): number {
  const { limit } = parsePagination(limitParam, undefined, config);
  return limit;
}

/**
 * Pre-configured pagination parsers for common use cases
 */
export const paginationPresets = {
  /** Standard list endpoint (limit: 1-100, default: 50) */
  standard: (limitParam?: string, offsetParam?: string) =>
    parsePagination(limitParam, offsetParam),

  /** Version history (limit: 1-50, default: 20) */
  versions: (limitParam?: string, offsetParam?: string) =>
    parsePagination(limitParam, offsetParam, {
      defaultLimit: 20,
      maxLimit: 50,
    }),

  /** Timeline/Activity (limit: 1-100, default: 50) */
  timeline: (limitParam?: string, offsetParam?: string) =>
    parsePagination(limitParam, offsetParam, {
      defaultLimit: 50,
      maxLimit: 100,
    }),
} as const;
