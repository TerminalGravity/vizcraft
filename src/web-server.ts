/**
 * Vizcraft Web Server
 * Serves API and static files for the web UI
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { storage } from "./storage/db";
import { loadAgents, getAgent } from "./agents/loader";
import { runAgent } from "./agents/runner";
import type { DiagramSpec } from "./types";
import { join, extname } from "path";

const app = new Hono();
app.use("*", cors());

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// List diagrams
app.get("/api/diagrams", (c) => {
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
      updatedAt: d.updatedAt,
    })),
    projects,
  });
});

// Get diagram
app.get("/api/diagrams/:id", (c) => {
  const id = c.req.param("id");
  const diagram = storage.getDiagram(id);
  if (!diagram) return c.json({ error: "Diagram not found" }, 404);
  return c.json(diagram);
});

// Create diagram
app.post("/api/diagrams", async (c) => {
  const body = await c.req.json<{ name: string; project?: string; spec: DiagramSpec }>();
  if (!body.name || !body.spec) return c.json({ error: "name and spec required" }, 400);
  const diagram = storage.createDiagram(body.name, body.project || "default", body.spec);
  return c.json(diagram, 201);
});

// Update diagram
app.put("/api/diagrams/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ spec: DiagramSpec; message?: string }>();
  if (!storage.getDiagram(id)) return c.json({ error: "Diagram not found" }, 404);
  const updated = storage.updateDiagram(id, body.spec, body.message);
  return c.json(updated);
});

// Delete diagram
app.delete("/api/diagrams/:id", (c) => {
  const id = c.req.param("id");
  if (!storage.deleteDiagram(id)) return c.json({ error: "Diagram not found" }, 404);
  return c.json({ success: true });
});

// Get versions
app.get("/api/diagrams/:id/versions", (c) => {
  const versions = storage.getVersions(c.req.param("id"));
  return c.json({ versions });
});

// List projects
app.get("/api/projects", (c) => c.json({ projects: storage.listProjects() }));

// List agents
app.get("/api/agents", async (c) => {
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
});

// Get specific agent
app.get("/api/agents/:id", async (c) => {
  const id = c.req.param("id");
  const agent = await getAgent(id);
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json(agent);
});

// Run agent on diagram
app.post("/api/diagrams/:diagramId/run-agent/:agentId", async (c) => {
  const diagramId = c.req.param("diagramId");
  const agentId = c.req.param("agentId");

  const diagram = storage.getDiagram(diagramId);
  if (!diagram) return c.json({ error: "Diagram not found" }, 404);

  const agent = await getAgent(agentId);
  if (!agent) return c.json({ error: "Agent not found" }, 404);

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
    error: result.error,
  }, 400);
});

// Export diagram as SVG (server-side generation)
app.get("/api/diagrams/:id/export/svg", (c) => {
  const id = c.req.param("id");
  const diagram = storage.getDiagram(id);
  if (!diagram) return c.json({ error: "Diagram not found" }, 404);

  const svg = generateSVG(diagram.spec);
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `attachment; filename="${diagram.name}.svg"`,
    },
  });
});

// Export diagram as PNG (via SVG conversion)
app.get("/api/diagrams/:id/export/png", async (c) => {
  const id = c.req.param("id");
  const diagram = storage.getDiagram(id);
  if (!diagram) return c.json({ error: "Diagram not found" }, 404);

  // For PNG, we need browser rendering - return instruction
  // In a full implementation, we'd use puppeteer/playwright
  return c.json({
    message: "PNG export requires browser rendering",
    suggestion: `Open http://localhost:${PORT}/diagram/${id} and use Export PNG button`,
    svgUrl: `/api/diagrams/${id}/export/svg`,
  });
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
const PORT = parseInt(process.env.WEB_PORT || "3420");
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
