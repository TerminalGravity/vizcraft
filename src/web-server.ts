/**
 * Vizcraft Web Server
 * Serves API and static files for the web UI
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { protectedStorage as storage } from "./storage/protected-storage";
import { loadAgents, getAgent } from "./agents/loader";
import { runAgent } from "./agents/runner";
import { getProviderRegistry, listConfiguredProviders } from "./llm";
import { listThemes, getTheme, generateStyledCSS, applyThemeToDiagram } from "./styling";
import { layoutDiagram, listLayoutAlgorithms, type LayoutOptions, type LayoutAlgorithm } from "./layout";
import { diffSpecs, generateChangelog, type DiagramDiff } from "./versioning";
import {
  diagramCache,
  listCache,
  svgCache,
  generateETag,
  matchesETag,
  getSpecComplexity,
} from "./performance";
import {
  handleWebSocketOpen,
  handleWebSocketMessage,
  handleWebSocketClose,
  handleWebSocketError,
  handleWebSocketUpgrade,
  broadcastDiagramSync,
  getCollabStats,
  getRoomInfo,
} from "./collaboration";
import {
  listDiagramTypes,
  getDiagramTypeInfo,
  getDiagramTemplate,
  exportToMermaid,
  getSupportedExportFormats,
} from "./templates";
import type { DiagramSpec, DiagramType } from "./types";
import {
  VALID_DIAGRAM_TYPES,
  CreateDiagramRequestSchema,
  UpdateDiagramRequestSchema,
  UpdateThumbnailRequestSchema,
  ForkDiagramRequestSchema,
  ApplyLayoutRequestSchema,
  ApplyThemeRequestSchema,
} from "./validation/schemas";
import { join, extname } from "path";
import { escapeRegex } from "./utils/regex";
import { getContentDisposition } from "./utils/content-disposition";
import { rateLimiters, stopRateLimitCleanup } from "./api/rate-limiter";
import { runHealthChecks, livenessCheck, readinessCheck } from "./api/health";
import { securityHeaders, apiSecurityHeaders } from "./api/security-headers";
import { renderMetrics, trackHttpRequest, setDiagramCount } from "./metrics";
import { requestContext } from "./api/request-context";
import { diagramBodyLimit, thumbnailBodyLimit, smallBodyLimit } from "./api/body-limit";
import { responseCompression } from "./api/response-compression";
import {
  withTimeout,
  withListTimeout,
  TimeoutError,
  TIMEOUTS,
  MAX_LIST_OFFSET,
} from "./api/timeout";
import {
  shutdownMiddleware,
  installShutdownHandlers,
  onShutdown,
} from "./api/shutdown";
import { roomManager, stopCollabCleanup } from "./collaboration/room-manager";
import { CircuitBreakerError } from "./utils/circuit-breaker";
import {
  escapeXml,
  escapeAttribute,
  sanitizeId,
  sanitizeNumber,
  sanitizeColor,
  getSvgSecurityHeaders,
  sanitizeSvgOutput,
} from "./utils/svg-security";
import {
  errorResponse,
  notFoundResponse,
  validationErrorResponse,
  operationResponse,
} from "./api/responses";
import { ApiError, errorFromCode } from "./api/error-codes";
import {
  optionalAuth,
  requireAuth,
  getCurrentUser,
  signJWT,
  verifyJWT,
  type UserContext,
} from "./auth";
import {
  getEffectivePermission,
  canRead,
  canWrite,
  canDelete,
  parseOwnership,
  PermissionDeniedError,
} from "./auth/permissions";
import {
  setDiagramIdProvider,
  startThumbnailCleanup,
  stopThumbnailCleanup,
  getThumbnailCleanupStats,
} from "./storage/thumbnails";
import { audit, getAuditLog, getAuditStats, getAuditContext, isValidAuditAction } from "./audit";
import { nanoidSchema } from "./api/validation";
import { createLogger } from "./logging";

const log = createLogger("web");

// Configuration
const PORT = parseInt(process.env.WEB_PORT || "3420");
const DATA_DIR = process.env.DATA_DIR || "./data";

// Custom error class for API errors
class APIError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400
  ) {
    super(message);
    this.name = "APIError";
  }
}

/**
 * Validate diagram ID format before database query
 * Uses nanoid schema (8-21 chars, URL-safe: A-Za-z0-9_-)
 * @throws APIError if format is invalid
 */
function validateDiagramId(id: string | undefined): string {
  if (!id?.trim()) {
    throw new APIError("INVALID_ID", "Diagram ID is required", 400);
  }
  const result = nanoidSchema.safeParse(id);
  if (!result.success) {
    throw new APIError(
      "INVALID_ID_FORMAT",
      "Invalid diagram ID format. Expected 8-21 alphanumeric characters with optional underscores or hyphens.",
      400
    );
  }
  return result.data;
}

const app = new Hono();

// CORS configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3420", "http://127.0.0.1:3420"];

// Maximum origin length to prevent DoS via oversized origin headers
const MAX_ORIGIN_LENGTH = 256;

/**
 * Check if origin is a localhost URL (without regex to prevent ReDoS)
 * Uses URL parsing for safe validation
 */
function isLocalhostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    // Only allow http/https protocols
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    // Check for localhost hostname (not regex, just string comparison)
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    // Invalid URL
    return false;
  }
}

// Log CORS configuration in development
if (process.env.NODE_ENV !== "production") {
  log.info("CORS allowed origins", { origins: ALLOWED_ORIGINS });
}

// Middleware
// Request context (must be first to track timing)
app.use("*", requestContext());

// Graceful shutdown middleware (rejects requests during shutdown)
app.use("*", shutdownMiddleware());

app.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin) return null;

      // Defense-in-depth: reject oversized origins to prevent DoS
      if (origin.length > MAX_ORIGIN_LENGTH) {
        log.warn("Rejected oversized origin", { length: origin.length });
        return null;
      }

      // Check if origin is in allowed list (O(n) but list is small)
      if (ALLOWED_ORIGINS.includes(origin)) {
        return origin;
      }

      // In development, also allow localhost with any port
      // Uses URL parsing instead of regex to prevent potential ReDoS
      if (process.env.NODE_ENV !== "production" && isLocalhostOrigin(origin)) {
        return origin;
      }

      // Origin not allowed
      return null;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposeHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "ETag"],
    credentials: true,
    maxAge: 86400, // 24 hours
  })
);
app.use("*", logger());

// Security headers
app.use("*", securityHeaders({
  isProduction: process.env.NODE_ENV === "production",
}));

// Response compression (only if CompressionStream is available)
// Note: CompressionStream is a Web API that may not be available in all runtimes
if (typeof globalThis.CompressionStream !== "undefined") {
  app.use("/api/*", responseCompression());
  log.info("Response compression enabled for API routes");
} else {
  log.info("CompressionStream not available, skipping compression");
}

// API-specific security headers (more restrictive)
app.use("/api/*", apiSecurityHeaders());

// Optional authentication - sets user context if valid token provided
// Endpoints that require auth use requireAuth() explicitly
app.use("/api/*", optionalAuth());

// Global error handler
app.onError((err, c) => {
  log.error("API error", { method: c.req.method, path: c.req.path, error: err instanceof Error ? err.message : String(err) });

  if (err instanceof APIError) {
    return errorResponse(c, err.code, err.message, err.status as 400 | 404 | 500);
  }

  if (err instanceof PermissionDeniedError) {
    return errorResponse(c, err.code, err.message, 403);
  }

  if (err instanceof TimeoutError) {
    return errorResponse(
      c,
      "REQUEST_TIMEOUT",
      `Operation timed out after ${Math.round(err.timeoutMs / 1000)}s`,
      408
    );
  }

  if (err instanceof CircuitBreakerError) {
    c.header("Retry-After", err.retryAfter.toString());
    return errorResponse(
      c,
      "SERVICE_UNAVAILABLE",
      err.message,
      503
    );
  }

  if (err instanceof SyntaxError) {
    return errorFromCode(c, ApiError.INVALID_JSON);
  }

  const details = process.env.NODE_ENV === "development" ? err.message : undefined;
  return errorFromCode(c, ApiError.INTERNAL_ERROR, undefined, details);
});

// 404 handler for API routes
app.notFound((c) => {
  if (c.req.path.startsWith("/api")) {
    return errorFromCode(
      c,
      ApiError.NOT_FOUND,
      `API endpoint not found: ${c.req.method} ${c.req.path}`
    );
  }
  return c.text("Not Found", 404);
});

