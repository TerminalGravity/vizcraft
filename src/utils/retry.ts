/**
 * Retry Logic with Exponential Backoff
 *
 * Provides a generic retry wrapper for any async operation with:
 * - Configurable retry attempts
 * - Exponential backoff with optional jitter
 * - Custom retry conditions
 * - Abort signal support
 * - Integration with circuit breaker
 */

import { CircuitBreaker, CircuitBreakerError } from "./circuit-breaker";

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in milliseconds before first retry (default: 500) */
  initialDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2 for exponential) */
  backoffMultiplier: number;
  /** Add random jitter to delays (default: true) */
  jitter: boolean;
  /** Maximum jitter factor (default: 0.25 = ±25%) */
  jitterFactor: number;
  /** Function to determine if error is retryable (default: all errors are retryable) */
  isRetryable?: (error: unknown) => boolean;
  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: unknown, nextDelayMs: number) => void;
  /** Optional abort signal to cancel retries */
  signal?: AbortSignal;
  /** Optional circuit breaker to integrate with */
  circuitBreaker?: CircuitBreaker;
  /** Name for logging purposes */
  name?: string;
}

const DEFAULT_CONFIG: Required<Omit<RetryConfig, "signal" | "circuitBreaker" | "isRetryable" | "onRetry" | "name">> = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitter: true,
  jitterFactor: 0.25,
};

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

/**
 * Execute an async function with retry logic and exponential backoff
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetch("https://api.example.com/data"),
 *   { maxRetries: 3, initialDelayMs: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const opts = { ...DEFAULT_CONFIG, ...config };
  const {
    maxRetries,
    initialDelayMs,
    maxDelayMs,
    backoffMultiplier,
    jitter,
    jitterFactor,
    isRetryable,
    onRetry,
    signal,
    circuitBreaker,
    name,
  } = opts;

  let lastError: Error | undefined;
  let totalDelayMs = 0;
  const logPrefix = name ? `[retry:${name}]` : "[retry]";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check for abort
    if (signal?.aborted) {
      throw new RetryAbortedError("Retry aborted by signal");
    }

    try {
      // If circuit breaker is provided, execute through it
      if (circuitBreaker) {
        return await circuitBreaker.execute(fn);
      }
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // Check if this is a circuit breaker error (don't retry)
      if (error instanceof CircuitBreakerError) {
        console.error(`${logPrefix} Circuit breaker open, not retrying`);
        throw error;
      }

      // Check if we've exhausted retries
      if (attempt >= maxRetries) {
        console.error(`${logPrefix} All ${maxRetries + 1} attempts failed`);
        break;
      }

      // Check if error is retryable
      if (isRetryable && !isRetryable(error)) {
        console.error(`${logPrefix} Error is not retryable:`, err.message);
        throw err;
      }

      // Calculate delay with exponential backoff
      let delayMs = Math.min(
        initialDelayMs * Math.pow(backoffMultiplier, attempt),
        maxDelayMs
      );

      // Add jitter if enabled
      if (jitter) {
        const jitterRange = delayMs * jitterFactor;
        const randomJitter = (Math.random() * 2 - 1) * jitterRange;
        delayMs = Math.max(0, delayMs + randomJitter);
      }

      // Round to integer milliseconds
      delayMs = Math.round(delayMs);
      totalDelayMs += delayMs;

      // Log retry
      console.log(
        `${logPrefix} Attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`,
        err.message
      );

      // Call retry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, error, delayMs);
      }

      // Wait before retry
      await sleep(delayMs, signal);
    }
  }

  // All retries exhausted
  throw new RetryExhaustedError(
    `All ${maxRetries + 1} retry attempts failed`,
    lastError!,
    maxRetries + 1,
    totalDelayMs
  );
}

/**
 * Same as withRetry but returns a result object instead of throwing
 */
export async function tryWithRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let attempts = 0;

  try {
    const data = await withRetry(
      async () => {
        attempts++;
        return await fn();
      },
      config
    );

    return {
      success: true,
      data,
      attempts,
      totalDelayMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      attempts,
      totalDelayMs: Date.now() - startTime,
    };
  }
}

/**
 * Create a retryable version of a function
 */
export function createRetryableFunction<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  config: Partial<RetryConfig> = {}
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return withRetry(() => fn(...args), config) as ReturnType<T>;
  }) as T;
}

/**
 * Common retry predicates for different error types
 */
export const retryPredicates = {
  /** Retry on network errors (fetch failures, timeouts) */
  isNetworkError: (error: unknown): boolean => {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("network") ||
        message.includes("timeout") ||
        message.includes("connection") ||
        message.includes("econnrefused") ||
        message.includes("enotfound") ||
        message.includes("fetch failed")
      );
    }
    return false;
  },

  /** Retry on HTTP 5xx errors */
  isServerError: (error: unknown): boolean => {
    if (error instanceof Error && "status" in error) {
      const status = (error as { status: number }).status;
      return status >= 500 && status < 600;
    }
    // Check for status in message
    if (error instanceof Error) {
      const match = error.message.match(/\b(5\d{2})\b/);
      return match !== null;
    }
    return false;
  },

  /** Retry on rate limit errors (429) */
  isRateLimitError: (error: unknown): boolean => {
    if (error instanceof Error && "status" in error) {
      return (error as { status: number }).status === 429;
    }
    if (error instanceof Error) {
      return (
        error.message.includes("429") ||
        error.message.toLowerCase().includes("rate limit") ||
        error.message.toLowerCase().includes("too many requests")
      );
    }
    return false;
  },

  /** Combine multiple predicates - retry if any match */
  any:
    (...predicates: ((error: unknown) => boolean)[]) =>
    (error: unknown): boolean => {
      return predicates.some((p) => p(error));
    },

  /** Combine multiple predicates - retry only if all match */
  all:
    (...predicates: ((error: unknown) => boolean)[]) =>
    (error: unknown): boolean => {
      return predicates.every((p) => p(error));
    },
};

/**
 * Sleep utility that supports abort signals
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RetryAbortedError("Sleep aborted"));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      reject(new RetryAbortedError("Sleep aborted"));
    });
  });
}

/**
 * Error thrown when all retry attempts are exhausted
 */
export class RetryExhaustedError extends Error {
  public override readonly cause: Error;
  public readonly attempts: number;
  public readonly totalDelayMs: number;

  constructor(message: string, cause: Error, attempts: number, totalDelayMs: number) {
    super(message, { cause });
    this.name = "RetryExhaustedError";
    this.cause = cause;
    this.attempts = attempts;
    this.totalDelayMs = totalDelayMs;
  }
}

/**
 * Error thrown when retry is aborted via signal
 */
export class RetryAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryAbortedError";
  }
}

/**
 * Calculate the total maximum delay for a retry configuration
 * (useful for setting appropriate timeouts)
 */
export function calculateMaxTotalDelay(config: Partial<RetryConfig> = {}): number {
  const opts = { ...DEFAULT_CONFIG, ...config };
  let total = 0;

  for (let i = 0; i < opts.maxRetries; i++) {
    const delay = Math.min(
      opts.initialDelayMs * Math.pow(opts.backoffMultiplier, i),
      opts.maxDelayMs
    );
    // Include maximum jitter
    total += delay * (1 + opts.jitterFactor);
  }

  return Math.round(total);
}
