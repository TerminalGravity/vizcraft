/**
 * Vizcraft Web Server
 * Serves API and static files for the web UI
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { storage } from "./storage/db";
import { loadAgents, getAgent } from "./agents/loader";
import { runAgent } from "./agents/runner";
import { getProviderRegistry, listConfiguredProviders } from "./llm";
import { listThemes, getTheme, generateStyledCSS, applyThemeToDiagram } from "./styling";
import { layoutDiagram, listLayoutAlgorithms, type LayoutOptions, type LayoutAlgorithm } from "./layout";
import { diffSpecs, generateChangelog, type DiagramDiff } from "./versioning";
import {
  diagramCache,
  listCache,
  generateETag,
  matchesETag,
  getSpecComplexity,
} from "./performance";
import {
  handleWebSocketOpen,
  handleWebSocketMessage,
  handleWebSocketClose,
  handleWebSocketError,
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
import { join, extname } from "path";
import { rateLimiters } from "./api/rate-limiter";
import { runHealthChecks, livenessCheck, readinessCheck } from "./api/health";
import {
  withTimeout,
  TimeoutError,
  TIMEOUTS,
} from "./api/timeout";

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

const app = new Hono();

// CORS configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3420", "http://127.0.0.1:3420"];

// Log CORS configuration in development
if (process.env.NODE_ENV !== "production") {
  console.log(`[CORS] Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
}

// Middleware
app.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin) return null;

      // Check if origin is in allowed list
      if (ALLOWED_ORIGINS.includes(origin)) {
        return origin;
      }

      // In development, also allow localhost with any port
      if (process.env.NODE_ENV !== "production" && origin.match(/^https?:\/\/localhost(:\d+)?$/)) {
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

// Global error handler
app.onError((err, c) => {
  console.error(`[API Error] ${c.req.method} ${c.req.path}:`, err);

  if (err instanceof APIError) {
    return c.json({
      error: true,
      message: err.message,
      code: err.code,
    }, err.status as 400 | 404 | 500);
  }

  if (err instanceof SyntaxError) {
    return c.json({
      error: true,
      message: "Invalid JSON in request body",
      code: "INVALID_JSON",
    }, 400);
  }

  return c.json({
    error: true,
    message: "Internal server error",
    code: "INTERNAL_ERROR",
    ...(process.env.NODE_ENV === "development" && { details: err.message }),
  }, 500);
});

// 404 handler for API routes
app.notFound((c) => {
  if (c.req.path.startsWith("/api")) {
    return c.json({
      error: true,
      message: `API endpoint not found: ${c.req.method} ${c.req.path}`,
      code: "NOT_FOUND",
    }, 404);
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

// List diagrams with pagination and caching
app.get("/api/diagrams", (c) => {
  try {
    const project = c.req.query("project");
    const limitParam = c.req.query("limit");
    const offsetParam = c.req.query("offset");
    const minimal = c.req.query("minimal") === "true";

    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 50;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    // Check cache for list results
    const cacheKey = `list:${project || "all"}:${limit}:${offset}:${minimal}`;
    const cached = listCache.get(cacheKey);
    if (cached) {
      const etag = generateETag(cached);
      if (matchesETag(c.req.header("If-None-Match"), etag)) {
        return new Response(null, { status: 304 });
      }
      c.header("ETag", etag);
      c.header("X-Cache", "HIT");
      return c.json(cached);
    }

    const allDiagrams = storage.listDiagrams(project);
    const projects = storage.listProjects();
    const total = allDiagrams.length;
    const paginated = allDiagrams.slice(offset, offset + limit);

    const response = {
      count: paginated.length,
      total,
      offset,
      limit,
      diagrams: paginated.map((d) => ({
        id: d.id,
        name: d.name,
        project: d.project,
        // Skip spec in minimal mode for faster list loading
        ...(minimal
          ? { nodeCount: d.spec.nodes?.length ?? 0 }
          : { spec: d.spec }),
        // Return URL to thumbnail endpoint (client handles 404 for missing thumbnails)
        thumbnailUrl: `/api/diagrams/${d.id}/thumbnail`,
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
    throw new APIError("LIST_FAILED", "Failed to list diagrams", 500);
  }
});

// Get diagram with caching
app.get("/api/diagrams/:id", (c) => {
  try {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }

    // Check cache
    const cacheKey = `diagram:${id}`;
    const cached = diagramCache.get(cacheKey);
    if (cached) {
      const etag = generateETag(cached);
      if (matchesETag(c.req.header("If-None-Match"), etag)) {
        return new Response(null, { status: 304 });
      }
      c.header("ETag", etag);
      c.header("X-Cache", "HIT");
      return c.json(cached);
    }

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    // Add complexity info for client-side optimization decisions
    const complexity = getSpecComplexity(diagram.spec);

    const response = {
      ...diagram,
      complexity,
    };

    // Cache the response
    diagramCache.set(cacheKey, response);
    const etag = generateETag(response);
    c.header("ETag", etag);
    c.header("X-Cache", "MISS");
    c.header("Cache-Control", "private, max-age=60");

    return c.json(response);
  } catch (err) {
    if (err instanceof APIError) throw err;
    throw new APIError("GET_FAILED", "Failed to get diagram", 500);
  }
});

// Create diagram (rate limited)
app.post("/api/diagrams", rateLimiters.diagramCreate, async (c) => {
  try {
    const body = await c.req.json<{ name: string; project?: string; spec: DiagramSpec }>();

    if (!body.name?.trim()) {
      return c.json({ error: true, message: "Name is required", code: "MISSING_NAME" }, 400);
    }
    if (!body.spec) {
      return c.json({ error: true, message: "Spec is required", code: "MISSING_SPEC" }, 400);
    }
    if (!body.spec.type || !body.spec.nodes) {
      return c.json({ error: true, message: "Spec must have type and nodes", code: "INVALID_SPEC" }, 400);
    }

    const diagram = storage.createDiagram(body.name.trim(), body.project?.trim() || "default", body.spec);

    // Invalidate list cache (new diagram added)
    listCache.invalidatePattern(/^list:/);

    return c.json(diagram, 201);
  } catch (err) {
    console.error("POST /api/diagrams error:", err);
    if (err instanceof SyntaxError) {
      return c.json({ error: true, message: "Invalid JSON in request body", code: "INVALID_JSON" }, 400);
    }
    return c.json({ error: true, message: "Failed to create diagram", code: "CREATE_FAILED" }, 500);
  }
});

// Update diagram
app.put("/api/diagrams/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json<{ spec: DiagramSpec; message?: string }>();

    if (!body.spec) {
      return c.json({ error: true, message: "Spec is required", code: "MISSING_SPEC" }, 400);
    }

    if (!storage.getDiagram(id)) {
      return c.json({ error: true, message: "Diagram not found", code: "NOT_FOUND" }, 404);
    }

    const updated = storage.updateDiagram(id, body.spec, body.message);

    // Invalidate caches for this diagram
    diagramCache.delete(`diagram:${id}`);
    listCache.invalidatePattern(/^list:/);

    // Broadcast update to collaborators
    broadcastDiagramSync(id, body.spec);

    return c.json(updated);
  } catch (err) {
    console.error("PUT /api/diagrams/:id error:", err);
    if (err instanceof SyntaxError) {
      return c.json({ error: true, message: "Invalid JSON in request body", code: "INVALID_JSON" }, 400);
    }
    return c.json({ error: true, message: "Failed to update diagram", code: "UPDATE_FAILED" }, 500);
  }
});

// Delete diagram
app.delete("/api/diagrams/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const deleted = await storage.deleteDiagram(id);
    if (!deleted) {
      return c.json({ error: true, message: "Diagram not found", code: "NOT_FOUND" }, 404);
    }

    // Invalidate caches
    diagramCache.delete(`diagram:${id}`);
    listCache.invalidatePattern(/^list:/);

    return c.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/diagrams/:id error:", err);
    return c.json({ error: true, message: "Failed to delete diagram", code: "DELETE_FAILED" }, 500);
  }
});

// Update diagram thumbnail (saves to filesystem)
app.put("/api/diagrams/:id/thumbnail", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json<{ thumbnail: string }>();

    if (!body.thumbnail) {
      return c.json({ error: true, message: "Thumbnail data URL required", code: "MISSING_THUMBNAIL" }, 400);
    }

    if (!storage.getDiagram(id)) {
      return c.json({ error: true, message: "Diagram not found", code: "NOT_FOUND" }, 404);
    }

    const success = await storage.updateThumbnail(id, body.thumbnail);
    return c.json({ success });
  } catch (err) {
    console.error("PUT /api/diagrams/:id/thumbnail error:", err);
    if (err instanceof SyntaxError) {
      return c.json({ error: true, message: "Invalid JSON in request body", code: "INVALID_JSON" }, 400);
    }
    return c.json({ error: true, message: "Failed to update thumbnail", code: "THUMBNAIL_FAILED" }, 500);
  }
});

// Get diagram thumbnail (serves from filesystem)
app.get("/api/diagrams/:id/thumbnail", async (c) => {
  try {
    const id = c.req.param("id");

    // Check if diagram exists
    if (!storage.getDiagram(id)) {
      return c.json({ error: true, message: "Diagram not found", code: "NOT_FOUND" }, 404);
    }

    // Load thumbnail from filesystem
    const dataUrl = await storage.loadThumbnail(id);
    if (!dataUrl) {
      return c.json({ error: true, message: "Thumbnail not found", code: "THUMBNAIL_NOT_FOUND" }, 404);
    }

    // Convert data URL to binary response for efficient caching
    const matches = dataUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches) {
      return c.json({ error: true, message: "Invalid thumbnail data", code: "INVALID_THUMBNAIL" }, 500);
    }

    const buffer = Buffer.from(matches[2], "base64");
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
    });
  } catch (err) {
    console.error("GET /api/diagrams/:id/thumbnail error:", err);
    return c.json({ error: true, message: "Failed to load thumbnail", code: "THUMBNAIL_LOAD_FAILED" }, 500);
  }
});

// Get versions
app.get("/api/diagrams/:id/versions", (c) => {
  try {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }
    // Check if diagram exists
    if (!storage.getDiagram(id)) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }
    const versions = storage.getVersions(id);
    return c.json({ versions, count: versions.length });
  } catch (err) {
    if (err instanceof APIError) throw err;
    throw new APIError("VERSIONS_FAILED", "Failed to get diagram versions", 500);
  }
});

// Get specific version
app.get("/api/diagrams/:id/versions/:version", (c) => {
  try {
    const id = c.req.param("id");
    const versionParam = c.req.param("version");

    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }
    if (!versionParam?.trim()) {
      throw new APIError("INVALID_VERSION", "Version number is required", 400);
    }

    const versionNum = parseInt(versionParam, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      throw new APIError("INVALID_VERSION", "Version must be a positive integer", 400);
    }

    if (!storage.getDiagram(id)) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
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

// Restore to specific version
app.post("/api/diagrams/:id/restore/:version", async (c) => {
  try {
    const id = c.req.param("id");
    const versionParam = c.req.param("version");

    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }
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

    const targetVersion = storage.getVersion(id, versionNum);
    if (!targetVersion) {
      throw new APIError("VERSION_NOT_FOUND", `Version ${versionNum} not found`, 404);
    }

    const restored = storage.restoreVersion(id, versionNum);
    if (!restored) {
      throw new APIError("RESTORE_FAILED", "Failed to restore version", 500);
    }

    console.log(`[versioning] Restored diagram ${id} to version ${versionNum}`);
    return c.json({
      success: true,
      diagram: restored,
      message: `Restored to version ${versionNum}`,
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    console.error("POST /api/diagrams/:id/restore/:version error:", err);
    throw new APIError("RESTORE_FAILED", "Failed to restore version", 500);
  }
});

// Diff between two versions
app.get("/api/diagrams/:id/diff", (c) => {
  try {
    const id = c.req.param("id");
    const v1Param = c.req.query("v1");
    const v2Param = c.req.query("v2");

    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
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
      version2 = versions[0]; // Latest
      version1 = versions[1]; // Previous
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
    console.error("GET /api/diagrams/:id/diff error:", err);
    throw new APIError("DIFF_FAILED", "Failed to calculate diff", 500);
  }
});

// Fork/branch a diagram
app.post("/api/diagrams/:id/fork", async (c) => {
  try {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }

    const body = await c.req.json<{ name?: string; project?: string }>();

    const original = storage.getDiagram(id);
    if (!original) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    const newName = body.name || `${original.name} (fork)`;
    const project = body.project || original.project;

    const forked = storage.forkDiagram(id, newName, project);
    if (!forked) {
      throw new APIError("FORK_FAILED", "Failed to fork diagram", 500);
    }

    console.log(`[versioning] Forked diagram ${id} -> ${forked.id}`);
    return c.json({
      success: true,
      diagram: forked,
      originalId: id,
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    console.error("POST /api/diagrams/:id/fork error:", err);
    if (err instanceof SyntaxError) {
      throw new APIError("INVALID_JSON", "Invalid JSON in request body", 400);
    }
    throw new APIError("FORK_FAILED", "Failed to fork diagram", 500);
  }
});

// Get version timeline with diffs (useful for history UI)
app.get("/api/diagrams/:id/timeline", (c) => {
  try {
    const id = c.req.param("id");
    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 20;

    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    const versions = storage.getVersions(id).slice(0, limit);

    // Calculate diff summaries for each version
    const timeline = versions.map((version, i) => {
      if (i === versions.length - 1) {
        // First version - no diff
        return {
          version: version.version,
          message: version.message,
          createdAt: version.createdAt,
          summary: "Initial version",
          hasChanges: false,
        };
      }

      const previousVersion = versions[i + 1];
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
      totalVersions: versions.length,
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    console.error("GET /api/diagrams/:id/timeline error:", err);
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
    console.error("GET /api/agents error:", err);
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

// Performance stats endpoint
app.get("/api/performance/stats", (c) => {
  try {
    const diagramStats = diagramCache.getStats();
    const listStats = listCache.getStats();

    return c.json({
      cache: {
        diagrams: diagramStats,
        lists: listStats,
        total: {
          entries: diagramStats.entries + listStats.entries,
          sizeBytes: diagramStats.sizeBytes + listStats.sizeBytes,
          sizeMB: ((diagramStats.sizeBytes + listStats.sizeBytes) / 1024 / 1024).toFixed(2),
          hits: diagramStats.hits + listStats.hits,
          misses: diagramStats.misses + listStats.misses,
          hitRate: (
            (diagramStats.hits + listStats.hits) /
            Math.max(1, diagramStats.hits + listStats.hits + diagramStats.misses + listStats.misses)
          ).toFixed(3),
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
    console.error("GET /api/performance/stats error:", err);
    return c.json({ error: true, message: "Failed to get performance stats" }, 500);
  }
});

// Clear caches (admin endpoint)
app.post("/api/performance/clear-cache", (c) => {
  try {
    diagramCache.clear();
    listCache.clear();
    console.log("[performance] All caches cleared");
    return c.json({ success: true, message: "All caches cleared" });
  } catch (err) {
    console.error("POST /api/performance/clear-cache error:", err);
    return c.json({ error: true, message: "Failed to clear cache" }, 500);
  }
});

// ==================== Collaboration Endpoints ====================

// Get collaboration stats
app.get("/api/collab/stats", (c) => {
  try {
    const stats = getCollabStats();
    return c.json(stats);
  } catch (err) {
    console.error("GET /api/collab/stats error:", err);
    return c.json({ error: true, message: "Failed to get collaboration stats" }, 500);
  }
});

// Get room info for a diagram
app.get("/api/collab/rooms/:diagramId", (c) => {
  try {
    const diagramId = c.req.param("diagramId");
    if (!diagramId?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }

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
    console.error("GET /api/collab/rooms/:diagramId error:", err);
    return c.json({ error: true, message: "Failed to get room info" }, 500);
  }
});

// ==================== Diagram Types Endpoints ====================

// List all diagram types
app.get("/api/diagram-types", (c) => {
  try {
    const types = listDiagramTypes();
    return c.json({ types, count: types.length });
  } catch (err) {
    console.error("GET /api/diagram-types error:", err);
    return c.json({ error: true, message: "Failed to list diagram types" }, 500);
  }
});

// Get info for specific diagram type
app.get("/api/diagram-types/:type", (c) => {
  try {
    const type = c.req.param("type") as DiagramType;
    const info = getDiagramTypeInfo(type);
    return c.json(info);
  } catch (err) {
    console.error("GET /api/diagram-types/:type error:", err);
    return c.json({ error: true, message: "Failed to get diagram type info" }, 500);
  }
});

// Get starter template for diagram type
app.get("/api/diagram-types/:type/template", (c) => {
  try {
    const type = c.req.param("type") as DiagramType;
    const template = getDiagramTemplate(type);
    return c.json({ template });
  } catch (err) {
    console.error("GET /api/diagram-types/:type/template error:", err);
    return c.json({ error: true, message: "Failed to get diagram template" }, 500);
  }
});

// Export diagram to Mermaid format
app.get("/api/diagrams/:id/export/mermaid", (c) => {
  try {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    const mermaid = exportToMermaid(diagram.spec);

    // Return as plain text for easy copy/paste
    c.header("Content-Type", "text/plain");
    return c.text(mermaid);
  } catch (err) {
    if (err instanceof APIError) throw err;
    console.error("GET /api/diagrams/:id/export/mermaid error:", err);
    return c.json({ error: true, message: "Failed to export to Mermaid" }, 500);
  }
});

// Get supported export formats
app.get("/api/export-formats", (c) => {
  try {
    const formats = getSupportedExportFormats();
    return c.json({ formats, count: formats.length });
  } catch (err) {
    console.error("GET /api/export-formats error:", err);
    return c.json({ error: true, message: "Failed to get export formats" }, 500);
  }
});

// Get LLM provider status
app.get("/api/llm/status", async (c) => {
  try {
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
    console.error("GET /api/llm/status error:", err);
    return c.json({ error: true, message: "Failed to get LLM status", code: "LLM_STATUS_ERROR" }, 500);
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
    const id = c.req.param("id");
    const body = await c.req.json<{
      algorithm: LayoutAlgorithm;
      direction?: "DOWN" | "RIGHT" | "UP" | "LEFT";
      spacing?: { nodeSpacing?: number; edgeSpacing?: number; layerSpacing?: number };
      padding?: number;
    }>();

    if (!body.algorithm) {
      throw new APIError("MISSING_ALGORITHM", "Layout algorithm is required", 400);
    }

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
      "Layout calculation"
    );

    if (!result.success) {
      throw new APIError("LAYOUT_FAILED", result.error || "Layout failed", 400);
    }

    // Update diagram with new positions
    const updated = storage.updateDiagram(id, result.spec!, `Applied layout: ${body.algorithm}`);

    // Broadcast to collaborators
    broadcastDiagramSync(id, result.spec!);

    // Invalidate cache
    diagramCache.delete(`diagram:${id}`);

    return c.json({
      success: true,
      diagram: updated,
      duration: result.duration,
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    if (err instanceof TimeoutError) {
      throw new APIError("LAYOUT_TIMEOUT", err.message, 504);
    }
    console.error("POST /api/diagrams/:id/apply-layout error:", err);
    throw new APIError("LAYOUT_ERROR", "Failed to apply layout", 500);
  }
});

// Preview layout (returns positions without saving, rate limited)
app.post("/api/diagrams/:id/preview-layout", rateLimiters.layout, async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json<{
      algorithm: LayoutAlgorithm;
      direction?: "DOWN" | "RIGHT" | "UP" | "LEFT";
      spacing?: { nodeSpacing?: number; edgeSpacing?: number; layerSpacing?: number };
      padding?: number;
    }>();

    if (!body.algorithm) {
      throw new APIError("MISSING_ALGORITHM", "Layout algorithm is required", 400);
    }

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
    console.error("POST /api/diagrams/:id/preview-layout error:", err);
    throw new APIError("LAYOUT_ERROR", "Failed to preview layout", 500);
  }
});

// Apply theme to diagram
app.post("/api/diagrams/:id/apply-theme", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json<{ themeId: string }>();

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      return c.json({ error: true, message: "Diagram not found", code: "DIAGRAM_NOT_FOUND" }, 404);
    }

    const themedSpec = applyThemeToDiagram(diagram.spec, body.themeId);
    const updated = storage.updateDiagram(id, themedSpec, `Applied theme: ${body.themeId}`);

    // Broadcast to collaborators
    broadcastDiagramSync(id, themedSpec);

    // Invalidate cache
    diagramCache.delete(`diagram:${id}`);

    return c.json({
      success: true,
      diagram: updated,
    });
  } catch (err) {
    console.error("POST /api/diagrams/:id/apply-theme error:", err);
    return c.json({ error: true, message: "Failed to apply theme", code: "THEME_APPLY_FAILED" }, 500);
  }
});

// Run agent on diagram (rate limited - expensive operation)
app.post("/api/diagrams/:diagramId/run-agent/:agentId", rateLimiters.agentRun, async (c) => {
  try {
    const diagramId = c.req.param("diagramId");
    const agentId = c.req.param("agentId");

    const diagram = storage.getDiagram(diagramId);
    if (!diagram) {
      return c.json({ error: true, message: "Diagram not found", code: "DIAGRAM_NOT_FOUND" }, 404);
    }

    const agent = await getAgent(agentId);
    if (!agent) {
      return c.json({ error: true, message: "Agent not found", code: "AGENT_NOT_FOUND" }, 404);
    }

    const result = await withTimeout(
      runAgent(agent, diagram.spec),
      TIMEOUTS.AGENT,
      `Agent execution: ${agent.name}`
    );

    if (result.success && result.spec) {
      // Update the diagram with the new spec
      const updated = storage.updateDiagram(diagramId, result.spec, `Agent: ${agent.name}`);

      // Broadcast to collaborators
      broadcastDiagramSync(diagramId, result.spec);

      // Invalidate cache
      diagramCache.delete(`diagram:${diagramId}`);

      return c.json({
        success: true,
        changes: result.changes,
        diagram: updated,
      });
    }

    return c.json({
      success: false,
      error: true,
      message: result.error || "Agent execution failed",
      code: "AGENT_FAILED",
    }, 400);
  } catch (err) {
    if (err instanceof TimeoutError) {
      return c.json({
        error: true,
        message: err.message,
        code: "AGENT_TIMEOUT",
      }, 504);
    }
    console.error("POST /api/diagrams/:diagramId/run-agent/:agentId error:", err);
    return c.json({
      error: true,
      message: err instanceof Error ? err.message : "Failed to run agent",
      code: "AGENT_EXECUTION_ERROR",
    }, 500);
  }
});

// Export diagram as SVG (server-side generation, rate limited)
app.get("/api/diagrams/:id/export/svg", rateLimiters.export, (c) => {
  try {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }

    const svg = generateSVG(diagram.spec);
    // Sanitize filename
    const safeName = diagram.name.replace(/[^a-zA-Z0-9-_]/g, "_");
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="${safeName}.svg"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    if (err instanceof APIError) {
      return new Response(JSON.stringify({ error: true, message: err.message, code: err.code }), {
        status: err.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("GET /api/diagrams/:id/export/svg error:", err);
    return new Response(JSON.stringify({ error: true, message: "Failed to export SVG", code: "EXPORT_FAILED" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// Export diagram as PNG (via SVG conversion, rate limited)
app.get("/api/diagrams/:id/export/png", rateLimiters.export, async (c) => {
  try {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
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
function generateSVG(spec: DiagramSpec): string {
  const padding = 50;
  const nodeWidth = 150;
  const nodeHeight = 80;

  // Calculate positions for nodes if not specified
  const nodePositions: Record<string, { x: number; y: number }> = {};
  spec.nodes.forEach((node, i) => {
    nodePositions[node.id] = {
      x: node.position?.x ?? padding + (i % 4) * (nodeWidth + 50),
      y: node.position?.y ?? padding + Math.floor(i / 4) * (nodeHeight + 50),
    };
  });

  // Calculate SVG dimensions
  const positions = Object.values(nodePositions);
  const maxX = Math.max(...positions.map((p) => p.x)) + nodeWidth + padding;
  const maxY = Math.max(...positions.map((p) => p.y)) + nodeHeight + padding;

  // Build SVG
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
    const from = nodePositions[edge.from];
    const to = nodePositions[edge.to];
    if (from && to) {
      const x1 = from.x + nodeWidth / 2;
      const y1 = from.y + nodeHeight;
      const x2 = to.x + nodeWidth / 2;
      const y2 = to.y;

      svg += `  <line class="edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />\n`;

      if (edge.label) {
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        svg += `  <text class="edge-label" x="${midX}" y="${midY - 8}">${escapeXml(edge.label)}</text>\n`;
      }
    }
  });

  // Draw nodes
  spec.nodes.forEach((node) => {
    const pos = nodePositions[node.id];
    const cx = pos.x + nodeWidth / 2;
    const cy = pos.y + nodeHeight / 2;

    if (node.type === "circle") {
      svg += `  <ellipse class="node" cx="${cx}" cy="${cy}" rx="${nodeWidth / 2 - 10}" ry="${nodeHeight / 2 - 5}" />\n`;
    } else if (node.type === "diamond") {
      const points = [
        `${cx},${pos.y}`,
        `${pos.x + nodeWidth},${cy}`,
        `${cx},${pos.y + nodeHeight}`,
        `${pos.x},${cy}`,
      ].join(" ");
      svg += `  <polygon class="node" points="${points}" />\n`;
    } else {
      // Default: rectangle
      svg += `  <rect class="node" x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="8" />\n`;
    }

    svg += `  <text class="node-label" x="${cx}" y="${cy}">${escapeXml(node.label)}</text>\n`;
  });

  svg += "</svg>";
  return svg;
}

// Escape XML special characters
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Server setup
const WEB_DIR = join(import.meta.dir, "..", "web");

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

    // Handle WebSocket upgrade for collaboration
    if (url.pathname === "/ws/collab") {
      const upgraded = server.upgrade(req, {
        data: { participantId: null },
      });
      if (upgraded) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 500 });
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
    error(ws, error) {
      handleWebSocketError(ws as any, error);
    },
  },
});

console.log(`[vizcraft] Web UI: http://localhost:${PORT}`);
console.log(`[vizcraft] API: http://localhost:${PORT}/api`);
console.log(`[vizcraft] WebSocket: ws://localhost:${PORT}/ws/collab`);

// Note: Do NOT export the server - causes Bun 1.3.2 dev bundler stack overflow