// Health checks - comprehensive status for monitoring
app.get("/api/health", async (c) => {
  const health = await runHealthChecks();

  // Return appropriate status code based on health
  const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;

  return c.json(health, statusCode);
});

// Liveness probe - simple check if server is running
app.get("/api/health/live", (c) => c.json(livenessCheck()));

// Readiness probe - check if server is ready to accept traffic
app.get("/api/health/ready", async (c) => {
  const result = await readinessCheck();
  return c.json(result, result.ready ? 200 : 503);
});

// Prometheus metrics endpoint
app.get("/metrics", (c) => {
  // Update diagram count gauge before rendering
  const stats = storage.getStats();
  setDiagramCount(stats.diagramCount);

  c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return c.text(renderMetrics());
});

// =============================================================================
// Authentication Endpoints
// =============================================================================

/**
 * Generate a JWT token (development/testing only)
 * In production, tokens would be issued by an identity provider
 */
app.post("/api/auth/token", smallBodyLimit, async (c) => {
  // Only allow in non-production environments
  if (process.env.NODE_ENV === "production") {
    return errorFromCode(
      c,
      ApiError.FORBIDDEN,
      "Token generation endpoint is disabled in production"
    );
  }

  try {
    const body = await c.req.json();
    const { userId, role = "user", expiresInSeconds = 24 * 60 * 60 } = body;

    if (!userId || typeof userId !== "string") {
      return validationErrorResponse(c, "userId is required and must be a string");
    }

    if (!["admin", "user", "viewer"].includes(role)) {
      return validationErrorResponse(c, "role must be admin, user, or viewer");
    }

    const token = await signJWT(
      { sub: userId, role },
      { expiresInSeconds: Math.min(expiresInSeconds, 7 * 24 * 60 * 60) } // Max 7 days
    );

    return c.json({
      token,
      expiresIn: expiresInSeconds,
      tokenType: "Bearer",
    });
  } catch (err) {
    return errorResponse(
      c,
      "TOKEN_GENERATION_FAILED",
      err instanceof Error ? err.message : "Failed to generate token",
      500
    );
  }
});

/**
 * Get current authenticated user
 */
app.get("/api/auth/me", (c) => {
  const user = getCurrentUser(c);

  if (!user) {
    return c.json({
      authenticated: false,
      user: null,
    });
  }

  return c.json({
    authenticated: true,
    user: {
      id: user.id,
      role: user.role,
    },
  });
});

/**
 * Verify a token (for debugging)
 */
app.post("/api/auth/verify", smallBodyLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { token } = body;

    if (!token || typeof token !== "string") {
      return validationErrorResponse(c, "token is required and must be a string");
    }

    const result = await verifyJWT(token);

    if (!result.valid) {
      return c.json({
        valid: false,
        error: result.error,
      });
    }

    return c.json({
      valid: true,
      payload: {
        sub: result.payload!.sub,
        role: result.payload!.role,
        iss: result.payload!.iss,
        exp: result.payload!.exp,
        iat: result.payload!.iat,
      },
    });
  } catch (err) {
    return errorResponse(
      c,
      "VERIFICATION_FAILED",
      err instanceof Error ? err.message : "Failed to verify token",
      500
    );
  }
});

// =============================================================================
// Diagram Endpoints
// =============================================================================

// List diagrams with SQL-level pagination, sorting, search, and filtering
app.get("/api/diagrams", async (c) => {
  try {
    // Parse query parameters
    const project = c.req.query("project");
    const limitParam = c.req.query("limit");
    const offsetParam = c.req.query("offset");
    const sortBy = c.req.query("sortBy") as "createdAt" | "updatedAt" | "name" | undefined;
    const sortOrder = c.req.query("sortOrder") as "asc" | "desc" | undefined;
    const search = c.req.query("search");
    const typesParam = c.req.query("types"); // Comma-separated: "flowchart,architecture"
    // Default to minimal response (no spec) for better performance; use full=true for complete specs
    const includeFullSpec = c.req.query("full") === "true";

    // Date range filters (ISO 8601 format: YYYY-MM-DD or full timestamp)
    const createdAfter = c.req.query("createdAfter");
    const createdBefore = c.req.query("createdBefore");
    const updatedAfter = c.req.query("updatedAfter");
    const updatedBefore = c.req.query("updatedBefore");

    // Validate and parse parameters
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 100) : 50;
    const rawOffset = offsetParam ? Math.max(parseInt(offsetParam, 10), 0) : 0;
    const types = typesParam ? typesParam.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

    // Validate offset bounds to prevent memory issues with large offsets
    if (rawOffset > MAX_LIST_OFFSET) {
      return validationErrorResponse(
        c,
        `Offset cannot exceed ${MAX_LIST_OFFSET}. Use search filters to narrow results.`,
        { field: "offset", max: MAX_LIST_OFFSET, received: rawOffset }
      );
    }
    const offset = rawOffset;

    // Get user context for permission filtering and cache key
    const user = getCurrentUser(c);
    const userIdForCache = user?.id || "anonymous";

    // Build cache key from all parameters (including user for permission-filtered results)
    const cacheKey = `list:${userIdForCache}:${project || "all"}:${limit}:${offset}:${sortBy || "updatedAt"}:${sortOrder || "desc"}:${search || ""}:${types?.join(",") || ""}:${createdAfter || ""}:${createdBefore || ""}:${updatedAfter || ""}:${updatedBefore || ""}:${includeFullSpec}`;
    const cached = listCache.get(cacheKey);
    if (cached) {
      const etag = generateETag(cached);
      if (matchesETag(c.req.header("If-None-Match") ?? null, etag)) {
        return new Response(null, { status: 304 });
      }
      c.header("ETag", etag);
      c.header("X-Cache", "HIT");
      return c.json(cached);
    }

    // Use SQL-level pagination with permission filtering for better performance
    // Permission filtering at SQL level ensures accurate pagination and counts
    // Run independent queries in parallel for reduced latency
    const queryPromise = Promise.all([
      storage.listDiagramsPaginated({
        project,
        limit,
        offset,
        sortBy,
        sortOrder,
        search,
        types,
        createdAfter,
        createdBefore,
        updatedAfter,
        updatedBefore,
        // Pass userId for SQL-level permission filtering
        // null = anonymous user (sees only public), undefined = no filtering
        userId: user?.id ?? null,
      }),
      storage.listProjects(),
    ]).then(([result, projects]) => ({ ...result, projects }));

    const { data: diagrams, total, projects } = await withListTimeout(queryPromise);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    const hasNextPage = offset + limit < total;
    const hasPrevPage = offset > 0;

    const response = {
      count: diagrams.length,
      total,
      offset,
      limit,
      // Pagination helpers
      pagination: {
        currentPage,
        totalPages,
        hasNextPage,
        hasPrevPage,
        nextOffset: hasNextPage ? offset + limit : null,
        prevOffset: hasPrevPage ? Math.max(offset - limit, 0) : null,
      },
      // Query parameters echoed back (filters applied)
      filters: {
        project: project || null,
        sortBy: sortBy || "updatedAt",
        sortOrder: sortOrder || "desc",
        search: search || null,
        types: types || null,
        createdAfter: createdAfter || null,
        createdBefore: createdBefore || null,
        updatedAfter: updatedAfter || null,
        updatedBefore: updatedBefore || null,
      },
      diagrams: diagrams.map((d) => ({
        id: d.id,
        name: d.name,
        project: d.project,
        type: d.spec.type,
        // Default: minimal response with just nodeCount (better performance)
        // Use full=true query param to include complete spec
        ...(includeFullSpec
          ? { spec: d.spec }
          : { nodeCount: d.spec.nodes?.length ?? 0, edgeCount: d.spec.edges?.length ?? 0 }),
        // Return URL to thumbnail endpoint (client handles 404 for missing thumbnails)
        thumbnailUrl: `/api/diagrams/${d.id}/thumbnail`,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      projects,
    };

    // Cache and set ETag
    listCache.set(cacheKey, response);
    const etag = generateETag(response);
    c.header("ETag", etag);
    c.header("X-Cache", "MISS");
    c.header("Cache-Control", "private, max-age=30");

    return c.json(response);
  } catch (err) {
    // Handle timeout specifically with 408 Request Timeout
    if (err instanceof TimeoutError) {
      log.warn("List diagrams timed out", { timeoutMs: err.timeoutMs });
      return errorResponse(
        c,
        "REQUEST_TIMEOUT",
        `List operation timed out after ${Math.round(err.timeoutMs / 1000)}s. Try using more specific filters to narrow results.`,
        408
      );
    }
    throw new APIError("LIST_FAILED", "Failed to list diagrams", 500);
  }
});

// Get diagram with caching and version-based ETag for optimistic locking
app.get("/api/diagrams/:id", (c) => {
  try {
    // Validate ID format before DB query (prevents wasted queries on invalid IDs)
    const id = validateDiagramId(c.req.param("id"));

    // Get diagram first to check permissions
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Check read permission
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canRead(user, ownership)) {
      throw new PermissionDeniedError("read", id);
    }

    // Check cache (cache key includes user for user-specific responses)
    const cacheKey = `diagram:${id}`;
    const cached = diagramCache.get(cacheKey) as (typeof response) | undefined;
    if (cached && cached.version === diagram.version) {
      // Use version-based ETag for optimistic locking support
      const etag = `"v${cached.version}"`;
      if (c.req.header("If-None-Match") === etag) {
        return new Response(null, { status: 304 });
      }
      c.header("ETag", etag);
      c.header("X-Cache", "HIT");
      return c.json(cached);
    }

    // Add complexity info for client-side optimization decisions
    const complexity = getSpecComplexity(diagram.spec);

    const response = {
      ...diagram,
      complexity,
    };

    // Cache the response
    diagramCache.set(cacheKey, response);
    // Use version-based ETag for optimistic locking support
    // Clients can pass this ETag value in If-Match header when updating
    const etag = `"v${diagram.version}"`;
    c.header("ETag", etag);
    c.header("X-Cache", "MISS");
    c.header("Cache-Control", "private, max-age=60");

    return c.json(response);
  } catch (err) {
    if (err instanceof APIError) throw err;
    if (err instanceof PermissionDeniedError) throw err;
    throw new APIError("GET_FAILED", "Failed to get diagram", 500);
  }
});

// Create diagram (rate limited, body size limited)
// Optionally accepts isPublic field - diagrams are private by default
app.post("/api/diagrams", rateLimiters.diagramCreate, diagramBodyLimit, async (c) => {
  try {
    const rawBody = await c.req.json<{
      name: string;
      project?: string;
      spec: DiagramSpec;
      isPublic?: boolean;
    }>();

    // Validate request body with schema
    const parseResult = CreateDiagramRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw new APIError("VALIDATION_ERROR", parseResult.error.issues[0]?.message || "Invalid diagram request", 400);
    }
    const body = parseResult.data;

    // Get authenticated user (optional - allows anonymous diagram creation)
    const user = getCurrentUser(c);

    const diagram = storage.createDiagram(
      body.name.trim(),
      body.project?.trim() || "default",
      body.spec,
      {
        ownerId: user?.id ?? null, // Associate with user if authenticated
        isPublic: body.isPublic ?? false,
      }
    );

    // Audit log the creation
    audit("diagram.create", user, diagram.id, {
      name: diagram.name,
      project: diagram.project,
      type: diagram.spec.type,
      isPublic: body.isPublic ?? false,
    }, getAuditContext(c.req.raw));

    // Invalidate list cache (new diagram added)
    listCache.invalidatePattern(/^list:/);

    // Return 201 Created with Location header per REST convention
    c.header("Location", `/api/diagrams/${diagram.id}`);
    return c.json(diagram, 201);
  } catch (err) {
    log.error("Create diagram failed", { error: err instanceof Error ? err.message : String(err) });
    if (err instanceof SyntaxError) {
      return errorFromCode(c, ApiError.INVALID_JSON);
    }
    return errorFromCode(c, ApiError.CREATE_FAILED);
  }
});

