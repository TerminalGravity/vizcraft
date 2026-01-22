/**
 * Centralized Configuration Module
 *
 * All environment variables are validated at startup using Zod schemas.
 * Fail fast if required config is missing or invalid.
 *
 * Usage:
 *   import { config } from "./config";
 *   console.log(config.server.port);
 */

import { z } from "zod";
import { createLogger } from "../logging";

const log = createLogger("config");

/**
 * Environment variable schema with validation
 */
/**
 * Helper to create a port number schema with default
 */
const portSchema = (defaultPort: number) =>
  z.preprocess(
    (val) => val ?? String(defaultPort),
    z
      .string()
      .transform((s) => parseInt(s, 10))
      .pipe(z.number().int().min(1).max(65535))
  );

/**
 * Helper to create a number schema with default and range
 */
const numberSchema = (defaultValue: number, min: number, max: number) =>
  z.preprocess(
    (val) => val ?? String(defaultValue),
    z
      .string()
      .transform((s) => parseInt(s, 10))
      .pipe(z.number().int().min(min).max(max))
  );

/**
 * Helper for boolean env vars (truthy = "true" or "1")
 */
const booleanSchema = (defaultValue: boolean) =>
  z.preprocess(
    (val) => val ?? String(defaultValue),
    z.string().transform((s) => s === "true" || s === "1")
  );

const envSchema = z.object({
  // Server configuration
  PORT: portSchema(8420),
  WEB_PORT: portSchema(3420),
  WEB_URL: z.string().url().optional(),

  // Environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Data storage
  DATA_DIR: z.string().min(1).default("./data"),

  // Security
  ALLOWED_ORIGINS: z.string().optional(),

  // LLM Providers (optional)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),
  OLLAMA_MODEL: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  DEBUG: booleanSchema(false),

  // Health check thresholds
  MEMORY_LIMIT_MB: numberSchema(512, 64, 16384),
});

/**
 * Parse and validate environment variables
 */
function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    log.error("Invalid configuration", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    throw new ConfigurationError(
      `Invalid configuration: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
    );
  }

  return result.data;
}

/**
 * Validated environment variables
 */
const env = loadConfig();

/**
 * Derived configuration with grouped settings
 */
export const config = {
  /**
   * Current environment
   */
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isDevelopment: env.NODE_ENV === "development",
  isTest: env.NODE_ENV === "test",
  debug: env.DEBUG,

  /**
   * MCP Server configuration
   */
  server: {
    port: env.PORT,
    webUrl: env.WEB_URL || `http://localhost:${env.WEB_PORT}`,
  },

  /**
   * Web server configuration
   */
  web: {
    port: env.WEB_PORT,
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS, env.NODE_ENV),
  },

  /**
   * Data storage paths
   */
  data: {
    dir: env.DATA_DIR,
    diagrams: `${env.DATA_DIR}/diagrams`,
    exports: `${env.DATA_DIR}/exports`,
    thumbnails: `${env.DATA_DIR}/thumbnails`,
    agents: `${env.DATA_DIR}/agents`,
    db: `${env.DATA_DIR}/vizcraft.db`,
  },

  /**
   * LLM provider configuration
   */
  llm: {
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
      available: Boolean(env.ANTHROPIC_API_KEY),
    },
    openai: {
      apiKey: env.OPENAI_API_KEY,
      available: Boolean(env.OPENAI_API_KEY),
    },
    ollama: {
      baseUrl: env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: env.OLLAMA_MODEL || "llama3.2",
    },
  },

  /**
   * Logging configuration
   */
  logging: {
    level: env.LOG_LEVEL,
  },

  /**
   * Health check thresholds
   */
  health: {
    memoryLimitMb: env.MEMORY_LIMIT_MB,
  },
} as const;

/**
 * Parse comma-separated origins and add defaults for development
 */
function parseOrigins(origins: string | undefined, nodeEnv: string): string[] {
  const parsed = origins ? origins.split(",").map((o) => o.trim()).filter(Boolean) : [];

  // Add localhost origins in development
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

/**
 * Type for the configuration object
 */
export type Config = typeof config;

/**
 * Error thrown when configuration is invalid
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Validate configuration at import time
 * This ensures the application fails fast if config is invalid
 */
export function validateConfig(): void {
  // Config is already validated during loadConfig()
  // This function exists for explicit validation calls
  log.info("Configuration validated", {
    environment: config.env,
    dataDir: config.data.dir,
    mcpPort: config.server.port,
    webPort: config.web.port,
  });
}

/**
 * Get configuration summary for diagnostics
 */
export function getConfigSummary(): Record<string, unknown> {
  return {
    environment: config.env,
    server: {
      port: config.server.port,
      webUrl: config.server.webUrl,
    },
    web: {
      port: config.web.port,
      originsCount: config.web.allowedOrigins.length,
    },
    data: {
      dir: config.data.dir,
    },
    llm: {
      anthropicAvailable: config.llm.anthropic.available,
      openaiAvailable: config.llm.openai.available,
      ollamaUrl: config.llm.ollama.baseUrl,
    },
    logging: {
      level: config.logging.level,
    },
    health: {
      memoryLimitMb: config.health.memoryLimitMb,
    },
  };
}

// Export for testing
export { envSchema };
