/**
 * Structured Logging Module
 *
 * Provides JSON-formatted logs with:
 * - Configurable log levels (debug, info, warn, error)
 * - Module/context tagging
 * - Request correlation IDs
 * - Timestamp and metadata fields
 *
 * Usage:
 *   import { logger, createLogger } from './logging';
 *   logger.info('Server started', { port: 8420 });
 *   const dbLogger = createLogger('db');
 *   dbLogger.debug('Query executed', { query: '...', duration: 15 });
 */

// ==================== Configuration ====================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const LOG_CONFIG = {
  /** Minimum log level to output */
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',

  /** Whether to pretty-print JSON (dev mode) */
  pretty: process.env.LOG_PRETTY === 'true' || process.env.NODE_ENV === 'development',

  /** Include stack traces for errors */
  includeStack: process.env.LOG_INCLUDE_STACK !== 'false',

  /** Service name for log identification */
  service: process.env.LOG_SERVICE || 'vizcraft',
} as const;

// ==================== Types ====================

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  module?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface LogMetadata {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, meta?: LogMetadata): void;
  info(message: string, meta?: LogMetadata): void;
  warn(message: string, meta?: LogMetadata): void;
  error(message: string, meta?: LogMetadata | Error): void;
  child(context: { module?: string; correlationId?: string; [key: string]: unknown }): Logger;
}

// ==================== Correlation ID Storage ====================

/**
 * AsyncLocalStorage for request correlation IDs
 * Allows automatic propagation of correlation ID through async call chains
 */
const correlationStorage = new Map<string, string>();
let currentCorrelationId: string | undefined;

/**
 * Run a function with a correlation ID bound to the context
 */
export function withCorrelationId<T>(id: string, fn: () => T): T {
  const previousId = currentCorrelationId;
  currentCorrelationId = id;
  try {
    return fn();
  } finally {
    currentCorrelationId = previousId;
  }
}

/**
 * Run an async function with a correlation ID bound to the context
 */
export async function withCorrelationIdAsync<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previousId = currentCorrelationId;
  currentCorrelationId = id;
  try {
    return await fn();
  } finally {
    currentCorrelationId = previousId;
  }
}

/**
 * Get the current correlation ID
 */
export function getCorrelationId(): string | undefined {
  return currentCorrelationId;
}

/**
 * Set correlation ID manually (for cases where withCorrelationId isn't suitable)
 */
export function setCorrelationId(id: string | undefined): void {
  currentCorrelationId = id;
}

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

// ==================== Logger Implementation ====================

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[LOG_CONFIG.level];
}

function formatError(error: Error | unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(LOG_CONFIG.includeStack && error.stack ? { stack: error.stack } : {}),
    };
  }
  return { errorValue: String(error) };
}

// ==================== Sensitive Data Sanitization ====================

/**
 * Keys that commonly contain sensitive data
 * Case-insensitive matching
 */
const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'pass', 'pwd',
  'secret', 'secrets',
  'token', 'tokens', 'accesstoken', 'refreshtoken', 'bearertoken',
  'apikey', 'api_key', 'apikeys',
  'key', 'privatekey', 'private_key', 'publickey',
  'credential', 'credentials', 'cred',
  'auth', 'authorization',
  'cookie', 'cookies', 'sessionid', 'session_id',
  'jwt', 'bearer',
  'ssn', 'socialsecurity',
  'credit', 'creditcard', 'card', 'cardnumber', 'cvv', 'cvc',
]);

/**
 * Patterns that look like API keys or tokens
 */
const SENSITIVE_VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}$/,    // OpenAI API keys
  /^sk_[a-zA-Z0-9]{20,}$/,    // Stripe keys
  /^pk_[a-zA-Z0-9]{20,}$/,    // Stripe public keys
  /^AKIA[A-Z0-9]{16}$/,       // AWS Access Key IDs
  /^ghp_[a-zA-Z0-9]{36}$/,    // GitHub personal access tokens
  /^gho_[a-zA-Z0-9]{36}$/,    // GitHub OAuth tokens
  /^xox[baprs]-[a-zA-Z0-9-]+$/, // Slack tokens
  /^eyJ[a-zA-Z0-9-_]+\.eyJ[a-zA-Z0-9-_]+/, // JWT tokens
];