// Update diagram with optimistic locking (body size limited)
// REQUIRES If-Match header for version checking - returns 409 Conflict if versions don't match
// Use force: true in body to bypass version checking (use with caution in collaboration scenarios)
app.put("/api/diagrams/:id", diagramBodyLimit, async (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const rawBody = await c.req.json<{ spec: DiagramSpec; message?: string; force?: boolean }>();

    // Validate request body with schema
    const parseResult = UpdateDiagramRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw new APIError("VALIDATION_ERROR", parseResult.error.issues[0]?.message || "Invalid update request", 400);
    }
    // Keep raw body for force flag (not in schema)
    const body = { ...parseResult.data, force: rawBody.force };

    // Check diagram exists and permissions
    const existing = storage.getDiagram(id);
    if (!existing) {
      return notFoundResponse(c, "Diagram", id);
    }

    // Check write permission
    const user = getCurrentUser(c);
    const ownership = parseOwnership(existing);
    if (!canWrite(user, ownership)) {
      throw new PermissionDeniedError("write", id);
    }

    // Check If-Match header for optimistic locking
    const ifMatch = c.req.header("If-Match");
    let baseVersion: number | undefined;

    if (ifMatch) {
      // Parse version from ETag format: "v{version}" or just the version number
      const versionMatch = ifMatch.replace(/"/g, "").match(/^v?(\d+)$/);
      const versionStr = versionMatch?.[1];
      if (!versionMatch || !versionStr) {
        return validationErrorResponse(
          c,
          "Invalid If-Match header format. Expected \"v{version}\" or \"{version}\""
        );
      }
      baseVersion = parseInt(versionStr, 10);
    }

    // Require version checking unless explicitly forced
    // This prevents silent data loss in collaboration scenarios
    if (baseVersion === undefined && !body.force) {
      return c.json({
        error: {
          code: "VERSION_REQUIRED",
          message: "If-Match header with version is required for safe updates. Use force: true in body to override (may lose concurrent changes).",
          hint: "First GET the diagram to obtain its version, then include If-Match: \"v{version}\" header",
        },
      }, 428); // 428 Precondition Required
    }

    // Invalidate cache BEFORE update for stronger consistency
    // This ensures no stale data is served between DB update and invalidation
    // Trade-off: unnecessary cache miss if update fails (acceptable for consistency)
    diagramCache.delete(`diagram:${id}`);
    listCache.invalidatePattern(/^list:/);

    // Perform update with optional optimistic locking
    const result = storage.updateDiagram(id, body.spec, body.message, baseVersion);

    // Handle not found (shouldn't happen after our check above, but defensive)
    if (result === null) {
      return notFoundResponse(c, "Diagram", id);
    }

    // Handle version conflict (409 needs custom error response - not in standard helpers)
    if (typeof result === "object" && "conflict" in result) {
      return c.json({
        error: {
          code: "VERSION_CONFLICT",
          message: `Version conflict: expected version ${baseVersion}, but current version is ${result.currentVersion}`,
          details: { currentVersion: result.currentVersion },
        },
      }, 409);
    }

    // Audit log the update
    audit("diagram.update", user, id, {
      message: body.message,
      version: result.version,
    }, getAuditContext(c.req.raw));

    // Broadcast update to collaborators
    broadcastDiagramSync(id, body.spec);

    // Set ETag header with new version for subsequent requests
    c.header("ETag", `"v${result.version}"`);

    return c.json(result);
  } catch (err) {
    log.error("Update diagram failed", { error: err instanceof Error ? err.message : String(err) });
    if (err instanceof PermissionDeniedError) throw err;
    if (err instanceof SyntaxError) {
      return errorFromCode(c, ApiError.INVALID_JSON);
    }
    return errorFromCode(c, ApiError.UPDATE_FAILED);
  }
});

// Delete diagram
app.delete("/api/diagrams/:id", async (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));

    // Check diagram exists and permissions
    const existing = storage.getDiagram(id);
    if (!existing) {
      return notFoundResponse(c, "Diagram", id);
    }

    // Check delete permission (only owner or admin)
    const user = getCurrentUser(c);
    const ownership = parseOwnership(existing);
    if (!canDelete(user, ownership)) {
      throw new PermissionDeniedError("delete", id);
    }

    // Invalidate caches BEFORE delete for stronger consistency
    diagramCache.delete(`diagram:${id}`);
    listCache.invalidatePattern(/^list:/);
    // Clean up any cached SVG exports for this diagram
    // Use escapeRegex for defense-in-depth (even though nanoid validation prevents special chars)
    svgCache.invalidatePattern(new RegExp(`^svg:${escapeRegex(id)}:`));

    const deleted = await storage.deleteDiagram(id);
    if (!deleted) {
      return notFoundResponse(c, "Diagram", id);
    }

    // Audit log the deletion
    audit("diagram.delete", user, id, {
      name: existing.name,
      project: existing.project,
    }, getAuditContext(c.req.raw));

    return operationResponse(c, true);
  } catch (err) {
    if (err instanceof PermissionDeniedError) throw err;
    log.error("Delete diagram failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.DELETE_FAILED);
  }
});

