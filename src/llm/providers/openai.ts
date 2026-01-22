/**
 * OpenAI LLM Provider (Stub)
 * Placeholder for OpenAI GPT integration
 *
 * This is a model-agnostic design - OpenAI can be added later
 * by implementing the same interface as Anthropic.
 */

import type {
  LLMProvider,
  LLMProviderConfig,
  DiagramTransformRequest,
  DiagramTransformResponse,
} from "../types";

export class OpenAIProvider implements LLMProvider {
  readonly type = "openai" as const;
  readonly name = "OpenAI GPT";

  private apiKey: string | undefined;

  constructor(config?: Partial<LLMProviderConfig>) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    // TODO: Implement when OpenAI support is added
    return false;
  }

  async transformDiagram(_request: DiagramTransformRequest): Promise<DiagramTransformResponse> {
    return {
      success: false,
      error: "OpenAI provider not yet implemented. Use Anthropic provider instead.",
    };
  }
}

export function createOpenAIProvider(config?: Partial<LLMProviderConfig>): OpenAIProvider {
  return new OpenAIProvider(config);
}
