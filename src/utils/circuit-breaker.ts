/**
 * Circuit Breaker Pattern Implementation
 *
 * Protects against cascading failures from external services.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing)
 */

import { createLogger } from "../logging";

const log = createLogger("circuit-breaker");

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Number of successes in half-open to close (default: 2) */
  successThreshold: number;
  /** Milliseconds before trying half-open (default: 30000) */
  resetTimeout: number;
  /** Window in ms for counting failures (default: 60000) */
  monitorWindow: number;
  /** Name for logging purposes */
  name: string;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

interface FailureRecord {
  timestamp: number;
  error?: string;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeout: 30_000,
  monitorWindow: 60_000,
  name: "default",
};

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = "CLOSED";
  private failures: FailureRecord[] = [];
  private halfOpenSuccesses = 0;
  private lastStateChange = Date.now();
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailure: number | null = null;
  private lastSuccess: number | null = null;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitBreakerError(
        `Circuit breaker "${this.config.name}" is OPEN`,
        this.getRetryAfter()
      );
    }

    this.totalCalls++;

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Check if a request can be executed
   */
  canExecute(): boolean {
    this.cleanupOldFailures();

    switch (this.state) {
      case "CLOSED":
        return true;

      case "OPEN":
        // Check if enough time has passed to try half-open
        if (Date.now() - this.lastStateChange >= this.config.resetTimeout) {
          this.transitionTo("HALF_OPEN");
          return true;
        }
        return false;

      case "HALF_OPEN":
        // Allow limited requests in half-open state
        return true;

      default:
        return false;
    }
  }

  /**
   * Record a successful execution
   */
  private recordSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccess = Date.now();

    if (this.state === "HALF_OPEN") {
      this.halfOpenSuccesses++;
      log.info("Half-open success", {
        name: this.config.name,
        successes: this.halfOpenSuccesses,
        threshold: this.config.successThreshold,
      });

      if (this.halfOpenSuccesses >= this.config.successThreshold) {
        this.transitionTo("CLOSED");
      }
    }
  }

  /**
   * Record a failed execution
   */
  private recordFailure(error?: string): void {
    this.totalFailures++;
    this.lastFailure = Date.now();
    this.failures.push({ timestamp: Date.now(), error });

    if (this.state === "HALF_OPEN") {
      // Any failure in half-open goes back to open
      log.info("Half-open failure, reopening circuit", { name: this.config.name });
      this.transitionTo("OPEN");
      return;
    }

    if (this.state === "CLOSED") {
      // Check if we've exceeded the failure threshold
      const recentFailures = this.getRecentFailures();
      if (recentFailures >= this.config.failureThreshold) {
        log.warn("Failure threshold reached, opening circuit", {
          name: this.config.name,
          failures: recentFailures,
          threshold: this.config.failureThreshold,
        });
        this.transitionTo("OPEN");
      }
    }
  }

  /**
   * Get the number of failures within the monitoring window
   */
  private getRecentFailures(): number {
    const windowStart = Date.now() - this.config.monitorWindow;
    return this.failures.filter((f) => f.timestamp >= windowStart).length;
  }

  /**
   * Clean up failures outside the monitoring window
   */
  private cleanupOldFailures(): void {
    const windowStart = Date.now() - this.config.monitorWindow;
    this.failures = this.failures.filter((f) => f.timestamp >= windowStart);
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === "CLOSED") {
      this.failures = [];
      this.halfOpenSuccesses = 0;
    } else if (newState === "HALF_OPEN") {
      this.halfOpenSuccesses = 0;
    }

    log.info("State transition", {
      name: this.config.name,
      from: oldState,
      to: newState,
    });
  }

  /**
   * Get retry-after time in seconds
   */
  getRetryAfter(): number {
    if (this.state !== "OPEN") return 0;
    const elapsed = Date.now() - this.lastStateChange;
    return Math.max(0, Math.ceil((this.config.resetTimeout - elapsed) / 1000));
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.getRecentFailures(),
      successes: this.halfOpenSuccesses,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Force the circuit to a specific state (for testing)
   */
  forceState(state: CircuitState): void {
    this.transitionTo(state);
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.state = "CLOSED";
    this.failures = [];
    this.halfOpenSuccesses = 0;
    this.lastStateChange = Date.now();
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerError extends Error {
  public readonly retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = "CircuitBreakerError";
    this.retryAfter = retryAfter;
  }
}

// Pre-configured circuit breakers for different services
export const circuitBreakers = {
  /** Circuit breaker for LLM/AI service calls */
  llm: new CircuitBreaker({
    name: "llm",
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeout: 30_000,
    monitorWindow: 60_000,
  }),

  /** Circuit breaker for external API calls (if any) */
  externalApi: new CircuitBreaker({
    name: "external-api",
    failureThreshold: 5,
    successThreshold: 2,
    resetTimeout: 60_000,
    monitorWindow: 120_000,
  }),

  /**
   * Circuit breaker for database operations
   * More tolerant since SQLite is local, but protects against:
   * - Disk full conditions
   * - File locking issues
   * - WAL checkpoint failures
   */
  database: new CircuitBreaker({
    name: "database",
    failureThreshold: 10, // Higher threshold - local DB should be reliable
    successThreshold: 3,
    resetTimeout: 10_000, // Shorter reset - local recovery is fast
    monitorWindow: 30_000,
  }),
};

/**
 * Create a custom circuit breaker
 */
export function createCircuitBreaker(
  config: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  return new CircuitBreaker(config);
}