// Update diagram thumbnail (saves to filesystem, body size limited)
app.put("/api/diagrams/:id/thumbnail", thumbnailBodyLimit, async (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const rawBody = await c.req.json<{ thumbnail: string }>();

    // Validate request body with schema (validates format and size limit)
    const parseResult = UpdateThumbnailRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw new APIError("VALIDATION_ERROR", parseResult.error.issues[0]?.message || "Invalid thumbnail request", 400);
    }
    const body = parseResult.data;

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      return notFoundResponse(c, "Diagram", id);
    }

    // Check write permission
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canWrite(user, ownership)) {
      throw new PermissionDeniedError("write", id);
    }

    const success = await storage.updateThumbnail(id, body.thumbnail);

    // Audit log the thumbnail update (only on success)
    if (success) {
      audit("diagram.thumbnail_update", user, id, {}, getAuditContext(c.req.raw));
    }

    return operationResponse(c, success);
  } catch (err) {
    if (err instanceof PermissionDeniedError) throw err;
    log.error("Update thumbnail failed", { error: err instanceof Error ? err.message : String(err) });
    if (err instanceof SyntaxError) {
      return errorFromCode(c, ApiError.INVALID_JSON);
    }
    return errorFromCode(c, ApiError.THUMBNAIL_FAILED);
  }
});

// Get diagram thumbnail (serves from filesystem)
app.get("/api/diagrams/:id/thumbnail", async (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));

    // Check if diagram exists
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      return notFoundResponse(c, "Diagram", id);
    }

    // Check read permission
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canRead(user, ownership)) {
      throw new PermissionDeniedError("read", id);
    }

    // Load thumbnail from filesystem
    const dataUrl = await storage.loadThumbnail(id);
    if (!dataUrl) {
      return notFoundResponse(c, "Thumbnail");
    }

    // Convert data URL to binary response for efficient caching
    const matches = dataUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    const base64Data = matches?.[2];
    if (!matches || !base64Data) {
      return errorFromCode(c, ApiError.INVALID_THUMBNAIL);
    }

    const buffer = Buffer.from(base64Data, "base64");
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
    });
  } catch (err) {
    log.error("Load thumbnail failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.THUMBNAIL_LOAD_FAILED);
  }
});

// Get versions
app.get("/api/diagrams/:id/versions", (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    // Check if diagram exists
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Check read permission
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canRead(user, ownership)) {
      throw new PermissionDeniedError("read", id);
    }

    const versions = storage.getVersions(id);
    return c.json({ versions, count: versions.length });
  } catch (err) {
    if (err instanceof APIError) throw err;
    if (err instanceof PermissionDeniedError) throw err;
    throw new APIError("VERSIONS_FAILED", "Failed to get diagram versions", 500);
  }
});

// Get specific version
app.get("/api/diagrams/:id/versions/:version", (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const versionParam = c.req.param("version");

    if (!versionParam?.trim()) {
      throw new APIError("INVALID_VERSION", "Version number is required", 400);
    }

    const versionNum = parseInt(versionParam, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      throw new APIError("INVALID_VERSION", "Version must be a positive integer", 400);
    }

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Check read permission
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canRead(user, ownership)) {
      throw new PermissionDeniedError("read", id);
    }

    const version = storage.getVersion(id, versionNum);
    if (!version) {
      throw new APIError("VERSION_NOT_FOUND", `Version ${versionNum} not found`, 404);
    }

    return c.json(version);
  } catch (err) {
    if (err instanceof APIError) throw err;
    throw new APIError("VERSION_GET_FAILED", "Failed to get version", 500);
  }
});

// Restore to specific version (rate limited - modifies diagram)
app.post("/api/diagrams/:id/restore/:version", rateLimiters.layout, async (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const versionParam = c.req.param("version");

    if (!versionParam?.trim()) {
      throw new APIError("INVALID_VERSION", "Version number is required", 400);
    }

    const versionNum = parseInt(versionParam, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      throw new APIError("INVALID_VERSION", "Version must be a positive integer", 400);
    }

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Check write permission (restore is a form of update)
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canWrite(user, ownership)) {
      throw new PermissionDeniedError("write", id);
    }

    const targetVersion = storage.getVersion(id, versionNum);
    if (!targetVersion) {
      throw new APIError("VERSION_NOT_FOUND", `Version ${versionNum} not found`, 404);
    }

    // Invalidate caches BEFORE the update for stronger consistency
    diagramCache.delete(`diagram:${id}`);
    listCache.invalidatePattern(/^list:/);
    svgCache.invalidatePattern(new RegExp(`^svg:${escapeRegex(id)}:`));

    const restored = storage.restoreVersion(id, versionNum);
    if (!restored) {
      throw new APIError("RESTORE_FAILED", "Failed to restore version", 500);
    }

    // Audit log the restore
    audit("diagram.restore", user, id, {
      restoredToVersion: versionNum,
      previousVersion: diagram.version,
      newVersion: restored.version,
    }, getAuditContext(c.req.raw));

    log.info("Restored diagram", { diagramId: id, version: versionNum });
    c.header("Location", `/api/diagrams/${id}`);
    return c.json({
      success: true,
      diagram: restored,
      message: `Restored to version ${versionNum}`,
    }, 201);
  } catch (err) {
    if (err instanceof APIError) throw err;
    if (err instanceof PermissionDeniedError) throw err;
    log.error("Restore version failed", { error: err instanceof Error ? err.message : String(err) });
    throw new APIError("RESTORE_FAILED", "Failed to restore version", 500);
  }
});

// Diff between two versions
app.get("/api/diagrams/:id/diff", (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const v1Param = c.req.query("v1");
    const v2Param = c.req.query("v2");

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Check read permission
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canRead(user, ownership)) {
      throw new PermissionDeniedError("read", id);
    }

    // Default: compare with latest if only v1 provided, or compare consecutive versions
    let version1: ReturnType<typeof storage.getVersion>;
    let version2: ReturnType<typeof storage.getVersion>;

    if (v1Param && v2Param) {
      const v1 = parseInt(v1Param, 10);
      const v2 = parseInt(v2Param, 10);
      if (isNaN(v1) || isNaN(v2) || v1 < 1 || v2 < 1) {
        throw new APIError("INVALID_VERSION", "Version numbers must be positive integers", 400);
      }
      version1 = storage.getVersion(id, v1);
      version2 = storage.getVersion(id, v2);
    } else if (v1Param) {
      // Compare v1 with current
      const v1 = parseInt(v1Param, 10);
      if (isNaN(v1) || v1 < 1) {
        throw new APIError("INVALID_VERSION", "Version number must be a positive integer", 400);
      }
      version1 = storage.getVersion(id, v1);
      version2 = storage.getLatestVersion(id);
    } else {
      // Compare last two versions
      const versions = storage.getVersions(id);
      if (versions.length < 2) {
        return c.json({
          hasChanges: false,
          summary: "Only one version exists",
          diff: null,
        });
      }
      version2 = versions[0] ?? null; // Latest
      version1 = versions[1] ?? null; // Previous
    }

    if (!version1) {
      throw new APIError("VERSION_NOT_FOUND", "First version not found", 404);
    }
    if (!version2) {
      throw new APIError("VERSION_NOT_FOUND", "Second version not found", 404);
    }

    const diff = diffSpecs(version1.spec, version2.spec);
    const changelog = generateChangelog(diff);

    return c.json({
      v1: version1.version,
      v2: version2.version,
      diff,
      changelog,
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    log.error("Calculate diff failed", { error: err instanceof Error ? err.message : String(err) });
    throw new APIError("DIFF_FAILED", "Failed to calculate diff", 500);
  }
});

