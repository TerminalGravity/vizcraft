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
  it("returns trimmed ID for valid nanoid format", () => {
    // Standard 12-char nanoid
    expect(validateId("V1StGXR8_Z5j")).toBe("V1StGXR8_Z5j");
    // With whitespace
    expect(validateId("  V1StGXR8_Z5j  ")).toBe("V1StGXR8_Z5j");
    // 8 characters (minimum)
    expect(validateId("abcd1234")).toBe("abcd1234");
    // 21 characters (maximum)
    expect(validateId("abcdefghij12345678901")).toBe("abcdefghij12345678901");
    // With underscore and hyphen
    expect(validateId("test_id-123")).toBe("test_id-123");
  });

  it("throws for empty ID", () => {
    expect(() => validateId("")).toThrow(APIError);
    expect(() => validateId("   ")).toThrow(APIError);
    expect(() => validateId(undefined)).toThrow(APIError);
  });

  it("throws for ID with invalid characters", () => {
    // Special characters
    expect(() => validateId("abc!@#$%^&*")).toThrow(APIError);
    // Path traversal attempt
    expect(() => validateId("../../../etc")).toThrow(APIError);
    // SQL injection attempt
    expect(() => validateId("'; DROP TABLE")).toThrow(APIError);
    // Spaces in middle
    expect(() => validateId("valid id123")).toThrow(APIError);
    // Dots
    expect(() => validateId("valid.id.123")).toThrow(APIError);
  });

  it("throws for ID that is too short", () => {
    expect(() => validateId("abc1234")).toThrow(APIError); // 7 chars
    expect(() => validateId("short")).toThrow(APIError); // 5 chars
  });

  it("throws for ID that is too long", () => {
    expect(() => validateId("a".repeat(22))).toThrow(APIError);
    expect(() => validateId("a".repeat(100))).toThrow(APIError);
  });

  it("uses custom name in error message", () => {
    try {
      validateId("", "Diagram ID");
    } catch (err) {
      expect((err as APIError).message).toContain("Diagram ID");
    }
  });

  it("includes format hint in error for invalid format", () => {
    try {
      validateId("bad!chars", "Diagram ID");
    } catch (err) {
      expect((err as APIError).message).toContain("letters");
      expect((err as APIError).message).toContain("numbers");
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
