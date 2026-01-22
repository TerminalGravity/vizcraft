/**
 * Retry Utility Tests
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  withRetry,
  tryWithRetry,
  createRetryableFunction,
  retryPredicates,
  sleep,
  RetryExhaustedError,
  RetryAbortedError,
  calculateMaxTotalDelay,
} from "./retry";

describe("withRetry", () => {
  test("succeeds on first attempt", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return "success";
    });

    expect(result).toBe("success");
    expect(attempts).toBe(1);
  });

  test("retries on failure and succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Temporary failure");
        }
        return "success after retries";
      },
      { maxRetries: 3, initialDelayMs: 10 }
    );

    expect(result).toBe("success after retries");
    expect(attempts).toBe(3);
  });

  test("throws RetryExhaustedError when all retries fail", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Always fails");
        },
        { maxRetries: 2, initialDelayMs: 10 }
      )
    ).rejects.toThrow(RetryExhaustedError);

    expect(attempts).toBe(3); // Initial + 2 retries
  });

  test("respects isRetryable predicate", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Non-retryable error");
        },
        {
          maxRetries: 3,
          initialDelayMs: 10,
          isRetryable: () => false, // Never retry
        }
      )
    ).rejects.toThrow("Non-retryable error");

    expect(attempts).toBe(1); // Only one attempt
  });

  test("calls onRetry callback", async () => {
    const retryCalls: { attempt: number; error: unknown; delay: number }[] = [];

    await expect(
      withRetry(
        async () => {
          throw new Error("Fail");
        },
        {
          maxRetries: 2,
          initialDelayMs: 10,
          onRetry: (attempt, error, delay) => {
            retryCalls.push({ attempt, error, delay });
          },
        }
      )
    ).rejects.toThrow();

    expect(retryCalls.length).toBe(2);
    expect(retryCalls[0].attempt).toBe(1);
    expect(retryCalls[1].attempt).toBe(2);
  });

  test("respects maxDelayMs cap", async () => {
    const delays: number[] = [];

    await expect(
      withRetry(
        async () => {
          throw new Error("Fail");
        },
        {
          maxRetries: 5,
          initialDelayMs: 100,
          maxDelayMs: 200,
          backoffMultiplier: 2,
          jitter: false,
          onRetry: (_attempt, _error, delay) => {
            delays.push(delay);
          },
        }
      )
    ).rejects.toThrow();

    // Delays should be capped at 200ms
    expect(delays.every((d) => d <= 200)).toBe(true);
  });

  test("aborts on signal", async () => {
    const controller = new AbortController();
    let attempts = 0;

    // Abort after a short delay
    setTimeout(() => controller.abort(), 50);

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Fail");
        },
        {
          maxRetries: 10,
          initialDelayMs: 100,
          signal: controller.signal,
        }
      )
    ).rejects.toThrow(RetryAbortedError);

    // Should have aborted before completing all retries
    expect(attempts).toBeLessThan(10);
  });
});

describe("tryWithRetry", () => {
  test("returns success result on success", async () => {
    const result = await tryWithRetry(async () => "data", { maxRetries: 2 });

    expect(result.success).toBe(true);
    expect(result.data).toBe("data");
    expect(result.attempts).toBe(1);
    expect(result.error).toBeUndefined();
  });

  test("returns failure result on exhausted retries", async () => {
    const result = await tryWithRetry(
      async () => {
        throw new Error("Fail");
      },
      { maxRetries: 2, initialDelayMs: 10 }
    );

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toBeInstanceOf(RetryExhaustedError);
    expect(result.attempts).toBe(3);
  });
});

describe("createRetryableFunction", () => {
  test("creates a retryable version of a function", async () => {
    let callCount = 0;
    const flaky = async (value: string) => {
      callCount++;
      if (callCount < 2) throw new Error("Flaky");
      return `processed: ${value}`;
    };

    const retryable = createRetryableFunction(flaky, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    const result = await retryable("test");
    expect(result).toBe("processed: test");
    expect(callCount).toBe(2);
  });
});

describe("retryPredicates", () => {
  describe("isNetworkError", () => {
    test("returns true for network errors", () => {
      expect(retryPredicates.isNetworkError(new Error("Network error"))).toBe(true);
      expect(retryPredicates.isNetworkError(new Error("Connection refused: ECONNREFUSED"))).toBe(true);
      expect(retryPredicates.isNetworkError(new Error("TIMEOUT"))).toBe(true);
      expect(retryPredicates.isNetworkError(new Error("fetch failed"))).toBe(true);
    });

    test("returns false for other errors", () => {
      expect(retryPredicates.isNetworkError(new Error("Not found"))).toBe(false);
      expect(retryPredicates.isNetworkError(new Error("Invalid input"))).toBe(false);
    });
  });

  describe("isServerError", () => {
    test("returns true for 5xx status codes", () => {
      const error500 = Object.assign(new Error("Server Error"), { status: 500 });
      const error503 = Object.assign(new Error("Service Unavailable"), { status: 503 });
      const errorMsg = new Error("Status 502: Bad Gateway");

      expect(retryPredicates.isServerError(error500)).toBe(true);
      expect(retryPredicates.isServerError(error503)).toBe(true);
      expect(retryPredicates.isServerError(errorMsg)).toBe(true);
    });

    test("returns false for 4xx errors", () => {
      const error400 = Object.assign(new Error("Bad Request"), { status: 400 });
      expect(retryPredicates.isServerError(error400)).toBe(false);
    });
  });

  describe("isRateLimitError", () => {
    test("returns true for rate limit errors", () => {
      const error429 = Object.assign(new Error("Too Many Requests"), { status: 429 });
      const errorMsg = new Error("Error 429: rate limit exceeded");

      expect(retryPredicates.isRateLimitError(error429)).toBe(true);
      expect(retryPredicates.isRateLimitError(errorMsg)).toBe(true);
    });

    test("returns false for other errors", () => {
      const error500 = Object.assign(new Error("Server Error"), { status: 500 });
      expect(retryPredicates.isRateLimitError(error500)).toBe(false);
    });
  });

  describe("any combinator", () => {
    test("returns true if any predicate matches", () => {
      const combined = retryPredicates.any(
        retryPredicates.isNetworkError,
        retryPredicates.isServerError
      );

      expect(combined(new Error("Network error"))).toBe(true);
      expect(combined(Object.assign(new Error("Server Error"), { status: 500 }))).toBe(true);
      expect(combined(new Error("Client error"))).toBe(false);
    });
  });

  describe("all combinator", () => {
    test("returns true only if all predicates match", () => {
      // Custom predicate for testing
      const hasMessage = (error: unknown): boolean => {
        return error instanceof Error && error.message.includes("test");
      };

      const combined = retryPredicates.all(
        retryPredicates.isNetworkError,
        hasMessage
      );

      expect(combined(new Error("Network test error"))).toBe(true);
      expect(combined(new Error("Network error"))).toBe(false);
      expect(combined(new Error("test error"))).toBe(false);
    });
  });
});

describe("sleep", () => {
  test("resolves after specified time", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
    expect(elapsed).toBeLessThan(100);
  });

  test("rejects on abort", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(1000, controller.signal)).rejects.toThrow(RetryAbortedError);
  });
});

describe("calculateMaxTotalDelay", () => {
  test("calculates total delay for configuration", () => {
    const delay = calculateMaxTotalDelay({
      maxRetries: 3,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      jitter: false,
      jitterFactor: 0,
    });

    // 100 + 200 + 400 = 700ms
    expect(delay).toBe(700);
  });

  test("respects maxDelayMs cap", () => {
    const delay = calculateMaxTotalDelay({
      maxRetries: 5,
      initialDelayMs: 100,
      maxDelayMs: 200,
      backoffMultiplier: 2,
      jitter: false,
      jitterFactor: 0,
    });

    // 100 + 200 + 200 + 200 + 200 = 900ms (capped)
    expect(delay).toBe(900);
  });

  test("includes jitter in calculation", () => {
    const withoutJitter = calculateMaxTotalDelay({
      maxRetries: 3,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      jitter: false,
      jitterFactor: 0,
    });

    const withJitter = calculateMaxTotalDelay({
      maxRetries: 3,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      jitter: true,
      jitterFactor: 0.25,
    });

    expect(withJitter).toBeGreaterThan(withoutJitter);
  });
});

describe("RetryExhaustedError", () => {
  test("contains cause and metadata", () => {
    const cause = new Error("Original error");
    const error = new RetryExhaustedError("All retries failed", cause, 3, 1500);

    expect(error.name).toBe("RetryExhaustedError");
    expect(error.message).toBe("All retries failed");
    expect(error.cause).toBe(cause);
    expect(error.attempts).toBe(3);
    expect(error.totalDelayMs).toBe(1500);
  });
});