// Fork/branch a diagram (rate limited - creates new diagram)
app.post("/api/diagrams/:id/fork", rateLimiters.diagramCreate, async (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));

    const rawBody = await c.req.json<{ name?: string; project?: string }>();

    // Validate request body
    const parseResult = ForkDiagramRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw new APIError("VALIDATION_ERROR", parseResult.error.issues[0]?.message || "Invalid request", 400);
    }
    const body = parseResult.data;

    const original = storage.getDiagram(id);
    if (!original) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Check read permission on original (need to read to fork)
    const user = getCurrentUser(c);
    const ownership = parseOwnership(original);
    if (!canRead(user, ownership)) {
      throw new PermissionDeniedError("read", id);
    }

    const newName = body.name || `${original.name} (fork)`;
    const project = body.project || original.project;

    const forked = storage.forkDiagram(id, newName, project);
    if (!forked) {
      throw new APIError("FORK_FAILED", "Failed to fork diagram", 500);
    }

    // Invalidate list cache (new diagram added)
    listCache.invalidatePattern(/^list:/);

    // Audit log the fork
    audit("diagram.fork", user, forked.id, {
      originalId: id,
      originalName: original.name,
      newName: forked.name,
      project: forked.project,
    }, getAuditContext(c.req.raw));

    log.info("Forked diagram", { originalId: id, newId: forked.id });
    c.header("Location", `/api/diagrams/${forked.id}`);
    return c.json({
      success: true,
      diagram: forked,
      originalId: id,
    }, 201);
  } catch (err) {
    if (err instanceof APIError) throw err;
    if (err instanceof PermissionDeniedError) throw err;
    log.error("Fork diagram failed", { error: err instanceof Error ? err.message : String(err) });
    if (err instanceof SyntaxError) {
      throw new APIError("INVALID_JSON", "Invalid JSON in request body", 400);
    }
    throw new APIError("FORK_FAILED", "Failed to fork diagram", 500);
  }
});

// Get version timeline with diffs (useful for history UI)
app.get("/api/diagrams/:id/timeline", (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const limitParam = c.req.query("limit");
    const offsetParam = c.req.query("offset");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : 20;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Load limit + 1 versions to compute diffs (need previous version for comparison)
    // Uses SQL-level pagination for efficiency
    const { versions, total } = storage.getVersionsPaginated(id, limit + 1, offset);

    // Calculate diff summaries for each version (up to limit)
    const timeline = versions.slice(0, limit).map((version, i) => {
      // Check if this is the very first version (lowest version number in DB)
      const isFirstEverVersion = version.version === 1;
      const hasNextInBatch = i + 1 < versions.length;

      if (isFirstEverVersion || !hasNextInBatch) {
        // First version or no previous version in batch - no diff to compute
        return {
          version: version.version,
          message: version.message,
          createdAt: version.createdAt,
          summary: isFirstEverVersion ? "Initial version" : "...",
          hasChanges: false,
        };
      }

      const previousVersion = versions[i + 1];
      // This guard is technically unnecessary (we checked hasNextInBatch) but satisfies TypeScript
      if (!previousVersion) {
        return {
          version: version.version,
          message: version.message,
          createdAt: version.createdAt,
          summary: "...",
          hasChanges: false,
        };
      }
      const diff = diffSpecs(previousVersion.spec, version.spec);

      return {
        version: version.version,
        message: version.message,
        createdAt: version.createdAt,
        summary: diff.summary,
        hasChanges: diff.hasChanges,
        stats: diff.stats,
      };
    });

    return c.json({
      diagramId: id,
      diagramName: diagram.name,
      timeline,
      totalVersions: total,
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    log.error("Get timeline failed", { error: err instanceof Error ? err.message : String(err) });
    throw new APIError("TIMELINE_FAILED", "Failed to get timeline", 500);
  }
});

// List projects
app.get("/api/projects", (c) => {
  try {
    const projects = storage.listProjects();
    return c.json({ projects, count: projects.length });
  } catch (err) {
    throw new APIError("PROJECTS_FAILED", "Failed to list projects", 500);
  }
});

// List agents
app.get("/api/agents", async (c) => {
  try {
    const refresh = c.req.query("refresh") === "true";
    const agents = await loadAgents(refresh);
    return c.json({
      count: agents.length,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        type: a.type,
      })),
    });
  } catch (err) {
    log.error("Load agents failed", { error: err instanceof Error ? err.message : String(err) });
    throw new APIError("AGENTS_FAILED", "Failed to load agents", 500);
  }
});

// Get specific agent
app.get("/api/agents/:id", async (c) => {
  try {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Agent ID is required", 400);
    }
    const agent = await getAgent(id);
    if (!agent) {
      throw new APIError("NOT_FOUND", "Agent not found", 404);
    }
    return c.json(agent);
  } catch (err) {
    if (err instanceof APIError) throw err;
    throw new APIError("AGENT_GET_FAILED", "Failed to get agent", 500);
  }
});

