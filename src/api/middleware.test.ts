/**
 * API Middleware Tests
 */

import { describe, it, expect } from "bun:test";
import {
  APIError,
  validateId,
  validateVersion,
} from "./middleware";

describe("APIError", () => {
  it("creates error with default status", () => {
    const err = new APIError("TEST_CODE", "Test message");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("Test message");
    expect(err.status).toBe(400);
    expect(err.name).toBe("APIError");
  });

  it("creates error with custom status", () => {
    const err = new APIError("NOT_FOUND", "Resource not found", 404);
    expect(err.status).toBe(404);
  });
});

describe("validateId", () => {
  it("returns trimmed ID for valid input", () => {
    expect(validateId("abc123")).toBe("abc123");
    expect(validateId("  abc123  ")).toBe("abc123");
  });

  it("throws for empty ID", () => {
    expect(() => validateId("")).toThrow(APIError);
    expect(() => validateId("   ")).toThrow(APIError);
    expect(() => validateId(undefined)).toThrow(APIError);
  });

  it("uses custom name in error message", () => {
    try {
      validateId("", "Diagram ID");
    } catch (err) {
      expect((err as APIError).message).toContain("Diagram ID");
    }
  });
});

describe("validateVersion", () => {
  it("returns parsed version for valid input", () => {
    expect(validateVersion("1")).toBe(1);
    expect(validateVersion("42")).toBe(42);
    expect(validateVersion(" 10 ")).toBe(10);
  });

  it("throws for empty version", () => {
    expect(() => validateVersion("")).toThrow(APIError);
    expect(() => validateVersion(undefined)).toThrow(APIError);
  });

  it("throws for non-numeric version", () => {
    expect(() => validateVersion("abc")).toThrow(APIError);
    // Note: "1.5" parses to 1 via parseInt, which is valid
  });

  it("throws for zero or negative version", () => {
    expect(() => validateVersion("0")).toThrow(APIError);
    expect(() => validateVersion("-1")).toThrow(APIError);
  });
});
