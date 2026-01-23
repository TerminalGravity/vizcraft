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
import type { DiagramSpec } from "../../types";
import { createLogger } from "../../logging";
import { circuitBreakers, CircuitBreakerError } from "../../utils/circuit-breaker";

const log = createLogger("anthropic");

// Default configuration
const DEFAULT_CONFIG = {
  model: "claude-sonnet-4-5-20250929",
  maxTokens: 4096,
  temperature: 0.3,
};

// System prompt for diagram transformation
const DIAGRAM_SYSTEM_PROMPT = `You are Vizcraft, an expert diagram transformation agent. You analyze and modify diagrams based on natural language instructions.

You work with DiagramSpec objects containing:
- nodes: Array of {id, label, type, color, position, details}
- edges: Array of {from, to, label, style, color}

Node types: box (default), diamond (decisions), circle (events), database, cloud, cylinder
Edge styles: solid (default), dashed, dotted

Guidelines:
1. Preserve existing IDs when updating nodes/edges
2. Generate unique IDs for new elements (use descriptive names like "auth-service", "db-connection")
3. Maintain graph connectivity - don't orphan nodes
4. Position new nodes logically relative to existing ones
5. Be concise in labels - use technical but readable names
6. Always explain what changes you made

Colors should be CSS hex values (#1e293b, #3b82f6, etc.)`;

export class AnthropicProvider implements LLMProvider {
  readonly type = "anthropic" as const;
  readonly name = "Anthropic Claude";

  private client: Anthropic | null = null;
  private config: typeof DEFAULT_CONFIG;
  private apiKey: string | undefined;

  constructor(config?: Partial<LLMProviderConfig>) {
    this.apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY;
    this.config = {
      model: config?.model || DEFAULT_CONFIG.model,
      maxTokens: config?.maxTokens || DEFAULT_CONFIG.maxTokens,
      temperature: config?.temperature || DEFAULT_CONFIG.temperature,
    };

    if (this.apiKey) {
      this.client = new Anthropic({ apiKey: this.apiKey });
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
    const userMessage = this.buildUserMessage(spec, prompt, context);

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
            await this.delay(Math.pow(2, attempt) * 500); // Exponential backoff
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

        return {
          success: true,
          spec: updatedSpec,
          changes: output.changes,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            model: this.config.model,
          },
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        log.error("Attempt failed", { attempt: attempt + 1, error: lastError.message });

        if (attempt < maxRetries) {
          await this.delay(Math.pow(2, attempt) * 500);
        }
      }
    }

    // Throw error so circuit breaker can track the failure
    throw lastError || new Error("Failed to transform diagram after retries");
  }

  private buildUserMessage(spec: DiagramSpec, prompt: string, context?: string): string {
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
    parts.push(
      "\nUse the transform_diagram tool to return the complete updated diagram with all changes applied."
    );

    return parts.join("\n");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Factory function
export function createAnthropicProvider(config?: Partial<LLMProviderConfig>): AnthropicProvider {
  return new AnthropicProvider(config);
}
