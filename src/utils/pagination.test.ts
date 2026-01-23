/**
 * Tests for pagination utilities
 */

import { describe, test, expect } from "bun:test";
import {
  parsePagination,
  parseLimit,
  paginationPresets,
} from "./pagination";

describe("pagination utilities", () => {
  describe("parsePagination", () => {
    test("uses defaults when no params provided", () => {
      const result = parsePagination(undefined, undefined);
      expect(result).toEqual({ limit: 50, offset: 0 });
    });

    test("parses valid limit and offset", () => {
      const result = parsePagination("25", "10");
      expect(result).toEqual({ limit: 25, offset: 10 });
    });

    test("clamps limit to maxLimit", () => {
      const result = parsePagination("200", "0");
      expect(result.limit).toBe(100); // default maxLimit
    });

    test("clamps limit to minLimit", () => {
      const result = parsePagination("0", "0");
      expect(result.limit).toBe(1); // default minLimit
    });

    test("clamps negative limit to minLimit", () => {
      const result = parsePagination("-5", "0");
      expect(result.limit).toBe(1);
    });

    test("handles invalid limit string", () => {
      const result = parsePagination("abc", "0");
      expect(result.limit).toBe(50); // falls back to default
    });

    test("handles empty limit string", () => {
      const result = parsePagination("", "0");
      expect(result.limit).toBe(50); // NaN falls back to default
    });

    test("uses 0 for negative offset", () => {
      const result = parsePagination("10", "-5");
      expect(result.offset).toBe(0);
    });

    test("handles invalid offset string", () => {
      const result = parsePagination("10", "xyz");
      expect(result.offset).toBe(0); // falls back to default
    });

    test("accepts large valid offset", () => {
      const result = parsePagination("10", "1000");
      expect(result.offset).toBe(1000);
    });

    test("respects custom config", () => {
      const result = parsePagination("100", "0", {
        defaultLimit: 20,
        maxLimit: 50,
      });
      expect(result.limit).toBe(50); // clamped to custom maxLimit
    });

    test("respects custom defaultLimit", () => {
      const result = parsePagination(undefined, undefined, {
        defaultLimit: 25,
      });
      expect(result.limit).toBe(25);
    });

    test("respects custom defaultOffset", () => {
      const result = parsePagination(undefined, undefined, {
        defaultOffset: 10,
      });
      expect(result.offset).toBe(10);
    });

    test("handles float values by truncating", () => {
      const result = parsePagination("25.7", "10.3");
      expect(result.limit).toBe(25);
      expect(result.offset).toBe(10);
    });

    test("handles whitespace in params", () => {
      const result = parsePagination(" 25 ", " 10 ");
      expect(result.limit).toBe(25);
      expect(result.offset).toBe(10);
    });
  });

  describe("parseLimit", () => {
    test("uses default when no param provided", () => {
      const result = parseLimit(undefined);
      expect(result).toBe(50);
    });

    test("parses valid limit", () => {
      const result = parseLimit("25");
      expect(result).toBe(25);
    });

    test("clamps to maxLimit", () => {
      const result = parseLimit("200", { maxLimit: 100 });
      expect(result).toBe(100);
    });

    test("respects custom config", () => {
      const result = parseLimit("100", { defaultLimit: 20, maxLimit: 50 });
      expect(result).toBe(50);
    });
  });

  describe("paginationPresets", () => {
    describe("standard", () => {
      test("uses standard defaults", () => {
        const result = paginationPresets.standard();
        expect(result).toEqual({ limit: 50, offset: 0 });
      });

      test("parses valid params", () => {
        const result = paginationPresets.standard("25", "10");
        expect(result).toEqual({ limit: 25, offset: 10 });
      });

      test("maxLimit is 100", () => {
        const result = paginationPresets.standard("200", "0");
        expect(result.limit).toBe(100);
      });
    });

    describe("versions", () => {
      test("uses version-specific defaults", () => {
        const result = paginationPresets.versions();
        expect(result).toEqual({ limit: 20, offset: 0 });
      });

      test("maxLimit is 50", () => {
        const result = paginationPresets.versions("100", "0");
        expect(result.limit).toBe(50);
      });
    });

    describe("timeline", () => {
      test("uses timeline-specific defaults", () => {
        const result = paginationPresets.timeline();
        expect(result).toEqual({ limit: 50, offset: 0 });
      });

      test("maxLimit is 100", () => {
        const result = paginationPresets.timeline("200", "0");
        expect(result.limit).toBe(100);
      });
    });
  });
});
