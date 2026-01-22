/**
 * Standardized API Response Formats
 *
 * Provides consistent response structures for all API endpoints.
 *
 * Response Format Standards:
 * - Single resource: { data: {...}, meta?: {...} }
 * - Collection: { data: [...], meta: { total, page, pageSize, hasMore } }
 * - Error: { error: { code, message, details? } }
 */

import type { Context } from "hono";

// ==================== Response Types ====================

/**
 * Standard success response for a single resource
 */
export interface ResourceResponse<T> {
  data: T;
  meta?: ResponseMeta;
}

/**
 * Standard success response for a collection
 */
export interface CollectionResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Standard error response
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * General response metadata
 */
export interface ResponseMeta {
  cached?: boolean;
  etag?: string;
  complexity?: number;
  [key: string]: unknown;
}

/**
 * Pagination metadata for collections
 */
export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  offset?: number;
}

/**
 * Success operation response (for delete, etc.)
 */
export interface OperationResponse {
  success: boolean;
  message?: string;
}

// ==================== Response Builders ====================

/**
 * Build a resource response (single item)
 */
export function resourceResponse<T>(
  c: Context,
  data: T,
  meta?: ResponseMeta,
  status: 200 | 201 = 200
) {
  const response: ResourceResponse<T> = { data };
  if (meta && Object.keys(meta).length > 0) {
    response.meta = meta;
  }
  return c.json(response, status);
}

/**
 * Build a collection response (list of items)
 */
export function collectionResponse<T>(
  c: Context,
  data: T[],
  meta: PaginationMeta
) {
  const response: CollectionResponse<T> = { data, meta };
  return c.json(response);
}

/**
 * Build a paginated collection from offset-based query
 */
export function paginatedResponse<T>(
  c: Context,
  items: T[],
  total: number,
  offset: number,
  limit: number
) {
  const page = Math.floor(offset / limit) + 1;
  const hasMore = offset + items.length < total;

  return collectionResponse(c, items, {
    total,
    page,
    pageSize: limit,
    hasMore,
    offset,
  });
}

/**
 * Build an error response
 */
export function errorResponse(
  c: Context,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 500 = 400,
  details?: unknown
) {
  const response: ErrorResponse = {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };
  return c.json(response, status);
}

/**
 * Build a not found error response
 */
export function notFoundResponse(c: Context, resource: string, id?: string) {
  const message = id
    ? `${resource} with ID '${id}' not found`
    : `${resource} not found`;
  return errorResponse(c, "NOT_FOUND", message, 404);
}

/**
 * Build a validation error response
 */
export function validationErrorResponse(
  c: Context,
  message: string,
  details?: unknown
) {
  return errorResponse(c, "VALIDATION_ERROR", message, 400, details);
}

/**
 * Build an operation success response (for delete, etc.)
 */
export function operationResponse(
  c: Context,
  success: boolean,
  message?: string
) {
  const response: OperationResponse = { success };
  if (message) {
    response.message = message;
  }
  return c.json(response);
}

/**
 * Build a created response with location header
 */
export function createdResponse<T>(
  c: Context,
  data: T,
  location?: string,
  meta?: ResponseMeta
) {
  if (location) {
    c.header("Location", location);
  }
  return resourceResponse(c, data, meta, 201);
}

// ==================== Cache Headers ====================

/**
 * Set ETag header and handle If-None-Match
 */
export function withETag(
  c: Context,
  etag: string,
  cacheControl = "private, max-age=60"
): boolean {
  const ifNoneMatch = c.req.header("If-None-Match");

  if (ifNoneMatch && ifNoneMatch === etag) {
    return true; // Caller should return 304
  }

  c.header("ETag", etag);
  c.header("Cache-Control", cacheControl);
  return false;
}

/**
 * Set cache hit/miss header
 */
export function setCacheStatus(c: Context, hit: boolean) {
  c.header("X-Cache", hit ? "HIT" : "MISS");
}

// ==================== Response Helpers ====================

/**
 * Helper to send 304 Not Modified
 */
export function notModified() {
  return new Response(null, { status: 304 });
}

/**
 * Helper to send plain text (for exports like Mermaid)
 */
export function textResponse(text: string, contentType = "text/plain") {
  return new Response(text, {
    headers: {
      "Content-Type": contentType,
    },
  });
}

/**
 * Helper to send downloadable file
 */
export function downloadResponse(
  content: string | ArrayBuffer,
  filename: string,
  contentType: string
) {
  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache",
    },
  });
}
