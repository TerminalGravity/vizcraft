/**
 * Ollama LLM Provider
 * Local model integration via Ollama for offline diagram transformation
 *
 * Features:
 * - Structured outputs via JSON mode
 * - Zod schema validation
 * - Retry with exponential backoff
 * - Timeout handling for slow local inference
 * - Support for multiple models (llama3.2, codellama, mistral, etc.)
 */

import type {
  LLMProvider,
  LLMProviderConfig,
  DiagramTransformRequest,
  DiagramTransformResponse,
  DiagramTransformOutput,
} from "../types";
import { DiagramTransformOutputSchema } from "../types";
import type { DiagramSpec } from "../../types";
import { createLogger } from "../../logging";
import { circuitBreakers, CircuitBreakerError } from "../../utils/circuit-breaker";
import { DIAGRAM_SYSTEM_PROMPT_JSON } from "../prompts";

const log = createLogger("ollama");

// Default configuration
const DEFAULT_CONFIG = {
  baseUrl: "http://localhost:11434",
  model: "llama3.2",
  timeoutMs: 120_000, // 2 minutes for local inference
  maxTokens: 4096,
  temperature: 0.3,
};

// JSON schema to include in prompts (more compact for local models)
const OUTPUT_SCHEMA = `{
  "nodes": [{"id": "string", "label": "string", "type?": "box|diamond|circle|database|cloud|cylinder", "color?": "#hex", "position?": {"x": number, "y": number}, "details?": "string", "width?": number, "height?": number}],
  "edges": [{"id?": "string", "from": "string", "to": "string", "label?": "string", "style?": "solid|dashed|dotted", "color?": "#hex"}],
  "changes": ["string descriptions of changes"]
}`;

// Ollama API types
interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  format?: "json";
  stream?: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_p?: number;
    top_k?: number;
  };
}

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
  }>;
}

export class OllamaProvider implements LLMProvider {
  readonly type = "ollama" as const;
  readonly name = "Ollama (Local)";

  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  private temperature: number;
  private maxTokens: number;

  constructor(config?: Partial<LLMProviderConfig>) {
    this.baseUrl = config?.baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_CONFIG.baseUrl;
    this.model = config?.model || process.env.OLLAMA_MODEL || DEFAULT_CONFIG.model;
    this.timeoutMs = DEFAULT_CONFIG.timeoutMs;
    this.temperature = config?.temperature ?? DEFAULT_CONFIG.temperature;
    this.maxTokens = config?.maxTokens ?? DEFAULT_CONFIG.maxTokens;
  }

  get isConfigured(): boolean {
    // Ollama doesn't need an API key - just check configuration exists
    return true;
  }

  /**
   * Check if Ollama server is running and the model is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) return false;

      const data = (await response.json()) as OllamaTagsResponse;
      // Check if our target model is available
      const hasModel = data.models?.some(
        (m) => m.name === this.model || m.name.startsWith(`${this.model}:`)
      );

      if (!hasModel) {
        log.warn("Model not found", {
          model: this.model,
          available: data.models?.map((m) => m.name).join(", ") || "none",
        });
      }

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * List available models from Ollama
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];

      const data = (await response.json()) as OllamaTagsResponse;
      return data.models?.map((m) => m.name) || [];
    } catch {
      return [];
    }
  }

  /**
   * Transform a diagram using natural language via Ollama
   */
  async transformDiagram(request: DiagramTransformRequest): Promise<DiagramTransformResponse> {
    // Check if Ollama is running (outside circuit breaker - it's a health check)
    const isHealthy = await this.healthCheck();
    if (!isHealthy) {
      return {
        success: false,
        error: `Ollama not available at ${this.baseUrl}. Start Ollama with: ollama serve`,
      };
    }

    // Check circuit breaker state before attempting
    try {
      return await circuitBreakers.llm.execute(() => this.executeTransform(request));
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
   * Internal method that performs the actual API call with retries
   * Wrapped by circuit breaker for cascading failure protection
   */
  private async executeTransform(request: DiagramTransformRequest): Promise<DiagramTransformResponse> {
    const { spec, prompt, context, maxRetries = 2 } = request;

    // Build the prompt with JSON schema
    const userPrompt = this.buildPrompt(spec, prompt, context);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const startTime = performance.now();

        // Call Ollama generate API with JSON mode
        const ollamaRequest: OllamaGenerateRequest = {
          model: this.model,
          prompt: userPrompt,
          system: DIAGRAM_SYSTEM_PROMPT_JSON,
          format: "json",
          stream: false,
          options: {
            temperature: this.temperature,
            num_predict: this.maxTokens,
          },
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(`${this.baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaRequest),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const duration = performance.now() - startTime;

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
        }

        const result = (await response.json()) as OllamaGenerateResponse;

        // Parse the JSON response
        let parsed: unknown;
        try {
          parsed = JSON.parse(result.response);
        } catch (parseError) {
          log.error("Failed to parse JSON response", { preview: result.response.slice(0, 200) });
          if (attempt < maxRetries) {
            await this.delay(Math.pow(2, attempt) * 500);
            continue;
          }
          return {
            success: false,
            error: `Model returned invalid JSON: ${parseError instanceof Error ? parseError.message : "parse error"}`,
          };
        }

        // Validate with Zod schema
        const parseResult = DiagramTransformOutputSchema.safeParse(parsed);

        if (!parseResult.success) {
          log.error("Invalid schema", { error: parseResult.error.message });
          if (attempt < maxRetries) {
            await this.delay(Math.pow(2, attempt) * 500);
            continue;
          }
          return {
            success: false,
            error: `Invalid transformation output: ${parseResult.error.message}`,
          };
        }

        const output: DiagramTransformOutput = parseResult.data;

        // Build the updated spec
        const updatedSpec: DiagramSpec = {
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

        // Calculate approximate token usage from Ollama response
        const usage = {
          inputTokens: result.prompt_eval_count || 0,
          outputTokens: result.eval_count || 0,
          model: this.model,
        };

        log.info("Transform completed", {
          durationMs: Math.round(duration),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });

        return {
          success: true,
          spec: updatedSpec,
          changes: output.changes,
          usage,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check for timeout/abort
        if (lastError.name === "AbortError") {
          lastError = new Error(`Request timed out after ${this.timeoutMs}ms`);
        }

        log.error("Attempt failed", { attempt: attempt + 1, error: lastError.message });

        if (attempt < maxRetries) {
          await this.delay(Math.pow(2, attempt) * 500);
        }
      }
    }

    // Throw error so circuit breaker can track the failure
    throw lastError || new Error("Failed to transform diagram after retries");
  }

  /**
   * Build the prompt with diagram context and JSON schema
   */
  private buildPrompt(spec: DiagramSpec, prompt: string, context?: string): string {
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

    parts.push(`User instruction: ${prompt}\n`);

    parts.push("Respond with JSON matching this schema:");
    parts.push(OUTPUT_SCHEMA);
    parts.push("\nIMPORTANT: Return ONLY valid JSON. No explanations or markdown.");

    return parts.join("\n");
  }

  /**
   * Delay helper for exponential backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create an Ollama provider instance
 */
export function createOllamaProvider(config?: Partial<LLMProviderConfig>): OllamaProvider {
  return new OllamaProvider(config);
}
