/**
 * LLM Provider Types
 * Model-agnostic interface for diagram transformation agents
 */

import type { DiagramSpec } from "../types";
import { z } from "zod";

// Provider identifiers
export type LLMProviderType = "anthropic" | "openai" | "ollama";

// Provider configuration
export interface LLMProviderConfig {
  type: LLMProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

// Message format (model-agnostic)
export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// Diagram transformation request
export interface DiagramTransformRequest {
  spec: DiagramSpec;
  prompt: string;
  context?: string;
  maxRetries?: number;
}

// Diagram transformation response
export interface DiagramTransformResponse {
  success: boolean;
  spec?: DiagramSpec;
  changes?: string[];
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
}

// Zod schema for diagram transformation output
export const DiagramTransformOutputSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      type: z.enum(["box", "diamond", "circle", "database", "cloud", "cylinder"]).optional(),
      color: z.string().optional(),
      position: z
        .object({
          x: z.number(),
          y: z.number(),
        })
        .optional(),
      details: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
  ),
  edges: z.array(
    z.object({
      id: z.string().optional(),
      from: z.string(),
      to: z.string(),
      label: z.string().optional(),
      style: z.enum(["solid", "dashed", "dotted"]).optional(),
      color: z.string().optional(),
    })
  ),
  changes: z.array(z.string()).describe("List of changes made to the diagram"),
});

export type DiagramTransformOutput = z.infer<typeof DiagramTransformOutputSchema>;

// Provider interface
export interface LLMProvider {
  readonly type: LLMProviderType;
  readonly name: string;
  readonly isConfigured: boolean;

  // Transform a diagram using natural language
  transformDiagram(request: DiagramTransformRequest): Promise<DiagramTransformResponse>;

  // Check if provider is available
  healthCheck(): Promise<boolean>;
}

// Provider factory type
export type LLMProviderFactory = (config?: Partial<LLMProviderConfig>) => LLMProvider;

// Provider registry
export interface LLMProviderRegistry {
  get(type: LLMProviderType): LLMProvider | undefined;
  getDefault(): LLMProvider | undefined;
  list(): LLMProvider[];
  register(provider: LLMProvider): void;
}
