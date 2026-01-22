/**
 * API Response Helpers Tests
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import {
  resourceResponse,
  collectionResponse,
  paginatedResponse,
  errorResponse,
  notFoundResponse,
  validationErrorResponse,
  operationResponse,
  createdResponse,
  withETag,
  setCacheStatus,
  notModified,
  textResponse,
  downloadResponse,
} from "./responses";

// Helper to create a test app and make requests
function createTestApp() {
  return new Hono();
}

async function getJsonResponse(response: Response) {
  return response.json();
}

describe("resourceResponse", () => {
  it("returns data wrapper for single resource", async () => {
    const app = createTestApp();
    app.get("/test", (c) => resourceResponse(c, { id: "123", name: "Test" }));

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(res.status).toBe(200);
    expect(json).toEqual({ data: { id: "123", name: "Test" } });
  });

  it("includes meta when provided", async () => {
    const app = createTestApp();
    app.get("/test", (c) =>
      resourceResponse(c, { id: "123" }, { cached: true, etag: "abc123" })
    );

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(json).toEqual({
      data: { id: "123" },
      meta: { cached: true, etag: "abc123" },
    });
  });

  it("omits meta when empty object", async () => {
    const app = createTestApp();
    app.get("/test", (c) => resourceResponse(c, { id: "123" }, {}));

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(json).toEqual({ data: { id: "123" } });
    expect(json.meta).toBeUndefined();
  });

  it("returns 201 status when specified", async () => {
    const app = createTestApp();
    app.post("/test", (c) => resourceResponse(c, { id: "new" }, undefined, 201));

    const res = await app.request("/test", { method: "POST" });

    expect(res.status).toBe(201);
  });
});

describe("collectionResponse", () => {
  it("returns data array with pagination meta", async () => {
    const app = createTestApp();
    app.get("/test", (c) =>
      collectionResponse(c, [{ id: "1" }, { id: "2" }], {
        total: 10,
        page: 1,
        pageSize: 2,
        hasMore: true,
      })
    );

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(res.status).toBe(200);
    expect(json).toEqual({
      data: [{ id: "1" }, { id: "2" }],
      meta: {
        total: 10,
        page: 1,
        pageSize: 2,
        hasMore: true,
      },
    });
  });

  it("handles empty arrays", async () => {
    const app = createTestApp();
    app.get("/test", (c) =>
      collectionResponse(c, [], {
        total: 0,
        page: 1,
        pageSize: 10,
        hasMore: false,
      })
    );

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(json.data).toEqual([]);
    expect(json.meta.total).toBe(0);
    expect(json.meta.hasMore).toBe(false);
  });
});

describe("paginatedResponse", () => {
  it("calculates pagination from offset", async () => {
    const app = createTestApp();
    app.get("/test", (c) =>
      paginatedResponse(c, [{ id: "3" }, { id: "4" }], 100, 20, 10)
    );

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(json.meta).toEqual({
      total: 100,
      page: 3, // offset 20 / limit 10 + 1 = 3
      pageSize: 10,
      hasMore: true, // 20 + 2 < 100
      offset: 20,
    });
  });

  it("sets hasMore to false on last page", async () => {
    const app = createTestApp();
    app.get("/test", (c) =>
      paginatedResponse(c, [{ id: "9" }, { id: "10" }], 10, 8, 5)
    );

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(json.meta.hasMore).toBe(false); // 8 + 2 >= 10
    expect(json.meta.page).toBe(2); // offset 8 / limit 5 + 1 = 2
  });

  it("handles first page", async () => {
    const app = createTestApp();
    app.get("/test", (c) =>
      paginatedResponse(c, [{ id: "1" }], 50, 0, 10)
    );

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(json.meta.page).toBe(1);
    expect(json.meta.offset).toBe(0);
    expect(json.meta.hasMore).toBe(true);
  });
});

describe("errorResponse", () => {
  it("returns error structure with code and message", async () => {
    const app = createTestApp();
    app.get("/test", (c) => errorResponse(c, "INVALID_INPUT", "Bad data"));

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(res.status).toBe(400);
    expect(json).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Bad data",
      },
    });
  });

  it("includes details when provided", async () => {
    const app = createTestApp();
    app.get("/test", (c) =>
      errorResponse(c, "VALIDATION_ERROR", "Invalid fields", 400, {
        fields: ["name", "email"],
      })
    );

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(json.error.details).toEqual({ fields: ["name", "email"] });
  });

  it("supports different status codes", async () => {
    const app = createTestApp();
    app.get("/401", (c) => errorResponse(c, "UNAUTHORIZED", "No token", 401));
    app.get("/403", (c) => errorResponse(c, "FORBIDDEN", "No access", 403));
    app.get("/404", (c) => errorResponse(c, "NOT_FOUND", "Missing", 404));
    app.get("/500", (c) => errorResponse(c, "SERVER_ERROR", "Crash", 500));

    expect((await app.request("/401")).status).toBe(401);
    expect((await app.request("/403")).status).toBe(403);
    expect((await app.request("/404")).status).toBe(404);
    expect((await app.request("/500")).status).toBe(500);
  });
});

describe("notFoundResponse", () => {
  it("generates message with resource name", async () => {
    const app = createTestApp();
    app.get("/test", (c) => notFoundResponse(c, "Diagram"));

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(res.status).toBe(404);
    expect(json.error.code).toBe("NOT_FOUND");
    expect(json.error.message).toBe("Diagram not found");
  });

  it("includes ID in message when provided", async () => {
    const app = createTestApp();
    app.get("/test", (c) => notFoundResponse(c, "Diagram", "abc123"));

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(json.error.message).toBe("Diagram with ID 'abc123' not found");
  });
});

describe("validationErrorResponse", () => {
  it("returns validation error with message", async () => {
    const app = createTestApp();
    app.get("/test", (c) =>
      validationErrorResponse(c, "Name is required")
    );

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toBe("Name is required");
  });

  it("includes details when provided", async () => {
    const app = createTestApp();
    app.get("/test", (c) =>
      validationErrorResponse(c, "Invalid input", { field: "email" })
    );

    const res = await app.request("/test");
    const json = await getJsonResponse(res);

    expect(json.error.details).toEqual({ field: "email" });
  });
});

describe("operationResponse", () => {
  it("returns success status", async () => {
    const app = createTestApp();
    app.delete("/test", (c) => operationResponse(c, true));

    const res = await app.request("/test", { method: "DELETE" });
    const json = await getJsonResponse(res);

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });
  });

  it("includes message when provided", async () => {
    const app = createTestApp();
    app.delete("/test", (c) => operationResponse(c, true, "Deleted successfully"));

    const res = await app.request("/test", { method: "DELETE" });
    const json = await getJsonResponse(res);

    expect(json).toEqual({ success: true, message: "Deleted successfully" });
  });

  it("can indicate failure", async () => {
    const app = createTestApp();
    app.delete("/test", (c) => operationResponse(c, false, "Operation failed"));

    const res = await app.request("/test", { method: "DELETE" });
    const json = await getJsonResponse(res);

    expect(json).toEqual({ success: false, message: "Operation failed" });
  });
});

describe("createdResponse", () => {
  it("returns 201 with data", async () => {
    const app = createTestApp();
    app.post("/test", (c) => createdResponse(c, { id: "new123", name: "New" }));

    const res = await app.request("/test", { method: "POST" });
    const json = await getJsonResponse(res);

    expect(res.status).toBe(201);
    expect(json).toEqual({ data: { id: "new123", name: "New" } });
  });

  it("sets Location header when provided", async () => {
    const app = createTestApp();
    app.post("/test", (c) =>
      createdResponse(c, { id: "new123" }, "/api/diagrams/new123")
    );

    const res = await app.request("/test", { method: "POST" });

    expect(res.headers.get("Location")).toBe("/api/diagrams/new123");
  });

  it("includes meta when provided", async () => {
    const app = createTestApp();
    app.post("/test", (c) =>
      createdResponse(c, { id: "new" }, "/api/new", { complexity: 5 })
    );

    const res = await app.request("/test", { method: "POST" });
    const json = await getJsonResponse(res);

    expect(json.meta).toEqual({ complexity: 5 });
  });
});

describe("withETag", () => {
  it("sets ETag and Cache-Control headers", async () => {
    const app = createTestApp();
    app.get("/test", (c) => {
      const notChanged = withETag(c, '"abc123"');
      if (notChanged) return notModified();
      return c.json({ data: "test" });
    });

    const res = await app.request("/test");

    expect(res.headers.get("ETag")).toBe('"abc123"');
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    expect(res.status).toBe(200);
  });

  it("returns true when If-None-Match matches ETag", async () => {
    const app = createTestApp();
    app.get("/test", (c) => {
      const notChanged = withETag(c, '"abc123"');
      if (notChanged) return notModified();
      return c.json({ data: "test" });
    });

    const res = await app.request("/test", {
      headers: { "If-None-Match": '"abc123"' },
    });

    expect(res.status).toBe(304);
  });

  it("uses custom cache control", async () => {
    const app = createTestApp();
    app.get("/test", (c) => {
      withETag(c, '"etag"', "public, max-age=3600");
      return c.json({ data: "test" });
    });

    const res = await app.request("/test");

    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });
});

describe("setCacheStatus", () => {
  it("sets X-Cache header for hit", async () => {
    const app = createTestApp();
    app.get("/test", (c) => {
      setCacheStatus(c, true);
      return c.json({ data: "cached" });
    });

    const res = await app.request("/test");

    expect(res.headers.get("X-Cache")).toBe("HIT");
  });

  it("sets X-Cache header for miss", async () => {
    const app = createTestApp();
    app.get("/test", (c) => {
      setCacheStatus(c, false);
      return c.json({ data: "fresh" });
    });

    const res = await app.request("/test");

    expect(res.headers.get("X-Cache")).toBe("MISS");
  });
});

describe("notModified", () => {
  it("returns 304 response with no body", async () => {
    const res = notModified();

    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });
});

describe("textResponse", () => {
  it("returns plain text", async () => {
    const res = textResponse("Hello, World!");

    expect(res.headers.get("Content-Type")).toBe("text/plain");
    expect(await res.text()).toBe("Hello, World!");
  });

  it("supports custom content type", async () => {
    const res = textResponse("graph TD; A-->B;", "text/vnd.mermaid");

    expect(res.headers.get("Content-Type")).toBe("text/vnd.mermaid");
    expect(await res.text()).toBe("graph TD; A-->B;");
  });
});

describe("downloadResponse", () => {
  it("sets download headers for string content", async () => {
    const res = downloadResponse(
      "file content",
      "diagram.txt",
      "text/plain"
    );

    expect(res.headers.get("Content-Type")).toBe("text/plain");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="diagram.txt"'
    );
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(await res.text()).toBe("file content");
  });

  it("handles binary content", async () => {
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);
    view.set([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes

    const res = downloadResponse(buffer, "image.png", "image/png");

    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="image.png"'
    );

    const responseBuffer = await res.arrayBuffer();
    expect(new Uint8Array(responseBuffer)).toEqual(view);
  });
});
