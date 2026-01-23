/**
 * Utility functions and patterns
 */

// Circuit breaker pattern for protecting against cascading failures
export {
  CircuitBreaker,
  CircuitBreakerError,
  circuitBreakers,
  createCircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitState,
} from "./circuit-breaker";

// Retry logic with exponential backoff
export {
  withRetry,
  tryWithRetry,
  createRetryableFunction,
  retryPredicates,
  sleep,
  calculateMaxTotalDelay,
  RetryExhaustedError,
  RetryAbortedError,
  type RetryConfig,
  type RetryResult,
} from "./retry";

// Path safety utilities
export {
  sanitizeFilename,
  isPathWithinDirectory,
  validateExtension,
  isExtensionAllowed,
  validateDataUrl,
  isValidDataUrl,
  createSafeExportPath,
  validateExportPath,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MIME_TO_EXTENSION,
  ExtensionNotAllowedError,
  PathTraversalError,
  InvalidDataUrlError,
} from "./path-safety";

// IP trust utilities for secure forwarded header handling
export {
  getClientIP,
  isTrustedProxy,
  resetTrustedCIDRsCache,
} from "./ip-trust";

// Pagination utilities for consistent parameter parsing
export {
  parsePagination,
  parseLimit,
  paginationPresets,
  type PaginationConfig,
  type PaginationParams,
} from "./pagination";