/**
 * Check if a key name suggests sensitive data
 */
function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
  return SENSITIVE_KEYS.has(normalizedKey);
}

/**
 * Check if a value looks like a secret
 */
function isSensitiveValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Only check strings that are reasonably long (potential secrets)
  if (value.length < 20) return false;
  return SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Sanitize a value for logging
 */
function sanitizeValue(key: string, value: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 5) return '[nested too deep]';

  // Check if this key should be redacted
  if (isSensitiveKey(key)) {
    return '[REDACTED]';
  }

  // Check if string value looks like a secret
  if (typeof value === 'string' && isSensitiveValue(value)) {
    // Show first and last few chars for debugging
    const len = value.length;
    if (len > 10) {
      return `${value.slice(0, 4)}...${value.slice(-4)} [REDACTED ${len} chars]`;
    }
    return '[REDACTED]';
  }

  // Recursively sanitize objects
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map((v, i) => sanitizeValue(String(i), v, depth + 1));
    }
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      sanitized[k] = sanitizeValue(k, v, depth + 1);
    }
    return sanitized;
  }

  return value;
}

/**
 * Sanitize metadata object for safe logging
 */
function sanitizeMetadata(metadata: LogMetadata): LogMetadata {
  const sanitized: LogMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key] = sanitizeValue(key, value);
  }
  return sanitized;
}

function writeLog(entry: LogEntry): void {
  const output = LOG_CONFIG.pretty
    ? JSON.stringify(entry, null, 2)
    : JSON.stringify(entry);

  // Use appropriate console method based on level
  if (entry.level === 'error') {
    console.error(output);
  } else if (entry.level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

function createLoggerImpl(
  baseContext: { module?: string; correlationId?: string; [key: string]: unknown } = {}
): Logger {
  const log = (level: LogLevel, message: string, meta?: LogMetadata | Error): void => {
    if (!shouldLog(level)) return;

    // Handle Error objects specially
    let metadata: LogMetadata = {};
    if (meta instanceof Error) {
      metadata = formatError(meta);
    } else if (meta) {
      metadata = { ...meta };
      // If metadata contains an error, format it
      if (metadata.error instanceof Error) {
        metadata = { ...metadata, ...formatError(metadata.error) };
        delete metadata.error;
      }
    }

    // Sanitize metadata to prevent sensitive data from appearing in logs
    metadata = sanitizeMetadata(metadata);

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: LOG_CONFIG.service,
      ...(baseContext.module && { module: baseContext.module }),
      ...(baseContext.correlationId || currentCorrelationId) && {
        correlationId: baseContext.correlationId || currentCorrelationId,
      },
      ...Object.fromEntries(
        Object.entries(baseContext).filter(([k]) => k !== 'module' && k !== 'correlationId')
      ),
      ...metadata,
    };

    writeLog(entry);
  };

  return {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    child: (context) => createLoggerImpl({ ...baseContext, ...context }),
  };
}

// ==================== Exports ====================

/**
 * Root logger instance
 */
export const logger = createLoggerImpl();

/**
 * Create a module-scoped logger
 * @param module - Module name (e.g., 'db', 'auth', 'ws')
 */
export function createLogger(module: string): Logger {
  return logger.child({ module });
}

/**
 * Create a request-scoped logger with correlation ID
 * @param correlationId - Request correlation ID
 * @param module - Optional module name
 */
export function createRequestLogger(correlationId: string, module?: string): Logger {
  return logger.child({ correlationId, ...(module && { module }) });
}

// ==================== Middleware Helper ====================

/**
 * Extract or generate correlation ID from request
 */
export function getRequestCorrelationId(req: Request): string {
  return (
    req.headers.get('x-correlation-id') ||
    req.headers.get('x-request-id') ||
    generateCorrelationId()
  );
}

/**
 * Create logging middleware context for a request
 */
export function createRequestContext(req: Request): {
  correlationId: string;
  logger: Logger;
  method: string;
  path: string;
} {
  const correlationId = getRequestCorrelationId(req);
  const url = new URL(req.url);

  return {
    correlationId,
    logger: createRequestLogger(correlationId),
    method: req.method,
    path: url.pathname,
  };
}
