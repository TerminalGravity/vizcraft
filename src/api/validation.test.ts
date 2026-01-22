/**
 * Validation Middleware Tests
 */

import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import {
  validateBody,
  validateQuery,
  validateParams,
  validateRequest,
  uuidParamSchema,
  paginationSchema,
  diagramSpecSchema,
  createDiagramSchema,
} from "./validation";

describe("validateBody", () => {
  const schema = z.object({
    name: z.string().min(1),
    value: z.number(),
  });

  const app = new Hono();
  app.post("/test", validateBody(schema), (c) => {
    const body = c.get("validatedBody");
    return c.json({ received: body });
  });

  test("accepts valid body", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", value: 42 }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toEqual({ name: "test", value: 42 });
  });

  test("rejects invalid body", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", value: "not-a-number" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe(true);
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(json.details.length).toBeGreaterThan(0);
  });

  test("rejects invalid JSON", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(json.message).toContain("Invalid JSON");
  });

  test("rejects missing required fields", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details.some((d: { path: string }) => d.path === "value")).toBe(true);
  });
});

describe("validateQuery", () => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    search: z.string().optional(),
  });

  const app = new Hono();
  app.get("/test", validateQuery(schema), (c) => {
    const query = c.get("validatedQuery");
    return c.json({ received: query });
  });

  test("accepts valid query parameters", async () => {
    const res = await app.request("/test?page=5&search=hello");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toEqual({ page: 5, search: "hello" });
  });

  test("coerces string to number", async () => {
    const res = await app.request("/test?page=10");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received.page).toBe(10);
    expect(typeof json.received.page).toBe("number");
  });

  test("rejects invalid query parameters", async () => {
    const res = await app.request("/test?page=-1");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(json.message).toContain("query parameters");
  });
});

describe("validateParams", () => {
  const app = new Hono();
  app.get("/items/:id", validateParams(uuidParamSchema), (c) => {
    const params = c.get("validatedParams");
    return c.json({ received: params });
  });

  test("accepts valid UUID", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const res = await app.request(`/items/${uuid}`);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received.id).toBe(uuid);
  });

  test("rejects invalid UUID", async () => {
    const res = await app.request("/items/not-a-uuid");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(json.details[0].message).toContain("UUID");
  });
});

describe("validateRequest (combined)", () => {
  const bodySchema = z.object({
    name: z.string(),
  });

  const paramsSchema = z.object({
    id: z.string().uuid(),
  });

  const app = new Hono();
  app.put("/items/:id", validateRequest({ body: bodySchema, params: paramsSchema }), (c) => {
    return c.json({
      body: c.get("validatedBody"),
      params: c.get("validatedParams"),
    });
  });

  test("validates both body and params", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const res = await app.request(`/items/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.body.name).toBe("test");
    expect(json.params.id).toBe(uuid);
  });

  test("fails on invalid params before checking body", async () => {
    const res = await app.request("/items/invalid", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain("path parameters");
  });
});

describe("paginationSchema", () => {
  test("provides defaults", () => {
    const result = paginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  test("coerces string values", () => {
    const result = paginationSchema.parse({ page: "5", limit: "50" });
    expect(result.page).toBe(5);
    expect(result.limit).toBe(50);
  });

  test("enforces limits", () => {
    expect(() => paginationSchema.parse({ page: "0" })).toThrow();
    expect(() => paginationSchema.parse({ limit: "500" })).toThrow();
  });
});

describe("diagramSpecSchema", () => {
  test("accepts valid diagram spec", () => {
    const spec = {
      type: "flowchart",
      nodes: [
        { id: "1", label: "Start" },
        { id: "2", label: "End" },
      ],
      edges: [{ from: "1", to: "2" }],
    };

    const result = diagramSpecSchema.parse(spec);
    expect(result.type).toBe("flowchart");
    expect(result.nodes.length).toBe(2);
    expect(result.edges?.length).toBe(1);
  });

  test("requires at least one node", () => {
    const spec = {
      type: "flowchart",
      nodes: [],
    };

    expect(() => diagramSpecSchema.parse(spec)).toThrow();
  });

  test("validates node structure", () => {
    const spec = {
      type: "flowchart",
      nodes: [{ id: "", label: "" }],
    };

    expect(() => diagramSpecSchema.parse(spec)).toThrow();
  });

  test("validates edge references", () => {
    const spec = {
      type: "architecture",
      nodes: [{ id: "1", label: "Node" }],
      edges: [{ from: "", to: "1" }],
    };

    expect(() => diagramSpecSchema.parse(spec)).toThrow();
  });

  test("defaults edges to empty array", () => {
    const spec = {
      type: "freeform",
      nodes: [{ id: "1", label: "Solo" }],
    };

    const result = diagramSpecSchema.parse(spec);
    expect(result.edges).toEqual([]);
  });

  test("validates optional node properties", () => {
    const spec = {
      type: "flowchart",
      nodes: [
        {
          id: "1",
          label: "Decision",
          type: "diamond",
          color: "#ff0000",
          position: { x: 100, y: 200 },
          details: "Some details here",
        },
      ],
    };

    const result = diagramSpecSchema.parse(spec);
    expect(result.nodes[0].type).toBe("diamond");
    expect(result.nodes[0].position?.x).toBe(100);
  });
});

describe("createDiagramSchema", () => {
  test("accepts valid create request", () => {
    const req = {
      name: "My Diagram",
      project: "test-project",
      spec: {
        type: "flowchart",
        nodes: [{ id: "1", label: "Start" }],
      },
    };

    const result = createDiagramSchema.parse(req);
    expect(result.name).toBe("My Diagram");
    expect(result.project).toBe("test-project");
  });

  test("requires name", () => {
    const req = {
      name: "",
      spec: {
        type: "flowchart",
        nodes: [{ id: "1", label: "Start" }],
      },
    };

    expect(() => createDiagramSchema.parse(req)).toThrow();
  });

  test("project is optional", () => {
    const req = {
      name: "My Diagram",
      spec: {
        type: "flowchart",
        nodes: [{ id: "1", label: "Start" }],
      },
    };

    const result = createDiagramSchema.parse(req);
    expect(result.project).toBeUndefined();
  });
});

describe("error formatting", () => {
  const schema = z.object({
    count: z.number(),
    items: z.array(z.object({ id: z.string() })),
  });

  const app = new Hono();
  app.post("/test", validateBody(schema), (c) => c.json({ ok: true }));

  test("formats nested path errors", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count: "not-a-number",
        items: [{ id: "valid" }, { id: 123 }],
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();

    // Check paths are formatted correctly
    const paths = json.details.map((d: { path: string }) => d.path);
    expect(paths).toContain("count");
    expect(paths.some((p: string) => p.startsWith("items."))).toBe(true);
  });

  test("includes expected/received for type errors", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: "text", items: [] }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();

    const countError = json.details.find((d: { path: string }) => d.path === "count");
    expect(countError).toBeDefined();
    expect(countError?.message).toContain("number");
  });
});
