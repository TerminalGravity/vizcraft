/**
 * Anthropic LLM Provider
 * First-class Claude integration for Vizcraft diagram agents
 *
 * Features:
 * - Structured outputs with tool use
 * - Zod schema validation
 * - Retry with exponential backoff
 * - Usage tracking
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  LLMProviderConfig,
  DiagramTransformRequest,
  DiagramTransformResponse,
  DiagramTransformOutput,
} from "../types";
import { DiagramTransformOutputSchema } from "../types";
import { createLogger } from "../../logging";
import { DIAGRAM_SYSTEM_PROMPT } from "../prompts";
import {
  backoffDelay,
  buildUpdatedSpec,
  buildDiagramContext,
  withCircuitBreaker,
} from "./shared";

const log = createLogger("anthropic");

// Default configuration
const DEFAULT_CONFIG = {
  model: "claude-sonnet-4-5-20250929",
  maxTokens: 4096,
  temperature: 0.3,
  timeoutMs: 120_000, // 2 minutes for complex diagram transformations
};

export class AnthropicProvider implements LLMProvider {
  readonly type = "anthropic" as const;
  readonly name = "Anthropic Claude";

  private client: Anthropic | null = null;
  private config: typeof DEFAULT_CONFIG;
  private apiKey: string | undefined;

  constructor(config?: Partial<LLMProviderConfig>) {
    this.apiKey = config?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.config = {
      model: config?.model ?? DEFAULT_CONFIG.model,
      maxTokens: config?.maxTokens ?? DEFAULT_CONFIG.maxTokens,
      temperature: config?.temperature ?? DEFAULT_CONFIG.temperature,
      timeoutMs: config?.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
    };

    if (this.apiKey) {
      this.client = new Anthropic({
        apiKey: this.apiKey,
        timeout: this.config.timeoutMs,
      });
    }
  }

  get isConfigured(): boolean {
    return !!this.apiKey && !!this.client;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.client) return false;

    try {
      // Simple health check with minimal tokens
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 10,
        messages: [{ role: "user", content: "Say 'ok'" }],
      });
      return response.content.length > 0;
    } catch {
      return false;
    }
  }

  async transformDiagram(request: DiagramTransformRequest): Promise<DiagramTransformResponse> {
    if (!this.client) {
      return {
        success: false,
        error: "Anthropic API key not configured. Set ANTHROPIC_API_KEY environment variable.",
      };
    }

    return withCircuitBreaker(() => this.executeTransform(request), log);
  }

  /**
   * Internal method that performs the actual API call with retries
   * Wrapped by circuit breaker for cascading failure protection
   */
  private async executeTransform(request: DiagramTransformRequest): Promise<DiagramTransformResponse> {
    const { spec, prompt, context, maxRetries = 2 } = request;

    // Build the transformation tool
    const transformTool: Anthropic.Tool = {
      name: "transform_diagram",
      description:
        "Transform the diagram by returning the complete updated node and edge arrays along with a list of changes made.",
      input_schema: {
        type: "object" as const,
        properties: {
          nodes: {
            type: "array",
            description: "Complete array of all nodes (existing + new, with modifications applied)",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Unique node identifier" },
                label: { type: "string", description: "Display label for the node" },
                type: {
                  type: "string",
                  enum: ["box", "diamond", "circle", "database", "cloud", "cylinder"],
                  description: "Visual shape of the node",
                },
                color: { type: "string", description: "CSS hex color for the node" },
                position: {
                  type: "object",
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                  },
                  description: "Node position on canvas",
                },
                details: { type: "string", description: "Additional details/tooltip text" },
                width: { type: "number", description: "Node width in pixels" },
                height: { type: "number", description: "Node height in pixels" },
              },
              required: ["id", "label"],
            },
          },
          edges: {
            type: "array",
            description: "Complete array of all edges (existing + new, with modifications applied)",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Optional edge identifier" },
                from: { type: "string", description: "Source node ID" },
                to: { type: "string", description: "Target node ID" },
                label: { type: "string", description: "Edge label" },
                style: {
                  type: "string",
                  enum: ["solid", "dashed", "dotted"],
                  description: "Line style",
                },
                color: { type: "string", description: "CSS hex color for the edge" },
              },
              required: ["from", "to"],
            },
          },
          changes: {
            type: "array",
            items: { type: "string" },
            description: "List of human-readable changes made (e.g., 'Added database node', 'Connected auth to API')",
          },
        },
        required: ["nodes", "edges", "changes"],
      },
    };

    // Build user message with current diagram context
    const userMessage =
      buildDiagramContext(spec, prompt, context) +
      "\nUse the transform_diagram tool to return the complete updated diagram with all changes applied.";

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Client existence verified by transformDiagram before calling this method
        const response = await this.client!.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: DIAGRAM_SYSTEM_PROMPT,
          tools: [transformTool],
          tool_choice: { type: "tool", name: "transform_diagram" },
          messages: [{ role: "user", content: userMessage }],
        });

        // Extract tool use from response
        const toolUse = response.content.find(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        if (!toolUse) {
          return {
            success: false,
            error: "Model did not return a diagram transformation",
          };
        }

        // Validate the output with Zod
        const parseResult = DiagramTransformOutputSchema.safeParse(toolUse.input);

        if (!parseResult.success) {
          log.error("Invalid tool output", { error: parseResult.error.message });
          if (attempt < maxRetries) {
            await backoffDelay(attempt);
            continue;
          }
          return {
            success: false,
            error: `Invalid transformation output: ${parseResult.error.message}`,
          };
        }

        const output: DiagramTransformOutput = parseResult.data;

        const usage = {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          model: this.config.model,
        };

        log.info("Transform completed", {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          changesCount: output.changes.length,
        });

        return {
          success: true,
          spec: buildUpdatedSpec(spec, output),
          changes: output.changes,
          usage,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        log.error("Attempt failed", { attempt: attempt + 1, error: lastError.message });

        // Check for rate limiting - use slower backoff
        const isRateLimit =
          lastError.message.includes("429") ||
          lastError.message.includes("rate_limit") ||
          lastError.message.includes("overloaded");

        if (attempt < maxRetries) {
          await backoffDelay(attempt, isRateLimit ? 2000 : 500); // 2x slower backoff for rate limits
        }
      }
    }

    // Throw error so circuit breaker can track the failure
    throw lastError || new Error("Failed to transform diagram after retries");
  }
}

// Factory function
export function createAnthropicProvider(config?: Partial<LLMProviderConfig>): AnthropicProvider {
  return new AnthropicProvider(config);
}
