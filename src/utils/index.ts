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
export { isPathSafe, normalizePath, getSafeBasename } from "./path-safety";
