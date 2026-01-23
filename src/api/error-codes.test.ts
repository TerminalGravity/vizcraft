/**
 * Error Codes Module Tests
 */

import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import {
  ApiError,
  errorFromCode,
  getErrorByCode,
  listErrorCodes,
  isValidErrorCode,
} from "./error-codes";

describe("ApiError constants", () => {
  describe("client errors (4xx)", () => {
    it("has correct status codes for 400 errors", () => {
      expect(ApiError.INVALID_JSON.status).toBe(400);
      expect(ApiError.VALIDATION_ERROR.status).toBe(400);
      expect(ApiError.INVALID_INPUT.status).toBe(400);
      expect(ApiError.INVALID_ACTION.status).toBe(400);
      expect(ApiError.INVALID_THUMBNAIL.status).toBe(400);
    });

    it("has correct status codes for auth errors", () => {
      expect(ApiError.UNAUTHORIZED.status).toBe(401);
      expect(ApiError.INVALID_TOKEN.status).toBe(401);
      expect(ApiError.FORBIDDEN.status).toBe(403);
      expect(ApiError.ADMIN_REQUIRED.status).toBe(403);
      expect(ApiError.PERMISSION_DENIED.status).toBe(403);
    });

    it("has correct status codes for not found errors", () => {
      expect(ApiError.NOT_FOUND.status).toBe(404);
      expect(ApiError.DIAGRAM_NOT_FOUND.status).toBe(404);
      expect(ApiError.VERSION_NOT_FOUND.status).toBe(404);
    });

    it("has correct status codes for conflict errors", () => {
      expect(ApiError.VERSION_CONFLICT.status).toBe(409);
      expect(ApiError.ALREADY_EXISTS.status).toBe(409);
    });

    it("has correct status for rate limiting", () => {
      expect(ApiError.RATE_LIMITED.status).toBe(429);
    });
  });

  describe("server errors (5xx)", () => {
    it("has correct status codes for general server errors", () => {
      expect(ApiError.INTERNAL_ERROR.status).toBe(500);
      expect(ApiError.SERVER_ERROR.status).toBe(500);
    });

    it("has correct status codes for CRUD failures", () => {
      expect(ApiError.CREATE_FAILED.status).toBe(500);
      expect(ApiError.UPDATE_FAILED.status).toBe(500);
      expect(ApiError.DELETE_FAILED.status).toBe(500);
    });

    it("has correct status codes for feature failures", () => {
      expect(ApiError.THUMBNAIL_FAILED.status).toBe(500);
      expect(ApiError.EXPORT_FAILED.status).toBe(500);
      expect(ApiError.THEME_APPLY_FAILED.status).toBe(500);
    });

    it("has correct status for upstream errors", () => {
      expect(ApiError.UPSTREAM_ERROR.status).toBe(502);
      expect(ApiError.SERVICE_UNAVAILABLE.status).toBe(503);
    });
  });

  describe("error structure", () => {
    it("all errors have required fields", () => {
      for (const [key, error] of Object.entries(ApiError)) {
        expect(error.code).toBeDefined();
        expect(error.status).toBeDefined();
        expect(error.message).toBeDefined();
        expect(typeof error.code).toBe("string");
        expect(typeof error.status).toBe("number");
        expect(typeof error.message).toBe("string");
      }
    });

    it("all error codes are uppercase with underscores", () => {
      for (const error of Object.values(ApiError)) {
        expect(error.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    });

    it("all messages are non-empty", () => {
      for (const error of Object.values(ApiError)) {
        expect(error.message.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("errorFromCode", () => {
  it("creates error response with default message", async () => {
    const app = new Hono();
    app.get("/test-default", (c) => errorFromCode(c, ApiError.NOT_FOUND));

    const res = await app.request("/test-default");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Resource not found");
  });

  it("creates error response with custom message", async () => {
    const app = new Hono();
    app.get("/test-custom", (c) =>
      errorFromCode(c, ApiError.NOT_FOUND, "Diagram xyz not found")
    );

    const res = await app.request("/test-custom");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Diagram xyz not found");
  });

  it("includes details only in development mode (security)", async () => {
    const originalEnv = process.env.NODE_ENV;

    // In development mode, details are included
    process.env.NODE_ENV = "development";
    const devApp = new Hono();
    devApp.get("/test-details", (c) =>
      errorFromCode(c, ApiError.VALIDATION_ERROR, "Invalid fields", {
        fields: ["name", "email"],
      })
    );

    const devRes = await devApp.request("/test-details");
    const devBody = await devRes.json();

    expect(devRes.status).toBe(400);
    expect(devBody.error.code).toBe("VALIDATION_ERROR");
    expect(devBody.error.details).toEqual({ fields: ["name", "email"] });

    // In production mode, details are excluded
    process.env.NODE_ENV = "production";
    const prodApp = new Hono();
    prodApp.get("/test-details", (c) =>
      errorFromCode(c, ApiError.VALIDATION_ERROR, "Invalid fields", {
        fields: ["name", "email"],
      })
    );

    const prodRes = await prodApp.request("/test-details");
    const prodBody = await prodRes.json();

    expect(prodRes.status).toBe(400);
    expect(prodBody.error.code).toBe("VALIDATION_ERROR");
    expect(prodBody.error.details).toBeUndefined();

    // Restore
    process.env.NODE_ENV = originalEnv;
  });

  it("works with different status codes", async () => {
    const app = new Hono();
    app.get("/400", (c) => errorFromCode(c, ApiError.INVALID_JSON));
    app.get("/401", (c) => errorFromCode(c, ApiError.UNAUTHORIZED));
    app.get("/403", (c) => errorFromCode(c, ApiError.FORBIDDEN));
    app.get("/500", (c) => errorFromCode(c, ApiError.INTERNAL_ERROR));

    expect((await app.request("/400")).status).toBe(400);
    expect((await app.request("/401")).status).toBe(401);
    expect((await app.request("/403")).status).toBe(403);
    expect((await app.request("/500")).status).toBe(500);
  });
});

describe("getErrorByCode", () => {
  it("returns error definition for valid code", () => {
    const error = getErrorByCode("NOT_FOUND");
    expect(error).toBeDefined();
    expect(error?.code).toBe("NOT_FOUND");
    expect(error?.status).toBe(404);
  });

  it("returns undefined for invalid code", () => {
    const error = getErrorByCode("DOES_NOT_EXIST");
    expect(error).toBeUndefined();
  });

  it("is case sensitive", () => {
    expect(getErrorByCode("not_found")).toBeUndefined();
    expect(getErrorByCode("Not_Found")).toBeUndefined();
  });
});

describe("listErrorCodes", () => {
  it("returns array of all error codes", () => {
    const codes = listErrorCodes();
    expect(Array.isArray(codes)).toBe(true);
    expect(codes.length).toBeGreaterThan(0);
  });

  it("includes expected fields", () => {
    const codes = listErrorCodes();
    for (const code of codes) {
      expect(code.code).toBeDefined();
      expect(code.status).toBeDefined();
      expect(code.message).toBeDefined();
      expect(code.category).toBeDefined();
    }
  });

  it("categorizes errors correctly", () => {
    const codes = listErrorCodes();
    const clientErrors = codes.filter((c) => c.category === "client");
    const serverErrors = codes.filter((c) => c.category === "server");

    // All client errors have status < 500
    for (const error of clientErrors) {
      expect(error.status).toBeLessThan(500);
    }

    // All server errors have status >= 500
    for (const error of serverErrors) {
      expect(error.status).toBeGreaterThanOrEqual(500);
    }
  });

  it("includes common error codes", () => {
    const codes = listErrorCodes();
    const codeStrings = codes.map((c) => c.code);

    expect(codeStrings).toContain("NOT_FOUND");
    expect(codeStrings).toContain("VALIDATION_ERROR");
    expect(codeStrings).toContain("UNAUTHORIZED");
    expect(codeStrings).toContain("INTERNAL_ERROR");
  });
});

describe("isValidErrorCode", () => {
  it("returns true for valid codes", () => {
    expect(isValidErrorCode("NOT_FOUND")).toBe(true);
    expect(isValidErrorCode("VALIDATION_ERROR")).toBe(true);
    expect(isValidErrorCode("INTERNAL_ERROR")).toBe(true);
  });

  it("returns false for invalid codes", () => {
    expect(isValidErrorCode("DOES_NOT_EXIST")).toBe(false);
    expect(isValidErrorCode("")).toBe(false);
    expect(isValidErrorCode("not_found")).toBe(false);
  });
});
