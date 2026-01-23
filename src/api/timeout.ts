/**
 * Request Timeout Utilities
 *
 * Provides timeout handling for long-running operations
 * to prevent requests from hanging indefinitely.
 */

/**
 * Timeout error class
 */
export class TimeoutError extends Error {
  constructor(
    public operation: string,
    public timeoutMs: number
  ) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Default timeout values (in milliseconds)
 */
export const TIMEOUTS = {
  /** Standard API operations (CRUD) */
  STANDARD: 10_000, // 10 seconds
  /** List operations with filters (can be slower due to complex queries) */
  LIST: 15_000, // 15 seconds
  /** Layout calculations */
  LAYOUT: 30_000, // 30 seconds
  /** Theme applications */
  THEME: 15_000, // 15 seconds
  /** Agent/LLM operations */
  AGENT: 60_000, // 60 seconds
  /** Export operations */
  EXPORT: 30_000, // 30 seconds
} as const;

/**
 * Maximum allowed offset for list operations
 * Prevents memory issues with very large offsets
 */
export const MAX_LIST_OFFSET = 10_000;

/**
 * Execute a promise with a timeout
 * Throws TimeoutError if the operation takes too long
 *
 * Uses proper cleanup to avoid memory leaks from pending promises.
 *
 * @param promise - The promise to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param operation - Description of the operation (for error messages)
 * @returns The result of the promise
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  // Create abort controller for cleanup
  const controller = new AbortController();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let cleanupTimeout: (() => void) | undefined;

  // Create a timeout promise that can be cleaned up
  const timeoutPromise = new Promise<never>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);

    // Store cleanup function to settle the promise when operation completes
    // This allows the promise to be garbage collected
    cleanupTimeout = () => {
      clearTimeout(timeoutId);
      // Resolve with a value that will never be used (Promise.race already settled)
      // but allows this promise to be GC'd
      (resolve as (value: never) => void)(undefined as never);
    };
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    // Clean up timeout promise to prevent memory leak
    cleanupTimeout?.();
  }
}

/**
 * Execute a promise with a timeout, returning a result object
 * instead of throwing on timeout
 *
 * @param promise - The promise to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param operation - Description of the operation (for error messages)
 * @returns Result object with success flag, data, or error
 */
export async function withTimeoutResult<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<
  | { success: true; data: T; timedOut: false }
  | { success: false; error: Error; timedOut: boolean }
> {
  try {
    const data = await withTimeout(promise, timeoutMs, operation);
    return { success: true, data, timedOut: false };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const timedOut = err instanceof TimeoutError;
    return { success: false, error, timedOut };
  }
}

/**
 * Create a timeout wrapper for a specific operation type
 * Returns a function that wraps promises with the configured timeout
 *
 * @param timeoutMs - Default timeout for this operation type
 * @param operation - Default operation description
 */
export function createTimeoutWrapper(timeoutMs: number, operation: string) {
  return <T>(
    promise: Promise<T>,
    customTimeout?: number,
    customOperation?: string
  ): Promise<T> => {
    return withTimeout(
      promise,
      customTimeout ?? timeoutMs,
      customOperation ?? operation
    );
  };
}

// Pre-configured timeout wrappers
export const withLayoutTimeout = createTimeoutWrapper(TIMEOUTS.LAYOUT, "Layout calculation");
export const withAgentTimeout = createTimeoutWrapper(TIMEOUTS.AGENT, "Agent execution");
export const withExportTimeout = createTimeoutWrapper(TIMEOUTS.EXPORT, "Export operation");
export const withListTimeout = createTimeoutWrapper(TIMEOUTS.LIST, "List operation");
