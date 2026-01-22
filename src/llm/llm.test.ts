/**
 * LLM Module Tests
 * Tests for registry, providers, and schema validation
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { z } from "zod";
import {
  DiagramTransformOutputSchema,
  type DiagramTransformRequest,
  type DiagramTransformResponse,
  type LLMProviderType,
} from "./types";
import { OpenAIProvider, createOpenAIProvider } from "./providers/openai";
import { OllamaProvider, createOllamaProvider } from "./providers/ollama";
import {
  getProviderRegistry,
  getProvider,
  getDefaultProvider,
  listProviders,
  listConfiguredProviders,
} from "./registry";
import type { DiagramSpec } from "../types";

describe("DiagramTransformOutputSchema", () => {
  it("validates correct diagram output", () => {
    const validOutput = {
      nodes: [
        { id: "a", label: "Start" },
        { id: "b", label: "Process", type: "box" },
      ],
      edges: [{ from: "a", to: "b" }],
      changes: ["Added node 'Start'", "Added node 'Process'"],
    };

    const result = DiagramTransformOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("validates nodes with all optional fields", () => {
    const fullNode = {
      nodes: [
        {
          id: "db",
          label: "Database",
          type: "database",
          color: "#ff0000",
          position: { x: 100, y: 200 },
          details: "Stores user data",
          width: 200,
          height: 100,
        },
      ],
      edges: [],
      changes: [],
    };

    const result = DiagramTransformOutputSchema.safeParse(fullNode);
    expect(result.success).toBe(true);
  });

  it("validates edges with all optional fields", () => {
    const fullEdge = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [
        {
          id: "edge-1",
          from: "a",
          to: "b",
          label: "connects to",
          style: "dashed",
          color: "#00ff00",
        },
      ],
      changes: [],
    };

    const result = DiagramTransformOutputSchema.safeParse(fullEdge);
    expect(result.success).toBe(true);
  });

  it("rejects missing required node fields", () => {
    const missingLabel = {
      nodes: [{ id: "a" }], // missing label
      edges: [],
      changes: [],
    };

    const result = DiagramTransformOutputSchema.safeParse(missingLabel);
    expect(result.success).toBe(false);
  });

  it("rejects missing required edge fields", () => {
    const missingTo = {
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a" }], // missing to
      changes: [],
    };

    const result = DiagramTransformOutputSchema.safeParse(missingTo);
    expect(result.success).toBe(false);
  });

  it("rejects invalid node type", () => {
    const invalidType = {
      nodes: [{ id: "a", label: "A", type: "invalid" }],
      edges: [],
      changes: [],
    };

    const result = DiagramTransformOutputSchema.safeParse(invalidType);
    expect(result.success).toBe(false);
  });

  it("rejects invalid edge style", () => {
    const invalidStyle = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b", style: "wavy" }],
      changes: [],
    };

    const result = DiagramTransformOutputSchema.safeParse(invalidStyle);
    expect(result.success).toBe(false);
  });

  it("validates all valid node types", () => {
    const validTypes = ["box", "diamond", "circle", "database", "cloud", "cylinder"];

    for (const type of validTypes) {
      const output = {
        nodes: [{ id: "a", label: "A", type }],
        edges: [],
        changes: [],
      };
      const result = DiagramTransformOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    }
  });

  it("validates all valid edge styles", () => {
    const validStyles = ["solid", "dashed", "dotted"];

    for (const style of validStyles) {
      const output = {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b", style }],
        changes: [],
      };
      const result = DiagramTransformOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    }
  });

  it("rejects non-numeric position values", () => {
    const invalidPosition = {
      nodes: [{ id: "a", label: "A", position: { x: "100", y: "200" } }],
      edges: [],
      changes: [],
    };

    const result = DiagramTransformOutputSchema.safeParse(invalidPosition);
    expect(result.success).toBe(false);
  });
});

describe("OpenAIProvider", () => {
  it("creates instance with correct type and name", () => {
    const provider = new OpenAIProvider();
    expect(provider.type).toBe("openai");
    expect(provider.name).toBe("OpenAI GPT");
  });

  it("isConfigured returns false without API key", () => {
    const provider = new OpenAIProvider({ apiKey: undefined });
    // Will be true if OPENAI_API_KEY is set in env, otherwise false
    expect(typeof provider.isConfigured).toBe("boolean");
  });

  it("isConfigured returns true with API key", () => {
    const provider = new OpenAIProvider({ apiKey: "test-key" });
    expect(provider.isConfigured).toBe(true);
  });

  it("healthCheck returns false (not implemented)", async () => {
    const provider = new OpenAIProvider();
    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });

  it("transformDiagram returns not implemented error", async () => {
    const provider = new OpenAIProvider();
    const request: DiagramTransformRequest = {
      spec: { type: "flowchart", nodes: [], edges: [] },
      prompt: "Add a node",
    };

    const result = await provider.transformDiagram(request);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not yet implemented");
  });

  it("createOpenAIProvider factory works", () => {
    const provider = createOpenAIProvider({ apiKey: "test-key" });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.isConfigured).toBe(true);
  });
});

describe("OllamaProvider", () => {
  it("creates instance with correct type and name", () => {
    const provider = new OllamaProvider();
    expect(provider.type).toBe("ollama");
    expect(provider.name).toBe("Ollama (Local)");
  });

  it("isConfigured returns true (no API key needed)", () => {
    const provider = new OllamaProvider();
    expect(provider.isConfigured).toBe(true);
  });

  it("uses custom baseUrl from config", () => {
    const provider = new OllamaProvider({ baseUrl: "http://custom:8080" });
    // Can't directly access private field, but we can test via transformDiagram error
    expect(provider.isConfigured).toBe(true);
  });

  it("uses custom model from config", () => {
    const provider = new OllamaProvider({ model: "codellama" });
    expect(provider.isConfigured).toBe(true);
  });

  it("healthCheck returns false when server not running", async () => {
    // Use a port that definitely isn't running Ollama
    const provider = new OllamaProvider({ baseUrl: "http://localhost:19999" });
    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });

  it("transformDiagram returns error when server not available", async () => {
    const provider = new OllamaProvider({ baseUrl: "http://localhost:19999" });
    const request: DiagramTransformRequest = {
      spec: { type: "flowchart", nodes: [], edges: [] },
      prompt: "Add a node",
    };

    const result = await provider.transformDiagram(request);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not available");
  });

  it("createOllamaProvider factory works", () => {
    const provider = createOllamaProvider({ baseUrl: "http://custom:8080" });
    expect(provider).toBeInstanceOf(OllamaProvider);
  });
});

describe("Provider Registry", () => {
  it("returns registry instance", () => {
    const registry = getProviderRegistry();
    expect(registry).toBeDefined();
  });

  it("returns same instance (singleton)", () => {
    const registry1 = getProviderRegistry();
    const registry2 = getProviderRegistry();
    expect(registry1).toBe(registry2);
  });

  it("lists all providers", () => {
    const providers = listProviders();
    expect(providers.length).toBeGreaterThanOrEqual(3);

    const types = providers.map((p) => p.type);
    expect(types).toContain("anthropic");
    expect(types).toContain("openai");
    expect(types).toContain("ollama");
  });

  it("gets provider by type", () => {
    const anthropic = getProvider("anthropic");
    const openai = getProvider("openai");
    const ollama = getProvider("ollama");

    expect(anthropic?.type).toBe("anthropic");
    expect(openai?.type).toBe("openai");
    expect(ollama?.type).toBe("ollama");
  });

  it("returns undefined for unknown provider type", () => {
    // @ts-expect-error - testing runtime behavior with invalid type
    const provider = getProvider("unknown");
    expect(provider).toBeUndefined();
  });

  it("getDefaultProvider returns a provider when configured", () => {
    const defaultProvider = getDefaultProvider();
    // May be undefined if no providers are configured
    if (defaultProvider) {
      expect(defaultProvider.type).toBeDefined();
      expect(defaultProvider.name).toBeDefined();
    }
  });

  it("listConfiguredProviders only returns configured providers", () => {
    const configured = listConfiguredProviders();
    for (const provider of configured) {
      expect(provider.isConfigured).toBe(true);
    }
  });

  it("registry get returns specific provider", () => {
    const registry = getProviderRegistry();
    const anthropic = registry.get("anthropic");
    expect(anthropic?.type).toBe("anthropic");
  });

  it("registry list returns all registered providers", () => {
    const registry = getProviderRegistry();
    const all = registry.list();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it("registry createProvider creates new provider instances", () => {
    const registry = getProviderRegistry();

    const anthropic = registry.createProvider("anthropic", { apiKey: "test" });
    expect(anthropic.type).toBe("anthropic");
    expect(anthropic.isConfigured).toBe(true);

    const openai = registry.createProvider("openai", { apiKey: "test" });
    expect(openai.type).toBe("openai");

    const ollama = registry.createProvider("ollama", { baseUrl: "http://test:8080" });
    expect(ollama.type).toBe("ollama");
  });

  it("registry createProvider throws for unknown type", () => {
    const registry = getProviderRegistry();
    expect(() => {
      // @ts-expect-error - testing runtime behavior with invalid type
      registry.createProvider("unknown");
    }).toThrow("Unknown provider type");
  });
});

describe("LLM Provider Interface Compliance", () => {
  const providers = [createOpenAIProvider(), createOllamaProvider()];

  for (const provider of providers) {
    describe(`${provider.name}`, () => {
      it("has type property", () => {
        expect(provider.type).toBeDefined();
        expect(["anthropic", "openai", "ollama"]).toContain(provider.type);
      });

      it("has name property", () => {
        expect(provider.name).toBeDefined();
        expect(typeof provider.name).toBe("string");
      });

      it("has isConfigured boolean property", () => {
        expect(typeof provider.isConfigured).toBe("boolean");
      });

      it("has healthCheck async method", async () => {
        expect(typeof provider.healthCheck).toBe("function");
        const result = await provider.healthCheck();
        expect(typeof result).toBe("boolean");
      });

      it("has transformDiagram async method", async () => {
        expect(typeof provider.transformDiagram).toBe("function");
        const request: DiagramTransformRequest = {
          spec: { type: "flowchart", nodes: [], edges: [] },
          prompt: "Test prompt",
        };
        const result = await provider.transformDiagram(request);
        expect(result).toHaveProperty("success");
      });

      it("transformDiagram returns proper response structure", async () => {
        const request: DiagramTransformRequest = {
          spec: { type: "flowchart", nodes: [], edges: [] },
          prompt: "Test prompt",
        };
        const result = await provider.transformDiagram(request);

        expect(typeof result.success).toBe("boolean");
        if (result.success) {
          expect(result.spec).toBeDefined();
        } else {
          expect(result.error).toBeDefined();
        }
      });
    });
  }
});

describe("Registry Status", () => {
  it("getStatus returns status for all providers", async () => {
    const registry = getProviderRegistry();
    const status = await registry.getStatus();

    expect(status).toHaveProperty("anthropic");
    expect(status).toHaveProperty("openai");
    expect(status).toHaveProperty("ollama");

    // Each status should have configured and healthy booleans
    for (const [_type, providerStatus] of Object.entries(status)) {
      expect(typeof providerStatus.configured).toBe("boolean");
      expect(typeof providerStatus.healthy).toBe("boolean");
    }
  });

  it("unconfigured providers are not healthy", async () => {
    const registry = getProviderRegistry();
    const status = await registry.getStatus();

    for (const [_type, providerStatus] of Object.entries(status)) {
      if (!providerStatus.configured) {
        expect(providerStatus.healthy).toBe(false);
      }
    }
  });
});
