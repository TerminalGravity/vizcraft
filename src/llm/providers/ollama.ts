/**
 * Ollama LLM Provider (Stub)
 * Placeholder for local model integration via Ollama
 *
 * Ollama enables running models like Llama, Mistral, CodeLlama locally.
 * This stub can be expanded when local model support is needed.
 */

import type {
  LLMProvider,
  LLMProviderConfig,
  DiagramTransformRequest,
  DiagramTransformResponse,
} from "../types";

const DEFAULT_BASE_URL = "http://localhost:11434";

export class OllamaProvider implements LLMProvider {
  readonly type = "ollama" as const;
  readonly name = "Ollama (Local)";

  private baseUrl: string;
  private model: string;

  constructor(config?: Partial<LLMProviderConfig>) {
    this.baseUrl = config?.baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
    this.model = config?.model || process.env.OLLAMA_MODEL || "llama3.2";
  }

  get isConfigured(): boolean {
    // Ollama doesn't need an API key - just check if server is running
    return true;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async transformDiagram(_request: DiagramTransformRequest): Promise<DiagramTransformResponse> {
    // Check if Ollama is running
    const isHealthy = await this.healthCheck();
    if (!isHealthy) {
      return {
        success: false,
        error: `Ollama not available at ${this.baseUrl}. Start Ollama or use Anthropic provider.`,
      };
    }

    // TODO: Implement full Ollama integration
    // This would involve:
    // 1. Using structured output with JSON mode
    // 2. Parsing the response to match DiagramTransformOutput
    // 3. Handling different model capabilities

    return {
      success: false,
      error: "Ollama provider not yet fully implemented. Use Anthropic provider for best results.",
    };
  }
}

export function createOllamaProvider(config?: Partial<LLMProviderConfig>): OllamaProvider {
  return new OllamaProvider(config);
}
