/**
 * LLM Provider Registry
 * Manages available providers and selects the best one for each request
 */

import type { LLMProvider, LLMProviderRegistry, LLMProviderType, LLMProviderConfig } from "./types";
import { createAnthropicProvider } from "./providers/anthropic";
import { createOpenAIProvider } from "./providers/openai";
import { createOllamaProvider } from "./providers/ollama";

// Provider priority order (Anthropic first-class citizen)
const PROVIDER_PRIORITY: LLMProviderType[] = ["anthropic", "openai", "ollama"];

class Registry implements LLMProviderRegistry {
  private providers: Map<LLMProviderType, LLMProvider> = new Map();
  private defaultProvider: LLMProviderType | null = null;

  constructor() {
    // Initialize with default providers
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Create all providers with default configs
    const anthropic = createAnthropicProvider();
    const openai = createOpenAIProvider();
    const ollama = createOllamaProvider();

    this.providers.set("anthropic", anthropic);
    this.providers.set("openai", openai);
    this.providers.set("ollama", ollama);

    // Set default to first configured provider by priority
    for (const type of PROVIDER_PRIORITY) {
      const provider = this.providers.get(type);
      if (provider?.isConfigured) {
        this.defaultProvider = type;
        console.error(`[llm] Default provider: ${provider.name}`);
        break;
      }
    }

    if (!this.defaultProvider) {
      console.error("[llm] Warning: No LLM provider configured. Set ANTHROPIC_API_KEY for best experience.");
    }
  }

  get(type: LLMProviderType): LLMProvider | undefined {
    return this.providers.get(type);
  }

  getDefault(): LLMProvider | undefined {
    if (!this.defaultProvider) return undefined;
    return this.providers.get(this.defaultProvider);
  }

  list(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  listConfigured(): LLMProvider[] {
    return this.list().filter((p) => p.isConfigured);
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.type, provider);

    // Update default if this is higher priority and configured
    if (provider.isConfigured) {
      const currentPriority = this.defaultProvider
        ? PROVIDER_PRIORITY.indexOf(this.defaultProvider)
        : Infinity;
      const newPriority = PROVIDER_PRIORITY.indexOf(provider.type);

      if (newPriority < currentPriority) {
        this.defaultProvider = provider.type;
        console.error(`[llm] Updated default provider: ${provider.name}`);
      }
    }
  }

  // Create a provider with custom config
  createProvider(type: LLMProviderType, config?: Partial<LLMProviderConfig>): LLMProvider {
    switch (type) {
      case "anthropic":
        return createAnthropicProvider(config);
      case "openai":
        return createOpenAIProvider(config);
      case "ollama":
        return createOllamaProvider(config);
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

  // Get status of all providers
  async getStatus(): Promise<Record<LLMProviderType, { configured: boolean; healthy: boolean }>> {
    const status: Record<string, { configured: boolean; healthy: boolean }> = {};

    for (const [type, provider] of this.providers) {
      const configured = provider.isConfigured;
      const healthy = configured ? await provider.healthCheck() : false;
      status[type] = { configured, healthy };
    }

    return status as Record<LLMProviderType, { configured: boolean; healthy: boolean }>;
  }
}

// Singleton instance
let registry: Registry | null = null;

export function getProviderRegistry(): Registry {
  if (!registry) {
    registry = new Registry();
  }
  return registry;
}

// Convenience functions
export function getProvider(type?: LLMProviderType): LLMProvider | undefined {
  const reg = getProviderRegistry();
  return type ? reg.get(type) : reg.getDefault();
}

export function getDefaultProvider(): LLMProvider | undefined {
  return getProviderRegistry().getDefault();
}

export function listProviders(): LLMProvider[] {
  return getProviderRegistry().list();
}

export function listConfiguredProviders(): LLMProvider[] {
  return getProviderRegistry().listConfigured();
}
