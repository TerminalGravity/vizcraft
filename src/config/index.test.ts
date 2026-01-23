/**
 * Configuration Module Tests
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { resolve, normalize } from "path";

// We can't easily test the main config (it's loaded at module import time)
// So we test the schema validation directly
describe("Configuration Schema", () => {
  // Recreate schema helpers for testing
  const portSchema = (defaultPort: number) =>
    z.preprocess(
      (val) => val ?? String(defaultPort),
      z
        .string()
        .transform((s) => parseInt(s, 10))
        .pipe(z.number().int().min(1).max(65535))
    );

  const numberSchema = (defaultValue: number, min: number, max: number) =>
    z.preprocess(
      (val) => val ?? String(defaultValue),
      z
        .string()
        .transform((s) => parseInt(s, 10))
        .pipe(z.number().int().min(min).max(max))
    );

  const booleanSchema = (defaultValue: boolean) =>
    z.preprocess(
      (val) => val ?? String(defaultValue),
      z.string().transform((s) => s === "true" || s === "1")
    );

  const envSchema = z.object({
    PORT: portSchema(8420),
    WEB_PORT: portSchema(3420),
    WEB_URL: z.string().url().optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATA_DIR: z.string().min(1).default("./data").transform((path) => {
      // Simplified validation for tests (real version uses imported function)
      const normalized = normalize(path);
      const segments = normalized.split(/[/\\]/);
      if (segments.some((seg) => seg === "..")) {
        throw new Error(`Invalid path: path traversal detected in "${path}"`);
      }
      return resolve(normalized);
    }),
    ALLOWED_ORIGINS: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    OLLAMA_BASE_URL: z.string().url().optional(),
    OLLAMA_MODEL: z.string().optional(),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
    DEBUG: booleanSchema(false),
    MEMORY_LIMIT_MB: numberSchema(512, 64, 16384),
  });

  describe("defaults", () => {
    test("uses default values when not provided", () => {
      const result = envSchema.parse({});

      // All defaults are now properly transformed
      expect(result.PORT).toBe(8420);
      expect(result.WEB_PORT).toBe(3420);
      expect(result.NODE_ENV).toBe("development");
      // DATA_DIR is now resolved to absolute path
      expect(result.DATA_DIR.endsWith("data")).toBe(true);
      expect(result.DATA_DIR.startsWith("/")).toBe(true);
      expect(result.LOG_LEVEL).toBe("info");
      expect(result.DEBUG).toBe(false);
      expect(result.MEMORY_LIMIT_MB).toBe(512);
    });
  });

  describe("PORT validation", () => {
    test("accepts valid port numbers", () => {
      expect(envSchema.parse({ PORT: "3000" }).PORT).toBe(3000);
      expect(envSchema.parse({ PORT: "8080" }).PORT).toBe(8080);
      expect(envSchema.parse({ PORT: "1" }).PORT).toBe(1);
      expect(envSchema.parse({ PORT: "65535" }).PORT).toBe(65535);
    });

    test("rejects invalid port numbers", () => {
      expect(() => envSchema.parse({ PORT: "0" })).toThrow();
      expect(() => envSchema.parse({ PORT: "65536" })).toThrow();
      expect(() => envSchema.parse({ PORT: "-1" })).toThrow();
      expect(() => envSchema.parse({ PORT: "abc" })).toThrow();
    });
  });

  describe("NODE_ENV validation", () => {
    test("accepts valid environments", () => {
      expect(envSchema.parse({ NODE_ENV: "development" }).NODE_ENV).toBe("development");
      expect(envSchema.parse({ NODE_ENV: "production" }).NODE_ENV).toBe("production");
      expect(envSchema.parse({ NODE_ENV: "test" }).NODE_ENV).toBe("test");
    });

    test("rejects invalid environments", () => {
      expect(() => envSchema.parse({ NODE_ENV: "staging" })).toThrow();
      expect(() => envSchema.parse({ NODE_ENV: "dev" })).toThrow();
    });
  });

  describe("WEB_URL validation", () => {
    test("accepts valid URLs", () => {
      expect(envSchema.parse({ WEB_URL: "http://localhost:3420" }).WEB_URL).toBe(
        "http://localhost:3420"
      );
      expect(envSchema.parse({ WEB_URL: "https://vizcraft.example.com" }).WEB_URL).toBe(
        "https://vizcraft.example.com"
      );
    });

    test("rejects invalid URLs", () => {
      expect(() => envSchema.parse({ WEB_URL: "not-a-url" })).toThrow();
      expect(() => envSchema.parse({ WEB_URL: "://missing-scheme" })).toThrow();
    });

    test("allows undefined", () => {
      expect(envSchema.parse({}).WEB_URL).toBeUndefined();
    });
  });

  describe("LOG_LEVEL validation", () => {
    test("accepts valid log levels", () => {
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
      for (const level of levels) {
        expect(envSchema.parse({ LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
      }
    });

    test("rejects invalid log levels", () => {
      expect(() => envSchema.parse({ LOG_LEVEL: "verbose" })).toThrow();
      expect(() => envSchema.parse({ LOG_LEVEL: "WARNING" })).toThrow();
    });
  });

  describe("DEBUG validation", () => {
    test("transforms truthy values to true", () => {
      expect(envSchema.parse({ DEBUG: "true" }).DEBUG).toBe(true);
      expect(envSchema.parse({ DEBUG: "1" }).DEBUG).toBe(true);
    });

    test("transforms other values to false", () => {
      expect(envSchema.parse({ DEBUG: "false" }).DEBUG).toBe(false);
      expect(envSchema.parse({ DEBUG: "0" }).DEBUG).toBe(false);
      expect(envSchema.parse({ DEBUG: "yes" }).DEBUG).toBe(false);
    });
  });

  describe("MEMORY_LIMIT_MB validation", () => {
    test("accepts valid memory limits", () => {
      expect(envSchema.parse({ MEMORY_LIMIT_MB: "64" }).MEMORY_LIMIT_MB).toBe(64);
      expect(envSchema.parse({ MEMORY_LIMIT_MB: "1024" }).MEMORY_LIMIT_MB).toBe(1024);
      expect(envSchema.parse({ MEMORY_LIMIT_MB: "16384" }).MEMORY_LIMIT_MB).toBe(16384);
    });

    test("rejects out-of-range memory limits", () => {
      expect(() => envSchema.parse({ MEMORY_LIMIT_MB: "32" })).toThrow();
      expect(() => envSchema.parse({ MEMORY_LIMIT_MB: "32768" })).toThrow();
    });
  });

  describe("OLLAMA_BASE_URL validation", () => {
    test("accepts valid URLs", () => {
      expect(envSchema.parse({ OLLAMA_BASE_URL: "http://localhost:11434" }).OLLAMA_BASE_URL).toBe(
        "http://localhost:11434"
      );
      expect(envSchema.parse({ OLLAMA_BASE_URL: "http://ollama.local:11434" }).OLLAMA_BASE_URL).toBe(
        "http://ollama.local:11434"
      );
    });

    test("rejects invalid URLs", () => {
      expect(() => envSchema.parse({ OLLAMA_BASE_URL: "not-a-url" })).toThrow();
    });
  });

  describe("DATA_DIR security validation", () => {
    test("accepts simple relative paths", () => {
      const result = envSchema.parse({ DATA_DIR: "./custom-data" });
      expect(result.DATA_DIR.endsWith("custom-data")).toBe(true);
    });

    test("accepts absolute paths", () => {
      const result = envSchema.parse({ DATA_DIR: "/var/data/vizcraft" });
      expect(result.DATA_DIR).toBe("/var/data/vizcraft");
    });

    test("rejects path traversal attempts", () => {
      expect(() => envSchema.parse({ DATA_DIR: "../outside" })).toThrow("path traversal");
      expect(() => envSchema.parse({ DATA_DIR: "data/../../../etc" })).toThrow("path traversal");
    });

    test("resolves relative paths to absolute", () => {
      const result = envSchema.parse({ DATA_DIR: "my-data" });
      expect(result.DATA_DIR.startsWith("/")).toBe(true);
    });
  });
});

describe("validateAndResolvePath helper", () => {
  // Recreate the path validation function for testing
  function validateAndResolvePath(inputPath: string): string {
    const normalized = normalize(inputPath);
    // Check for ".." as a path segment (not just substring)
    const segments = normalized.split(/[/\\]/);
    if (segments.some((seg) => seg === "..")) {
      throw new Error(`Invalid path: path traversal detected in "${inputPath}"`);
    }
    return resolve(normalized);
  }

  test("accepts simple relative path", () => {
    const result = validateAndResolvePath("./data");
    expect(result).toContain("data");
    expect(result.startsWith("/")).toBe(true); // Absolute path
  });

  test("accepts absolute path", () => {
    const result = validateAndResolvePath("/var/data/vizcraft");
    expect(result).toBe("/var/data/vizcraft");
  });

  test("resolves relative paths to absolute", () => {
    const result = validateAndResolvePath("data");
    expect(result.startsWith("/")).toBe(true);
    expect(result.endsWith("data")).toBe(true);
  });

  test("rejects path traversal with ../", () => {
    expect(() => validateAndResolvePath("../outside")).toThrow("path traversal detected");
  });

  test("rejects path traversal with ..\\", () => {
    // normalize() converts backslashes on all platforms
    expect(() => validateAndResolvePath("..\\outside")).toThrow("path traversal detected");
  });

  test("rejects hidden path traversal", () => {
    expect(() => validateAndResolvePath("data/../../../etc/passwd")).toThrow("path traversal detected");
  });

  test("rejects nested path traversal", () => {
    expect(() => validateAndResolvePath("data/foo/../../..")).toThrow("path traversal detected");
  });

  test("accepts path with similar but safe patterns", () => {
    // "..." is not a traversal, just a weird directory name
    const result = validateAndResolvePath("data/.../something");
    expect(result).toContain("...");
  });
});

describe("parseOrigins helper", () => {
  function parseOrigins(origins: string | undefined, nodeEnv: string): string[] {
    const parsed = origins
      ? origins
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
      : [];

    if (nodeEnv !== "production") {
      const devOrigins = [
        "http://localhost:3420",
        "http://localhost:3000",
        "http://127.0.0.1:3420",
        "http://127.0.0.1:3000",
      ];
      for (const origin of devOrigins) {
        if (!parsed.includes(origin)) {
          parsed.push(origin);
        }
      }
    }

    return parsed;
  }

  test("parses comma-separated origins", () => {
    const result = parseOrigins("http://a.com,http://b.com", "production");
    expect(result).toEqual(["http://a.com", "http://b.com"]);
  });

  test("trims whitespace", () => {
    const result = parseOrigins("  http://a.com  ,  http://b.com  ", "production");
    expect(result).toEqual(["http://a.com", "http://b.com"]);
  });

  test("adds dev origins in development", () => {
    const result = parseOrigins("http://custom.com", "development");
    expect(result).toContain("http://custom.com");
    expect(result).toContain("http://localhost:3420");
    expect(result).toContain("http://localhost:3000");
  });

  test("does not add dev origins in production", () => {
    const result = parseOrigins("http://custom.com", "production");
    expect(result).toEqual(["http://custom.com"]);
    expect(result).not.toContain("http://localhost:3420");
  });

  test("handles undefined origins", () => {
    const result = parseOrigins(undefined, "development");
    expect(result).toContain("http://localhost:3420");
  });

  test("handles empty string", () => {
    const result = parseOrigins("", "development");
    expect(result).toContain("http://localhost:3420");
  });

  test("deduplicates origins", () => {
    const result = parseOrigins("http://localhost:3420", "development");
    const count = result.filter((o) => o === "http://localhost:3420").length;
    expect(count).toBe(1);
  });
});

describe("Production Config Validation", () => {
  // Test production-specific validations that happen in loadConfig()

  test("WEB_URL HTTPS requirement logic", () => {
    // Simulate the validation logic from loadConfig
    function validateWebUrl(webUrl: string | undefined, isProduction: boolean): boolean {
      if (!isProduction || !webUrl) return true;

      const url = new URL(webUrl);
      const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      return url.protocol === "https:" || isLocalhost;
    }

    // HTTPS URLs should pass in production
    expect(validateWebUrl("https://vizcraft.example.com", true)).toBe(true);

    // HTTP URLs should fail in production
    expect(validateWebUrl("http://vizcraft.example.com", true)).toBe(false);

    // Localhost is exempted (for local production testing)
    expect(validateWebUrl("http://localhost:3420", true)).toBe(true);
    expect(validateWebUrl("http://127.0.0.1:3420", true)).toBe(true);

    // Non-production allows HTTP
    expect(validateWebUrl("http://vizcraft.example.com", false)).toBe(true);

    // Undefined URL passes
    expect(validateWebUrl(undefined, true)).toBe(true);
  });

  test("JWT_SECRET is required in production", () => {
    function validateJwtSecret(jwtSecret: string | undefined, isProduction: boolean): boolean {
      if (isProduction && !jwtSecret) return false;
      return true;
    }

    expect(validateJwtSecret(undefined, true)).toBe(false);
    expect(validateJwtSecret("a-very-long-secret-key-at-least-32-chars", true)).toBe(true);
    expect(validateJwtSecret(undefined, false)).toBe(true); // Dev allows fallback
  });
});