// Performance stats endpoint (admin only - exposes internal metrics)
app.get("/api/performance/stats", rateLimiters.admin, requireAuth(), (c) => {
  try {
    const user = getCurrentUser(c);
    if (user?.role !== "admin") {
      return errorFromCode(c, ApiError.ADMIN_REQUIRED);
    }

    const diagramStats = diagramCache.getStats();
    const listStats = listCache.getStats();
    const svgStats = svgCache.getStats();

    const totalEntries = diagramStats.entries + listStats.entries + svgStats.entries;
    const totalSize = diagramStats.sizeBytes + listStats.sizeBytes + svgStats.sizeBytes;
    const totalHits = diagramStats.hits + listStats.hits + svgStats.hits;
    const totalMisses = diagramStats.misses + listStats.misses + svgStats.misses;

    return c.json({
      cache: {
        diagrams: diagramStats,
        lists: listStats,
        svg: svgStats,
        total: {
          entries: totalEntries,
          sizeBytes: totalSize,
          sizeMB: (totalSize / 1024 / 1024).toFixed(2),
          hits: totalHits,
          misses: totalMisses,
          hitRate: (totalHits / Math.max(1, totalHits + totalMisses)).toFixed(3),
        },
      },
      memory: {
        heapUsed: process.memoryUsage?.()?.heapUsed ?? 0,
        heapTotal: process.memoryUsage?.()?.heapTotal ?? 0,
        rss: process.memoryUsage?.()?.rss ?? 0,
      },
      uptime: process.uptime?.() ?? 0,
    });
  } catch (err) {
    log.error("Get performance stats failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.STATS_FAILED);
  }
});

// Clear caches (admin only - destructive operation)
app.post("/api/performance/clear-cache", rateLimiters.admin, requireAuth(), (c) => {
  try {
    const user = getCurrentUser(c);
    if (user?.role !== "admin") {
      return errorFromCode(c, ApiError.ADMIN_REQUIRED);
    }

    diagramCache.clear();
    listCache.clear();
    svgCache.clear();
    log.info("All caches cleared", { caches: ["diagrams", "lists", "svg"] });
    return operationResponse(c, true, "All caches cleared");
  } catch (err) {
    log.error("Clear cache failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.CACHE_CLEAR_FAILED);
  }
});

// ==================== Audit Log Endpoints ====================

// Get audit log (admin only)
app.get("/api/audit", rateLimiters.admin, requireAuth(), (c) => {
  try {
    const user = getCurrentUser(c);

    // Only admins can view audit log
    if (user?.role !== "admin") {
      return errorFromCode(c, ApiError.ADMIN_REQUIRED);
    }

    const limitParam = c.req.query("limit");
    const userId = c.req.query("userId");
    const actionParam = c.req.query("action");
    const resourceId = c.req.query("resourceId");
    const sinceParam = c.req.query("since");

    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 50;
    let since: Date | undefined;
    if (sinceParam) {
      since = new Date(sinceParam);
      if (isNaN(since.getTime())) {
        return validationErrorResponse(c, "Invalid date format for 'since' parameter. Use ISO 8601 format.");
      }
    }

    // Validate action parameter if provided
    const action = actionParam && isValidAuditAction(actionParam) ? actionParam : undefined;
    if (actionParam && !action) {
      return errorFromCode(c, ApiError.INVALID_ACTION, `Invalid audit action: ${actionParam}`);
    }

    const entries = getAuditLog({
      limit,
      userId: userId || undefined,
      action,
      resourceId: resourceId || undefined,
      since,
    });

    return c.json({
      entries,
      count: entries.length,
    });
  } catch (err) {
    log.error("Get audit log failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.AUDIT_FAILED);
  }
});

// Get audit stats (admin only)
app.get("/api/audit/stats", rateLimiters.admin, requireAuth(), (c) => {
  try {
    const user = getCurrentUser(c);

    // Only admins can view audit stats
    if (user?.role !== "admin") {
      return errorFromCode(c, ApiError.ADMIN_REQUIRED);
    }

    const stats = getAuditStats();
    return c.json(stats);
  } catch (err) {
    log.error("Get audit stats failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.AUDIT_STATS_FAILED);
  }
});

// ==================== Collaboration Endpoints ====================

// Get collaboration stats (admin only - exposes internal metrics)
app.get("/api/collab/stats", rateLimiters.admin, requireAuth(), (c) => {
  try {
    const user = getCurrentUser(c);
    if (user?.role !== "admin") {
      return errorFromCode(c, ApiError.ADMIN_REQUIRED);
    }

    const stats = getCollabStats();
    return c.json(stats);
  } catch (err) {
    log.error("Get collab stats failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.COLLAB_STATS_FAILED);
  }
});

// Get room info for a diagram
app.get("/api/collab/rooms/:diagramId", (c) => {
  try {
    const diagramId = validateDiagramId(c.req.param("diagramId"));

    const roomInfo = getRoomInfo(diagramId);
    if (!roomInfo) {
      return c.json({
        diagramId,
        participants: [],
        version: 0,
        active: false,
      });
    }

    return c.json({
      ...roomInfo,
      active: true,
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    log.error("Get room info failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.ROOM_INFO_FAILED);
  }
});

// ==================== Diagram Types Endpoints ====================

// List all diagram types
app.get("/api/diagram-types", (c) => {
  try {
    const types = listDiagramTypes();
    return c.json({ types, count: types.length });
  } catch (err) {
    log.error("List diagram types failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.LIST_TYPES_FAILED);
  }
});

// Get info for specific diagram type
app.get("/api/diagram-types/:type", (c) => {
  try {
    const typeParam = c.req.param("type");
    if (!typeParam || !VALID_DIAGRAM_TYPES.has(typeParam)) {
      throw new APIError("INVALID_TYPE", `Invalid diagram type: ${typeParam}`, 400);
    }
    const type = typeParam as DiagramType;
    const info = getDiagramTypeInfo(type);
    return c.json(info);
  } catch (err) {
    if (err instanceof APIError) throw err;
    log.error("Get diagram type info failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.TYPE_INFO_FAILED);
  }
});

// Get starter template for diagram type
app.get("/api/diagram-types/:type/template", (c) => {
  try {
    const typeParam = c.req.param("type");
    if (!typeParam || !VALID_DIAGRAM_TYPES.has(typeParam)) {
      throw new APIError("INVALID_TYPE", `Invalid diagram type: ${typeParam}`, 400);
    }
    const type = typeParam as DiagramType;
    const template = getDiagramTemplate(type);
    return c.json({ template });
  } catch (err) {
    if (err instanceof APIError) throw err;
    log.error("Get diagram template failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.TEMPLATE_FAILED);
  }
});

// Export diagram to Mermaid format
app.get("/api/diagrams/:id/export/mermaid", (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Check read permission (required for export)
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canRead(user, ownership)) {
      throw new PermissionDeniedError("read", id);
    }

    const mermaid = exportToMermaid(diagram.spec);

    // Return as plain text for easy copy/paste
    c.header("Content-Type", "text/plain");
    return c.text(mermaid);
  } catch (err) {
    if (err instanceof APIError) throw err;
    if (err instanceof PermissionDeniedError) throw err;
    log.error("Mermaid export failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.MERMAID_EXPORT_FAILED);
  }
});

// Get supported export formats
app.get("/api/export-formats", (c) => {
  try {
    const formats = getSupportedExportFormats();
    return c.json({ formats, count: formats.length });
  } catch (err) {
    log.error("Get export formats failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.FORMATS_FAILED);
  }
});

// Get LLM provider status (admin only - reveals configuration)
app.get("/api/llm/status", rateLimiters.admin, requireAuth(), async (c) => {
  try {
    const user = getCurrentUser(c);
    if (user?.role !== "admin") {
      return errorFromCode(c, ApiError.ADMIN_REQUIRED);
    }

    const registry = getProviderRegistry();
    const status = await registry.getStatus();
    const configured = listConfiguredProviders();

    return c.json({
      configured: configured.map((p) => ({
        type: p.type,
        name: p.name,
      })),
      status,
      defaultProvider: registry.getDefault()?.type || null,
    });
  } catch (err) {
    log.error("Get LLM status failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.LLM_STATUS_ERROR);
  }
});

// List available themes
app.get("/api/themes", (c) => {
  try {
    const themes = listThemes().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      mode: t.mode,
    }));
    return c.json({ themes, count: themes.length });
  } catch (err) {
    throw new APIError("THEMES_FAILED", "Failed to list themes", 500);
  }
});

// Get theme details
app.get("/api/themes/:id", (c) => {
  try {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Theme ID is required", 400);
    }
    const theme = getTheme(id);
    if (!theme) {
      throw new APIError("NOT_FOUND", "Theme not found", 404);
    }
    return c.json(theme);
  } catch (err) {
    if (err instanceof APIError) throw err;
    throw new APIError("THEME_GET_FAILED", "Failed to get theme", 500);
  }
});

// Get theme CSS
app.get("/api/themes/:id/css", (c) => {
  try {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Theme ID is required", 400);
    }
    const theme = getTheme(id);
    if (!theme) {
      throw new APIError("NOT_FOUND", "Theme not found", 404);
    }
    const css = generateStyledCSS(theme);
    c.header("Content-Type", "text/css");
    c.header("Cache-Control", "public, max-age=3600");
    return c.text(css);
  } catch (err) {
    if (err instanceof APIError) throw err;
    throw new APIError("THEME_CSS_FAILED", "Failed to generate theme CSS", 500);
  }
});

// List available layout algorithms
app.get("/api/layouts", (c) => {
  try {
    const algorithms = listLayoutAlgorithms();
    return c.json({ algorithms, count: algorithms.length });
  } catch (err) {
    throw new APIError("LAYOUTS_FAILED", "Failed to list layout algorithms", 500);
  }
});

// Apply layout to diagram (rate limited)
app.post("/api/diagrams/:id/apply-layout", rateLimiters.layout, async (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const rawBody = await c.req.json<{
      algorithm: LayoutAlgorithm;
      direction?: "DOWN" | "RIGHT" | "UP" | "LEFT";
      spacing?: { nodeSpacing?: number; edgeSpacing?: number; layerSpacing?: number };
      padding?: number;
    }>();

    // Validate request body with schema
    const parseResult = ApplyLayoutRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw new APIError("VALIDATION_ERROR", parseResult.error.issues[0]?.message || "Invalid layout request", 400);
    }
    const body = parseResult.data;

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("DIAGRAM_NOT_FOUND", "Diagram not found", 404);
    }

    // Check write permission
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canWrite(user, ownership)) {
      throw new PermissionDeniedError("write", id);
    }

    const options: LayoutOptions = {
      algorithm: body.algorithm,
      direction: body.direction,
      spacing: body.spacing,
      padding: body.padding,
    };

    const result = await withTimeout(
      layoutDiagram(diagram.spec, options),
      TIMEOUTS.LAYOUT,
      "Layout calculation"
    );

    if (!result.success) {
      throw new APIError("LAYOUT_FAILED", result.error || "Layout failed", 400);
    }

    // Invalidate caches BEFORE update for stronger consistency
    diagramCache.delete(`diagram:${id}`);
    listCache.invalidatePattern(/^list:/);
    svgCache.invalidatePattern(new RegExp(`^svg:${escapeRegex(id)}:`));

    // Update diagram with new positions using safe transform (handles conflicts)
    const updateResult = storage.transformDiagram(
      id,
      () => result.spec!,
      `Applied layout: ${body.algorithm}`
    );

    if (updateResult && "error" in updateResult) {
      throw new APIError(
        "CONCURRENT_MODIFICATION",
        "Diagram was modified by another user. Please refresh and try again.",
        409
      );
    }

    const updated = updateResult;

    // Audit log the layout application
    audit("diagram.apply_layout", user, id, {
      algorithm: body.algorithm,
      direction: body.direction,
      duration: result.duration,
    }, getAuditContext(c.req.raw));

    // Broadcast to collaborators
    broadcastDiagramSync(id, result.spec!);

    return c.json({
      success: true,
      diagram: updated,
      duration: result.duration,
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    if (err instanceof PermissionDeniedError) throw err;
    if (err instanceof TimeoutError) {
      throw new APIError("LAYOUT_TIMEOUT", err.message, 504);
    }
    log.error("Apply layout failed", { error: err instanceof Error ? err.message : String(err) });
    throw new APIError("LAYOUT_ERROR", "Failed to apply layout", 500);
  }
});

// Preview layout (returns positions without saving, rate limited)
app.post("/api/diagrams/:id/preview-layout", rateLimiters.layout, async (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const rawBody = await c.req.json<{
      algorithm: LayoutAlgorithm;
      direction?: "DOWN" | "RIGHT" | "UP" | "LEFT";
      spacing?: { nodeSpacing?: number; edgeSpacing?: number; layerSpacing?: number };
      padding?: number;
    }>();

    // Validate request body with schema
    const parseResult = ApplyLayoutRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw new APIError("VALIDATION_ERROR", parseResult.error.issues[0]?.message || "Invalid layout request", 400);
    }
    const body = parseResult.data;

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("DIAGRAM_NOT_FOUND", "Diagram not found", 404);
    }

    const options: LayoutOptions = {
      algorithm: body.algorithm,
      direction: body.direction,
      spacing: body.spacing,
      padding: body.padding,
    };

    const result = await withTimeout(
      layoutDiagram(diagram.spec, options),
      TIMEOUTS.LAYOUT,
      "Layout preview"
    );

    if (!result.success) {
      throw new APIError("LAYOUT_FAILED", result.error || "Layout failed", 400);
    }

    return c.json({
      success: true,
      spec: result.spec,
      duration: result.duration,
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    if (err instanceof TimeoutError) {
      throw new APIError("LAYOUT_TIMEOUT", err.message, 504);
    }
    log.error("Preview layout failed", { error: err instanceof Error ? err.message : String(err) });
    throw new APIError("LAYOUT_ERROR", "Failed to preview layout", 500);
  }
});

// Apply theme to diagram (rate limited - modifies diagram)
app.post("/api/diagrams/:id/apply-theme", rateLimiters.layout, async (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const rawBody = await c.req.json<{ themeId: string }>();

    // Validate request body with schema
    const parseResult = ApplyThemeRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw new APIError("VALIDATION_ERROR", parseResult.error.issues[0]?.message || "Invalid theme request", 400);
    }
    const body = parseResult.data;

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      return notFoundResponse(c, "Diagram", id);
    }

    // Check write permission
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canWrite(user, ownership)) {
      throw new PermissionDeniedError("write", id);
    }

    const themeId = body.themeId;

    // Invalidate caches BEFORE update for stronger consistency
    diagramCache.delete(`diagram:${id}`);
    listCache.invalidatePattern(/^list:/);
    svgCache.invalidatePattern(new RegExp(`^svg:${escapeRegex(id)}:`));

    // Use safe transform to handle concurrent modifications
    const updateResult = storage.transformDiagram(
      id,
      (currentSpec) => applyThemeToDiagram(currentSpec, themeId),
      `Applied theme: ${themeId}`
    );

    if (updateResult === null) {
      return notFoundResponse(c, "Diagram", id);
    }

    if ("error" in updateResult) {
      return errorResponse(
        c,
        "CONCURRENT_MODIFICATION",
        "Diagram was modified by another user. Please refresh and try again.",
        409
      );
    }

    const themedSpec = updateResult.spec;
    const updated = updateResult;

    // Audit log the theme application
    audit("diagram.apply_theme", user, id, {
      themeId,
    }, getAuditContext(c.req.raw));

    // Broadcast to collaborators
    broadcastDiagramSync(id, themedSpec);

    return c.json({
      success: true,
      diagram: updated,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError) throw err;
    log.error("Apply theme failed", { error: err instanceof Error ? err.message : String(err) });
    return errorFromCode(c, ApiError.THEME_APPLY_FAILED);
  }
});

// Run agent on diagram (rate limited - expensive operation)
app.post("/api/diagrams/:diagramId/run-agent/:agentId", rateLimiters.agentRun, async (c) => {
  try {
    const diagramId = validateDiagramId(c.req.param("diagramId"));
    const agentId = c.req.param("agentId");

    const diagram = storage.getDiagram(diagramId);
    if (!diagram) {
      return notFoundResponse(c, "Diagram", diagramId);
    }

    // Check write permission (running agent modifies diagram)
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canWrite(user, ownership)) {
      throw new PermissionDeniedError("write", diagramId);
    }

    const agent = await getAgent(agentId);
    if (!agent) {
      return notFoundResponse(c, "Agent", agentId);
    }

    const result = await withTimeout(
      runAgent(agent, diagram.spec),
      TIMEOUTS.AGENT,
      `Agent execution: ${agent.name}`
    );

    if (result.success && result.spec) {
      // Invalidate caches BEFORE update for stronger consistency
      diagramCache.delete(`diagram:${diagramId}`);
      listCache.invalidatePattern(/^list:/);
      svgCache.invalidatePattern(new RegExp(`^svg:${escapeRegex(diagramId)}:`));

      // Update the diagram with version check to detect concurrent modifications
      // Note: Agent operations are expensive, so we don't retry on conflict
      // Instead, we fail and ask the user to retry manually
      const updateResult = storage.updateDiagram(
        diagramId,
        result.spec,
        `Agent: ${agent.name}`,
        diagram.version // Use version from when we started
      );

      // Handle conflict - diagram was modified while agent was running
      if (updateResult && "conflict" in updateResult) {
        return errorResponse(
          c,
          "CONCURRENT_MODIFICATION",
          `Diagram was modified (v${diagram.version} → v${updateResult.currentVersion}) while agent was running. Please refresh and try again.`,
          409
        );
      }

      if (!updateResult) {
        return notFoundResponse(c, "Diagram", diagramId);
      }

      const updated = updateResult;

      // Audit log the agent run
      audit("diagram.run_agent", user, diagramId, {
        agentId,
        agentName: agent.name,
        agentType: agent.type,
        changesCount: result.changes?.length ?? 0,
      }, getAuditContext(c.req.raw));

      // Broadcast to collaborators
      broadcastDiagramSync(diagramId, result.spec);

      return c.json({
        success: true,
        changes: result.changes,
        diagram: updated,
      });
    }

    return errorResponse(
      c,
      "AGENT_FAILED",
      result.error || "Agent execution failed",
      400
    );
  } catch (err) {
    if (err instanceof PermissionDeniedError) throw err;
    if (err instanceof TimeoutError) {
      // 504 Gateway Timeout - need to handle manually as it's not in standard helpers
      return c.json({
        error: {
          code: "AGENT_TIMEOUT",
          message: err.message,
        },
      }, 504);
    }
    log.error("Run agent failed", { error: err instanceof Error ? err.message : String(err) });
    return errorResponse(
      c,
      "AGENT_EXECUTION_ERROR",
      err instanceof Error ? err.message : "Failed to run agent",
      500
    );
  }
});

