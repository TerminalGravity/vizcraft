/**
 * OpenAI LLM Provider
 * GPT-4/GPT-4o integration for Vizcraft diagram agents
 *
 * Features:
 * - Structured outputs with function calling
 * - Zod schema validation
 * - Retry with exponential backoff
 * - Usage tracking
 * - Support for GPT-4, GPT-4o, GPT-4-turbo
 */

import OpenAI from "openai";
import type {
  LLMProvider,
  LLMProviderConfig,
  DiagramTransformRequest,
  DiagramTransformResponse,
  DiagramTransformOutput,
} from "../types";
import { DiagramTransformOutputSchema } from "../types";
import type { DiagramSpec } from "../../types";

// Default configuration
const DEFAULT_CONFIG = {
  model: "gpt-4o",
  maxTokens: 4096,
  temperature: 0.3,
};

// System prompt for diagram transformation (same as Anthropic)
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

// OpenAI function definition for diagram transformation
const TRANSFORM_FUNCTION: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "transform_diagram",
    description:
      "Transform the diagram by returning the complete updated node and edge arrays along with a list of changes made.",
    parameters: {
      type: "object",
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
          description:
            "List of human-readable changes made (e.g., 'Added database node', 'Connected auth to API')",
        },
      },
      required: ["nodes", "edges", "changes"],
    },
  },
};

export class OpenAIProvider implements LLMProvider {
  readonly type = "openai" as const;
  readonly name = "OpenAI GPT";

  private client: OpenAI | null = null;
  private config: typeof DEFAULT_CONFIG;
  private apiKey: string | undefined;

  constructor(config?: Partial<LLMProviderConfig>) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    this.config = {
      model: config?.model || DEFAULT_CONFIG.model,
      maxTokens: config?.maxTokens || DEFAULT_CONFIG.maxTokens,
      temperature: config?.temperature || DEFAULT_CONFIG.temperature,
    };

    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: config?.baseUrl, // Allow custom base URL for Azure OpenAI etc.
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
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        max_tokens: 10,
        messages: [{ role: "user", content: "Say 'ok'" }],
      });
      return (response.choices?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  async transformDiagram(request: DiagramTransformRequest): Promise<DiagramTransformResponse> {
    if (!this.client) {
      return {
        success: false,
        error: "OpenAI API key not configured. Set OPENAI_API_KEY environment variable.",
      };
    }

    const { spec, prompt, context, maxRetries = 2 } = request;

    // Build user message with current diagram context
    const userMessage = this.buildUserMessage(spec, prompt, context);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          messages: [
            { role: "system", content: DIAGRAM_SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          tools: [TRANSFORM_FUNCTION],
          tool_choice: { type: "function", function: { name: "transform_diagram" } },
        });

        // Extract tool call from response
        const choice = response.choices?.[0];
        const toolCall = choice?.message?.tool_calls?.[0];

        // Type guard: ensure we have a function tool call (not custom)
        if (!toolCall || toolCall.type !== "function") {
          return {
            success: false,
            error: "Model did not return a diagram transformation",
          };
        }

        // Now TypeScript knows toolCall is ChatCompletionMessageFunctionToolCall
        if (toolCall.function.name !== "transform_diagram") {
          return {
            success: false,
            error: "Model returned unexpected function call",
          };
        }

        // Parse the function arguments
        let parsedArgs: unknown;
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          console.error("[openai] Failed to parse function arguments:", toolCall.function.arguments);
          if (attempt < maxRetries) {
            await this.delay(Math.pow(2, attempt) * 500);
            continue;
          }
          return {
            success: false,
            error: `Invalid function response: ${parseError instanceof Error ? parseError.message : "parse error"}`,
          };
        }

        // Validate the output with Zod
        const parseResult = DiagramTransformOutputSchema.safeParse(parsedArgs);

        if (!parseResult.success) {
          console.error("[openai] Invalid tool output:", parseResult.error.message);
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

        return {
          success: true,
          spec: updatedSpec,
          changes: output.changes,
          usage: {
            inputTokens: response.usage?.prompt_tokens || 0,
            outputTokens: response.usage?.completion_tokens || 0,
            model: this.config.model,
          },
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`[openai] Attempt ${attempt + 1} failed:`, lastError.message);

        // Check for rate limiting
        if (lastError.message.includes("429") || lastError.message.includes("rate limit")) {
          // Wait longer for rate limits
          await this.delay(Math.pow(2, attempt) * 2000);
        } else if (attempt < maxRetries) {
          await this.delay(Math.pow(2, attempt) * 500);
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || "Failed to transform diagram after retries",
    };
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
      "\nUse the transform_diagram function to return the complete updated diagram with all changes applied."
    );

    return parts.join("\n");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Factory function
export function createOpenAIProvider(config?: Partial<LLMProviderConfig>): OpenAIProvider {
  return new OpenAIProvider(config);
}
