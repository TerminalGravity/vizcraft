/**
 * Vizcraft Web Server
 * Serves API and static files for the web UI
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { storage } from "./storage/db";
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