// Export diagram as SVG (server-side generation, rate limited, cached)
app.get("/api/diagrams/:id/export/svg", rateLimiters.export, (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Check read permission (required for export)
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canRead(user, ownership)) {
      throw new PermissionDeniedError("read", id);
    }

    // Check SVG cache (keyed by diagramId:version for automatic invalidation)
    const cacheKey = `svg:${id}:${diagram.version}`;
    let svg = svgCache.get(cacheKey);
    let cacheStatus = "HIT";

    if (!svg) {
      // Generate and sanitize SVG
      const rawSvg = generateSVG(diagram.spec);
      svg = sanitizeSvgOutput(rawSvg);
      // Cache with actual byte size for accurate memory tracking
      const sizeBytes = new TextEncoder().encode(svg).length;
      svgCache.set(cacheKey, svg, sizeBytes);
      cacheStatus = "MISS";
    }

    // Get security headers for SVG content
    const secHeaders = getSvgSecurityHeaders();
    // Use version-based ETag for client caching
    const etag = `"svg-v${diagram.version}"`;

    return new Response(svg, {
      headers: {
        ...secHeaders,
        "Content-Disposition": getContentDisposition(diagram.name, ".svg"),
        "Cache-Control": "private, max-age=300", // 5 min client cache
        "ETag": etag,
        "X-Cache": cacheStatus,
      },
    });
  } catch (err) {
    if (err instanceof APIError) {
      return new Response(
        JSON.stringify({ error: { code: err.code, message: err.message } }),
        { status: err.status, headers: { "Content-Type": "application/json" } }
      );
    }
    log.error("SVG export failed", { error: err instanceof Error ? err.message : String(err) });
    return new Response(
      JSON.stringify({ error: { code: "EXPORT_FAILED", message: "Failed to export SVG" } }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// Export diagram as PNG (via SVG conversion, rate limited)
app.get("/api/diagrams/:id/export/png", rateLimiters.export, async (c) => {
  try {
    const id = validateDiagramId(c.req.param("id"));
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Check read permission (required for export)
    const user = getCurrentUser(c);
    const ownership = parseOwnership(diagram);
    if (!canRead(user, ownership)) {
      throw new PermissionDeniedError("read", id);
    }

    // For PNG, we need browser rendering - return instruction
    // In a full implementation, we'd use puppeteer/playwright
    return c.json({
      message: "PNG export requires browser rendering",
      suggestion: `Open http://localhost:${PORT}/diagram/${id} and use Export PNG button`,
      svgUrl: `/api/diagrams/${id}/export/svg`,
      diagramId: id,
      diagramName: diagram.name,
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    throw new APIError("EXPORT_FAILED", "Failed to get export info", 500);
  }
});

// Generate SVG from diagram spec (server-side)
// Security: All user-provided values are sanitized to prevent XSS
function generateSVG(spec: DiagramSpec): string {
  const padding = 50;
  const nodeWidth = 150;
  const nodeHeight = 80;

  // Calculate positions for nodes if not specified
  // Sanitize all position values to ensure they're valid numbers
  const nodePositions: Record<string, { x: number; y: number }> = {};
  spec.nodes.forEach((node, i) => {
    // Sanitize node ID for use as lookup key
    const safeId = sanitizeId(node.id);
    nodePositions[safeId] = {
      x: sanitizeNumber(node.position?.x, padding + (i % 4) * (nodeWidth + 50)),
      y: sanitizeNumber(node.position?.y, padding + Math.floor(i / 4) * (nodeHeight + 50)),
    };
  });

  // Calculate SVG dimensions
  const positions = Object.values(nodePositions);
  const maxX = sanitizeNumber(
    Math.max(...positions.map((p) => p.x)) + nodeWidth + padding,
    800
  );
  const maxY = sanitizeNumber(
    Math.max(...positions.map((p) => p.y)) + nodeHeight + padding,
    600
  );

  // Build SVG with sanitized dimensions
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}">
  <style>
    .node { fill: #1e293b; stroke: #3b82f6; stroke-width: 2; }
    .node-label { fill: #f1f5f9; font-family: system-ui, sans-serif; font-size: 14px; text-anchor: middle; dominant-baseline: middle; }
    .edge { stroke: #64748b; stroke-width: 2; fill: none; marker-end: url(#arrowhead); }
    .edge-label { fill: #94a3b8; font-family: system-ui, sans-serif; font-size: 12px; text-anchor: middle; }
  </style>
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#0f172a" />
`;

  // Draw edges first (so nodes appear on top)
  spec.edges.forEach((edge) => {
    // Sanitize edge endpoint IDs for lookup
    const fromId = sanitizeId(edge.from);
    const toId = sanitizeId(edge.to);
    const from = nodePositions[fromId];
    const to = nodePositions[toId];
    if (from && to) {
      const x1 = sanitizeNumber(from.x + nodeWidth / 2);
      const y1 = sanitizeNumber(from.y + nodeHeight);
      const x2 = sanitizeNumber(to.x + nodeWidth / 2);
      const y2 = sanitizeNumber(to.y);

      // Build edge style with sanitized values
      const edgeStyles: string[] = [];
      if (edge.color) {
        edgeStyles.push(`stroke: ${escapeAttribute(sanitizeColor(edge.color, "#64748b"))}`);
      }
      if (edge.style === "dashed") {
        edgeStyles.push("stroke-dasharray: 8,4");
      } else if (edge.style === "dotted") {
        edgeStyles.push("stroke-dasharray: 2,2");
      }
      const edgeStyleAttr = edgeStyles.length > 0 ? ` style="${edgeStyles.join("; ")}"` : "";

      svg += `  <line class="edge"${edgeStyleAttr} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />\n`;

      if (edge.label) {
        const midX = sanitizeNumber((x1 + x2) / 2);
        const midY = sanitizeNumber((y1 + y2) / 2 - 8);
        // Use escapeXml for text content (safe for inner text)
        svg += `  <text class="edge-label" x="${midX}" y="${midY}">${escapeXml(edge.label)}</text>\n`;
      }
    }
  });

  // Draw nodes
  spec.nodes.forEach((node) => {
    const safeId = sanitizeId(node.id);
    const pos = nodePositions[safeId];
    if (!pos) return; // Skip if position not found

    const cx = sanitizeNumber(pos.x + nodeWidth / 2);
    const cy = sanitizeNumber(pos.y + nodeHeight / 2);

    // Get sanitized color if specified, otherwise use CSS class defaults
    const nodeColor = node.color ? sanitizeColor(node.color) : undefined;
    const colorStyle = nodeColor ? ` style="fill: ${escapeAttribute(nodeColor)}"` : "";

    if (node.type === "circle") {
      const rx = sanitizeNumber(nodeWidth / 2 - 10);
      const ry = sanitizeNumber(nodeHeight / 2 - 5);
      svg += `  <ellipse class="node"${colorStyle} cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" />\n`;
    } else if (node.type === "diamond") {
      const points = [
        `${cx},${sanitizeNumber(pos.y)}`,
        `${sanitizeNumber(pos.x + nodeWidth)},${cy}`,
        `${cx},${sanitizeNumber(pos.y + nodeHeight)}`,
        `${sanitizeNumber(pos.x)},${cy}`,
      ].join(" ");
      svg += `  <polygon class="node"${colorStyle} points="${points}" />\n`;
    } else {
      // Default: rectangle
      const x = sanitizeNumber(pos.x);
      const y = sanitizeNumber(pos.y);
      svg += `  <rect class="node"${colorStyle} x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="8" />\n`;
    }

    // Use escapeXml for text content
    svg += `  <text class="node-label" x="${cx}" y="${cy}">${escapeXml(node.label)}</text>\n`;
  });

  svg += "</svg>";
  return svg;
}

// Server setup
const WEB_DIR = join(import.meta.dir, "..", "web");

// Install graceful shutdown handlers
installShutdownHandlers();

// Register shutdown callbacks
onShutdown("close-websockets", () => {
  roomManager.closeAll("Server shutting down");
});

onShutdown("collab-cleanup", () => {
  stopCollabCleanup();
});

onShutdown("rate-limiter-cleanup", () => {
  stopRateLimitCleanup();
});

onShutdown("flush-metrics", () => {
  log.info("Metrics flushed");
});

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Handle WebSocket upgrade for collaboration with authentication
    if (url.pathname === "/ws/collab") {
      // Use the authenticated WebSocket upgrade handler
      const response = await handleWebSocketUpgrade(req, server as any);
      if (response) {
        // Returns a response only on error (e.g., invalid token)
        return response;
      }
      // Successful upgrade returns undefined
      return undefined;
    }

    if (url.pathname.startsWith("/api")) {
      return app.fetch(req);
    }

    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const fullPath = join(WEB_DIR, filePath);
    const file = Bun.file(fullPath);

    if (await file.exists()) {
      const ext = extname(filePath);
      return new Response(file, { headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream" } });
    }

    return new Response(Bun.file(join(WEB_DIR, "index.html")), { headers: { "Content-Type": "text/html" } });
  },

  // WebSocket handlers for real-time collaboration
  websocket: {
    open(ws) {
      handleWebSocketOpen(ws as any);
    },
    message(ws, message) {
      handleWebSocketMessage(ws as any, message as string);
    },
    close(ws) {
      handleWebSocketClose(ws as any);
    },
    // Note: Bun's WebSocketHandler doesn't have an official 'error' callback
    // Errors are logged in the close handler if needed
  },
});

log.info("Server started", {
  webUI: `http://localhost:${PORT}`,
  api: `http://localhost:${PORT}/api`,
  websocket: `ws://localhost:${PORT}/ws/collab`,
});

// Initialize thumbnail cleanup
// This requires access to the storage module to get diagram IDs
setDiagramIdProvider(() => storage.getAllDiagramIds());
startThumbnailCleanup();

// Register thumbnail cleanup for graceful shutdown
onShutdown("thumbnail-cleanup", () => {
  stopThumbnailCleanup();
  return Promise.resolve();
});

// Note: Do NOT export the server - causes Bun 1.3.2 dev bundler stack overflow
