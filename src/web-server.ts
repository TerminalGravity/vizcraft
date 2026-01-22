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
import type { DiagramSpec } from "./types";
import { join, extname } from "path";

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

// Middleware
app.use("*", cors());
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

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// List diagrams
app.get("/api/diagrams", (c) => {
  try {
    const project = c.req.query("project");
    const diagrams = storage.listDiagrams(project);
    const projects = storage.listProjects();
    return c.json({
      count: diagrams.length,
      diagrams: diagrams.map((d) => ({
        id: d.id,
        name: d.name,
        project: d.project,
        spec: d.spec,
        thumbnailUrl: d.thumbnailUrl,
        updatedAt: d.updatedAt,
      })),
      projects,
    });
  } catch (err) {
    throw new APIError("LIST_FAILED", "Failed to list diagrams", 500);
  }
});

// Get diagram
app.get("/api/diagrams/:id", (c) => {
  try {
    const id = c.req.param("id");
    if (!id?.trim()) {
      throw new APIError("INVALID_ID", "Diagram ID is required", 400);
    }
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      throw new APIError("NOT_FOUND", "Diagram not found", 404);
    }
    return c.json(diagram);
  } catch (err) {
    if (err instanceof APIError) throw err;
    throw new APIError("GET_FAILED", "Failed to get diagram", 500);
  }
});

// Create diagram
app.post("/api/diagrams", async (c) => {
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
app.delete("/api/diagrams/:id", (c) => {
  try {
    const id = c.req.param("id");
    if (!storage.deleteDiagram(id)) {
      return c.json({ error: true, message: "Diagram not found", code: "NOT_FOUND" }, 404);
    }
    return c.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/diagrams/:id error:", err);
    return c.json({ error: true, message: "Failed to delete diagram", code: "DELETE_FAILED" }, 500);
  }
});

// Update diagram thumbnail
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

    const success = storage.updateThumbnail(id, body.thumbnail);
    return c.json({ success });
  } catch (err) {
    console.error("PUT /api/diagrams/:id/thumbnail error:", err);
    if (err instanceof SyntaxError) {
      return c.json({ error: true, message: "Invalid JSON in request body", code: "INVALID_JSON" }, 400);
    }
    return c.json({ error: true, message: "Failed to update thumbnail", code: "THUMBNAIL_FAILED" }, 500);
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

    return c.json({
      success: true,
      diagram: updated,
    });
  } catch (err) {
    console.error("POST /api/diagrams/:id/apply-theme error:", err);
    return c.json({ error: true, message: "Failed to apply theme", code: "THEME_APPLY_FAILED" }, 500);
  }
});

// Run agent on diagram
app.post("/api/diagrams/:diagramId/run-agent/:agentId", async (c) => {
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

    const result = await runAgent(agent, diagram.spec);

    if (result.success && result.spec) {
      // Update the diagram with the new spec
      const updated = storage.updateDiagram(diagramId, result.spec, `Agent: ${agent.name}`);
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
    console.error("POST /api/diagrams/:diagramId/run-agent/:agentId error:", err);
    return c.json({
      error: true,
      message: err instanceof Error ? err.message : "Failed to run agent",
      code: "AGENT_EXECUTION_ERROR",
    }, 500);
  }
});

// Export diagram as SVG (server-side generation)
app.get("/api/diagrams/:id/export/svg", (c) => {
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

// Export diagram as PNG (via SVG conversion)
app.get("/api/diagrams/:id/export/png", async (c) => {
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
  async fetch(req) {
    const url = new URL(req.url);

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
});

console.log(`[vizcraft] Web UI: http://localhost:${PORT}`);
console.log(`[vizcraft] API: http://localhost:${PORT}/api`);

// Note: Do NOT export the server - causes Bun 1.3.2 dev bundler stack overflow
