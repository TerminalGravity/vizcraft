/**
 * Circuit Breaker Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  CircuitBreaker,
  CircuitBreakerError,
  createCircuitBreaker,
  circuitBreakers,
} from "./circuit-breaker";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeout: 100, // Short timeout for testing
      monitorWindow: 1000,
    });
  });

  describe("Initial State", () => {
    it("starts in CLOSED state", () => {
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("allows execution in CLOSED state", () => {
      expect(breaker.canExecute()).toBe(true);
    });

    it("has zero failures initially", () => {
      const stats = breaker.getStats();
      expect(stats.failures).toBe(0);
      expect(stats.totalCalls).toBe(0);
    });
  });

  describe("Successful Execution", () => {
    it("executes function and returns result", async () => {
      const result = await breaker.execute(async () => "success");
      expect(result).toBe("success");
    });

    it("tracks successful calls", async () => {
      await breaker.execute(async () => "ok");
      await breaker.execute(async () => "ok");

      const stats = breaker.getStats();
      expect(stats.totalCalls).toBe(2);
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.lastSuccess).not.toBeNull();
    });

    it("stays CLOSED after successful calls", async () => {
      await breaker.execute(async () => "ok");
      await breaker.execute(async () => "ok");
      await breaker.execute(async () => "ok");

      expect(breaker.getState()).toBe("CLOSED");
    });
  });

  describe("Failed Execution", () => {
    it("rethrows errors from the function", async () => {
      await expect(
        breaker.execute(async () => {
          throw new Error("test error");
        })
      ).rejects.toThrow("test error");
    });

    it("tracks failed calls", async () => {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.failures).toBe(1);
      expect(stats.totalFailures).toBe(1);
      expect(stats.lastFailure).not.toBeNull();
    });

    it("opens circuit after reaching failure threshold", async () => {
      // Cause 3 failures (threshold)
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error("fail");
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe("OPEN");
    });

    it("stays CLOSED below threshold", async () => {
      // Cause 2 failures (below threshold of 3)
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error("fail");
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe("CLOSED");
    });
  });

  describe("OPEN State", () => {
    beforeEach(async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error("fail");
          });
        } catch {
          // Expected
        }
      }
    });

    it("rejects execution when OPEN", async () => {
      await expect(breaker.execute(async () => "ok")).rejects.toThrow(
        CircuitBreakerError
      );
    });

    it("includes retry-after in error", async () => {
      try {
        await breaker.execute(async () => "ok");
      } catch (err) {
        if (err instanceof CircuitBreakerError) {
          expect(err.retryAfter).toBeGreaterThan(0);
        } else {
          throw new Error("Expected CircuitBreakerError");
        }
      }
    });

    it("canExecute returns false when OPEN", () => {
      expect(breaker.canExecute()).toBe(false);
    });

    it("transitions to HALF_OPEN after timeout", async () => {
      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 150));

      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getState()).toBe("HALF_OPEN");
    });
  });

  describe("HALF_OPEN State", () => {
    beforeEach(async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error("fail");
          });
        } catch {
          // Expected
        }
      }
      // Wait for timeout
      await new Promise((r) => setTimeout(r, 150));
      // Trigger half-open check
      breaker.canExecute();
    });

    it("is in HALF_OPEN state", () => {
      expect(breaker.getState()).toBe("HALF_OPEN");
    });

    it("closes after success threshold", async () => {
      // Need 2 successes (successThreshold)
      await breaker.execute(async () => "ok");
      await breaker.execute(async () => "ok");

      expect(breaker.getState()).toBe("CLOSED");
    });

    it("reopens on any failure", async () => {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      expect(breaker.getState()).toBe("OPEN");
    });

    it("requires all successes to close", async () => {
      await breaker.execute(async () => "ok");
      expect(breaker.getState()).toBe("HALF_OPEN");

      await breaker.execute(async () => "ok");
      expect(breaker.getState()).toBe("CLOSED");
    });
  });

  describe("Monitor Window", () => {
    it("only counts failures within window", async () => {
      const shortWindowBreaker = new CircuitBreaker({
        name: "short-window",
        failureThreshold: 3,
        successThreshold: 2,
        resetTimeout: 100,
        monitorWindow: 50, // Very short window
      });

      // Cause a failure
      try {
        await shortWindowBreaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      // Wait for window to expire
      await new Promise((r) => setTimeout(r, 100));

      // This failure should not count the previous one
      try {
        await shortWindowBreaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      const stats = shortWindowBreaker.getStats();
      expect(stats.failures).toBe(1); // Only the recent one
      expect(stats.totalFailures).toBe(2); // Total is still 2
    });
  });

  describe("Reset", () => {
    it("resets to CLOSED state", async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error("fail");
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe("OPEN");

      breaker.reset();

      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.getStats().failures).toBe(0);
    });
  });

  describe("Force State", () => {
    it("can force to OPEN", () => {
      breaker.forceState("OPEN");
      expect(breaker.getState()).toBe("OPEN");
    });

    it("can force to HALF_OPEN", () => {
      breaker.forceState("HALF_OPEN");
      expect(breaker.getState()).toBe("HALF_OPEN");
    });
  });

  describe("Statistics", () => {
    it("tracks all statistics correctly", async () => {
      // 2 successes
      await breaker.execute(async () => "ok");
      await breaker.execute(async () => "ok");

      // 1 failure
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.totalCalls).toBe(3);
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(1);
      expect(stats.failures).toBe(1);
      expect(stats.state).toBe("CLOSED");
    });
  });
});

describe("Pre-configured Circuit Breakers", () => {
  it("has LLM circuit breaker", () => {
    expect(circuitBreakers.llm).toBeInstanceOf(CircuitBreaker);
    expect(circuitBreakers.llm.getState()).toBe("CLOSED");
  });

  it("has external API circuit breaker", () => {
    expect(circuitBreakers.externalApi).toBeInstanceOf(CircuitBreaker);
    expect(circuitBreakers.externalApi.getState()).toBe("CLOSED");
  });
});

describe("createCircuitBreaker", () => {
  it("creates a circuit breaker with custom config", () => {
    const breaker = createCircuitBreaker({
      name: "custom",
      failureThreshold: 10,
    });

    expect(breaker).toBeInstanceOf(CircuitBreaker);
    expect(breaker.getState()).toBe("CLOSED");
  });
});
