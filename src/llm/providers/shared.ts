/**
 * Shared LLM Provider Utilities
 * Common retry, backoff, and transformation logic for all providers
 */

import type { DiagramSpec } from "../../types";
import type { DiagramTransformOutput, DiagramTransformResponse } from "../types";
import { circuitBreakers, CircuitBreakerError } from "../../utils/circuit-breaker";
import type { Logger } from "../../logging";

/**
 * Delay execution for specified milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter to prevent thundering herd.
 * @param attempt - Zero-based attempt number
 * @param baseMs - Base delay in milliseconds (default 500)
 * @param maxMs - Maximum delay cap (default 60000)
 */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 60000): Promise<void> {
  const exponential = Math.min(Math.pow(2, attempt) * baseMs, maxMs);
  const jitter = Math.random() * 0.2 * exponential; // 0-20% jitter
  return delay(exponential + jitter);
}

/**
 * Build updated DiagramSpec from LLM transformation output.
 * Ensures only valid fields are included in the result.
 */
export function buildUpdatedSpec(spec: DiagramSpec, output: DiagramTransformOutput): DiagramSpec {
  return {
    ...spec,
    nodes: output.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      color: node.color,
      position: node.position,
      details: node.details,
      width: node.width,
      height: node.height,
    })),
    edges: output.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      style: edge.style,
      color: edge.color,
    })),
  };
}

/**
 * Build common diagram context message for LLM prompts.
 * Provider-specific instructions should be appended by the caller.
 */
export function buildDiagramContext(spec: DiagramSpec, prompt: string, context?: string): string {
  const parts: string[] = [];

  if (context) {
    parts.push(`Context: ${context}\n`);
  }

  parts.push("Current diagram state:");
  parts.push("```json");
  parts.push(
    JSON.stringify(
      {
        type: spec.type,
        theme: spec.theme,
        nodes: spec.nodes,
        edges: spec.edges,
      },
      null,
      2
    )
  );
  parts.push("```\n");

  parts.push(`Instruction: ${prompt}`);

  return parts.join("\n");
}

/**
 * Wrap an async operation with circuit breaker protection.
 * Returns a failed DiagramTransformResponse on circuit breaker open.
 */
export async function withCircuitBreaker<T extends DiagramTransformResponse>(
  operation: () => Promise<T>,
  log: Logger
): Promise<T | DiagramTransformResponse> {
  try {
    return await circuitBreakers.llm.execute(operation);
  } catch (err) {
    if (err instanceof CircuitBreakerError) {
      log.warn("Circuit breaker open, failing fast", { retryAfter: err.retryAfter });
      return {
        success: false,
        error: `LLM service temporarily unavailable. Please retry in ${err.retryAfter} seconds.`,
      };
    }
    // Convert other errors to response format
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Execute a transform operation with retry logic.
 * @param attemptFn - Function that performs a single attempt, returns output or throws
 * @param options - Retry configuration
 */
export async function executeWithRetry<T>(
  attemptFn: (attempt: number) => Promise<T>,
  options: {
    maxRetries: number;
    log: Logger;
    onRetry?: (attempt: number, error: Error) => Promise<void>;
  }
): Promise<T> {
  const { maxRetries, log, onRetry } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await attemptFn(attempt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log.error("Attempt failed", { attempt: attempt + 1, error: lastError.message });

      if (attempt < maxRetries) {
        if (onRetry) {
          await onRetry(attempt, lastError);
        } else {
          await backoffDelay(attempt);
        }
      }
    }
  }

  throw lastError || new Error("Operation failed after retries");
}
