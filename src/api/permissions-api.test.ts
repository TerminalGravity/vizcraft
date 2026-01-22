/**
 * Permission Checks Integration Tests
 *
 * Tests that API endpoints correctly enforce permission checks
 * for read, write, and delete operations on diagrams.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { signJWT, optionalAuth, getCurrentUser } from "../auth";
import {
  canRead,
  canWrite,
  canDelete,
  parseOwnership,
  getEffectivePermission,
  PermissionDeniedError,
  type DiagramOwnership,
} from "../auth/permissions";

// In-memory diagram store for testing
interface TestDiagram {
  id: string;
  name: string;
  project: string;
  spec: { type: string; nodes: any[]; edges: any[] };
  ownerId: string | null;
  isPublic: boolean;
  sharedWith: string[];
  version: number;
}

// Helper to create ownership from test diagram
function getOwnershipFromDiagram(diagram: TestDiagram): DiagramOwnership {
  // Convert sharedWith array to shares JSON format expected by parseOwnership
  const sharesJson = diagram.sharedWith.length > 0
    ? JSON.stringify(diagram.sharedWith.map(userId => ({ userId, permission: "editor" })))
    : null;
  return parseOwnership(diagram.ownerId, diagram.isPublic, sharesJson);
}

function createTestApp() {
  const diagrams = new Map<string, TestDiagram>();

  const app = new Hono();
  app.use("*", cors());
  app.use("*", optionalAuth());

  // Error handler for PermissionDeniedError
  app.onError((err, c) => {
    if (err instanceof PermissionDeniedError) {
      return c.json({ error: { code: err.code, message: err.message } }, 403);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message: err.message } }, 500);
  });

  // Create diagram
  app.post("/api/diagrams", async (c) => {
    const body = await c.req.json();
    const user = getCurrentUser(c);

    const diagram: TestDiagram = {
      id: `diag-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: body.name,
      project: body.project || "default",
      spec: body.spec,
      ownerId: user?.id ?? null,
      isPublic: body.isPublic ?? false,
      sharedWith: [],
      version: 1,
    };

    diagrams.set(diagram.id, diagram);
    return c.json(diagram, 201);
  });

  // Get diagram with permission check
  app.get("/api/diagrams/:id", (c) => {
    const id = c.req.param("id");
    const diagram = diagrams.get(id);

    if (!diagram) {
      return c.json({ error: { code: "NOT_FOUND", message: "Diagram not found" } }, 404);
    }

    const user = getCurrentUser(c);
    const ownership = getOwnershipFromDiagram(diagram);
    const permission = getEffectivePermission(user, ownership);

    if (!canRead(permission)) {
      throw new PermissionDeniedError("read", "diagram", id);
    }

    return c.json(diagram);
  });

  // Update diagram with permission check
  app.put("/api/diagrams/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const diagram = diagrams.get(id);

    if (!diagram) {
      return c.json({ error: { code: "NOT_FOUND", message: "Diagram not found" } }, 404);
    }

    const user = getCurrentUser(c);
    const ownership = getOwnershipFromDiagram(diagram);
    const permission = getEffectivePermission(user, ownership);

    if (!canWrite(permission)) {
      throw new PermissionDeniedError("write", "diagram", id);
    }

    diagram.spec = body.spec;
    diagram.version++;
    return c.json(diagram);
  });

  // Delete diagram with permission check
  app.delete("/api/diagrams/:id", (c) => {
    const id = c.req.param("id");
    const diagram = diagrams.get(id);

    if (!diagram) {
      return c.json({ error: { code: "NOT_FOUND", message: "Diagram not found" } }, 404);
    }

    const user = getCurrentUser(c);
    const ownership = getOwnershipFromDiagram(diagram);
    const permission = getEffectivePermission(user, ownership);

    if (!canDelete(permission)) {
      throw new PermissionDeniedError("delete", "diagram", id);
    }

    diagrams.delete(id);
    return c.json({ success: true });
  });

  // Apply layout with permission check
  app.post("/api/diagrams/:id/apply-layout", async (c) => {
    const id = c.req.param("id");
    const diagram = diagrams.get(id);

    if (!diagram) {
      return c.json({ error: { code: "NOT_FOUND", message: "Diagram not found" } }, 404);
    }

    const user = getCurrentUser(c);
    const ownership = getOwnershipFromDiagram(diagram);
    const permission = getEffectivePermission(user, ownership);

    if (!canWrite(permission)) {
      throw new PermissionDeniedError("write", "diagram", id);
    }

    diagram.version++;
    return c.json({ success: true, diagram });
  });

  // Helper to create diagrams directly for testing
  return {
    app,
    diagrams,
    createDiagram: (overrides: Partial<TestDiagram> = {}) => {
      const diagram: TestDiagram = {
        id: `diag-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: "Test Diagram",
        project: "default",
        spec: { type: "flowchart", nodes: [], edges: [] },
        ownerId: null,
        isPublic: false,
        sharedWith: [],
        version: 1,
        ...overrides,
      };
      diagrams.set(diagram.id, diagram);
      return diagram;
    },
  };
}

describe("API Permission Checks", () => {
  describe("Public Diagrams", () => {
    it("allows anonymous read of public diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: true });

      const res = await app.request(`/api/diagrams/${diagram.id}`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(diagram.id);
    });

    it("denies anonymous write to public diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: true });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: { type: "flowchart", nodes: [], edges: [] } }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("PERMISSION_DENIED");
    });

    it("denies anonymous delete of public diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: true });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(403);
    });
  });

  describe("Private Diagrams", () => {
    it("denies anonymous read of private diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "some-owner" });

      const res = await app.request(`/api/diagrams/${diagram.id}`);

      expect(res.status).toBe(403);
    });

    it("allows owner to read their private diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "owner-123" });
      const token = await signJWT({ sub: "owner-123", role: "user" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
    });

    it("allows owner to write their private diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "owner-456" });
      const token = await signJWT({ sub: "owner-456", role: "user" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ spec: { type: "flowchart", nodes: [], edges: [] } }),
      });

      expect(res.status).toBe(200);
    });

    it("allows owner to delete their private diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "owner-789" });
      const token = await signJWT({ sub: "owner-789", role: "user" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
    });

    it("denies other users read of private diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "owner-A" });
      const token = await signJWT({ sub: "other-user-B", role: "user" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
    });

    it("denies other users write to private diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "owner-C" });
      const token = await signJWT({ sub: "other-user-D", role: "user" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ spec: { type: "flowchart", nodes: [], edges: [] } }),
      });

      expect(res.status).toBe(403);
    });
  });

  describe("Shared Diagrams", () => {
    it("allows shared user to read private diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({
        isPublic: false,
        ownerId: "owner-share",
        sharedWith: ["shared-user-1", "shared-user-2"],
      });
      const token = await signJWT({ sub: "shared-user-1", role: "user" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
    });

    it("allows shared user to write to shared diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({
        isPublic: false,
        ownerId: "owner-share-write",
        sharedWith: ["writer-user"],
      });
      const token = await signJWT({ sub: "writer-user", role: "user" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ spec: { type: "flowchart", nodes: [], edges: [] } }),
      });

      expect(res.status).toBe(200);
    });

    it("denies shared user from deleting diagram (only owner can delete)", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({
        isPublic: false,
        ownerId: "owner-nodelete",
        sharedWith: ["shared-cannot-delete"],
      });
      const token = await signJWT({ sub: "shared-cannot-delete", role: "user" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
    });
  });

  describe("Admin Access", () => {
    it("allows admin to read any private diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "some-user" });
      const token = await signJWT({ sub: "admin-1", role: "admin" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
    });

    it("allows admin to write any diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "some-user" });
      const token = await signJWT({ sub: "admin-2", role: "admin" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ spec: { type: "flowchart", nodes: [], edges: [] } }),
      });

      expect(res.status).toBe(200);
    });

    it("allows admin to delete any diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "some-user" });
      const token = await signJWT({ sub: "admin-3", role: "admin" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
    });
  });

  describe("Viewer Role", () => {
    it("allows viewer to read public diagrams", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: true });
      const token = await signJWT({ sub: "viewer-1", role: "viewer" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
    });

    it("denies viewer write access even to their own diagrams", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "viewer-write" });
      const token = await signJWT({ sub: "viewer-write", role: "viewer" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ spec: { type: "flowchart", nodes: [], edges: [] } }),
      });

      expect(res.status).toBe(403);
    });

    it("denies viewer delete access", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "viewer-delete" });
      const token = await signJWT({ sub: "viewer-delete", role: "viewer" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
    });
  });

  describe("Anonymous Owned Diagrams", () => {
    it("allows anonymous read of anonymous-owned public diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: true, ownerId: null });

      const res = await app.request(`/api/diagrams/${diagram.id}`);

      expect(res.status).toBe(200);
    });

    it("allows authenticated user to write anonymous-owned public diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: true, ownerId: null });
      const token = await signJWT({ sub: "user-anon-write", role: "user" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ spec: { type: "flowchart", nodes: [], edges: [] } }),
      });

      expect(res.status).toBe(200);
    });

    it("allows admin to delete anonymous-owned diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: true, ownerId: null });
      const token = await signJWT({ sub: "admin-delete-anon", role: "admin" });

      const res = await app.request(`/api/diagrams/${diagram.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
    });
  });

  describe("Mutation Endpoints (apply-layout)", () => {
    it("denies anonymous user layout changes", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: true, ownerId: "some-owner" });

      const res = await app.request(`/api/diagrams/${diagram.id}/apply-layout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ algorithm: "dagre" }),
      });

      expect(res.status).toBe(403);
    });

    it("allows owner to apply layout", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "layout-owner" });
      const token = await signJWT({ sub: "layout-owner", role: "user" });

      const res = await app.request(`/api/diagrams/${diagram.id}/apply-layout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ algorithm: "dagre" }),
      });

      expect(res.status).toBe(200);
    });

    it("allows admin to apply layout to any diagram", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "other-user" });
      const token = await signJWT({ sub: "admin-layout", role: "admin" });

      const res = await app.request(`/api/diagrams/${diagram.id}/apply-layout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ algorithm: "dagre" }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe("Error Response Format", () => {
    it("returns consistent error format for permission denied", async () => {
      const { app, createDiagram } = createTestApp();
      const diagram = createDiagram({ isPublic: false, ownerId: "owner" });

      const res = await app.request(`/api/diagrams/${diagram.id}`);

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("PERMISSION_DENIED");
      expect(body.error.message).toContain("read");
      expect(body.error.message).toContain(diagram.id);
    });

    it("returns 404 for non-existent diagram (before permission check)", async () => {
      const { app } = createTestApp();

      const res = await app.request("/api/diagrams/non-existent-id");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("Diagram Creation with Ownership", () => {
    it("creates diagram with authenticated user as owner", async () => {
      const { app } = createTestApp();
      const token = await signJWT({ sub: "creator-123", role: "user" });

      const res = await app.request("/api/diagrams", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "My Diagram",
          spec: { type: "flowchart", nodes: [], edges: [] },
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ownerId).toBe("creator-123");
    });

    it("creates diagram with null owner for anonymous", async () => {
      const { app } = createTestApp();

      const res = await app.request("/api/diagrams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Anonymous Diagram",
          spec: { type: "flowchart", nodes: [], edges: [] },
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ownerId).toBeNull();
    });

    it("creates public diagram when isPublic is true", async () => {
      const { app } = createTestApp();

      const res = await app.request("/api/diagrams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Public Diagram",
          spec: { type: "flowchart", nodes: [], edges: [] },
          isPublic: true,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.isPublic).toBe(true);
    });
  });
});
