/**
 * Ollama Provider Tests
 *
 * Tests the Ollama LLM provider with mocked API responses
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { OllamaProvider, createOllamaProvider } from "./ollama";
import type { DiagramTransformRequest } from "../types";
import { circuitBreakers } from "../../utils/circuit-breaker";

// Mock diagram for testing
const mockDiagram = {
  type: "flowchart" as const,
  theme: "dark" as const,
  nodes: [
    { id: "start", label: "Start", type: "circle" as const },
    { id: "process", label: "Process", type: "box" as const },
  ],
  edges: [{ from: "start", to: "process" }],
};

// Valid transformation response matching the schema
const validTransformResponse = {
  nodes: [
    { id: "start", label: "Start", type: "circle" },
    { id: "process", label: "Process", type: "box" },
    { id: "end", label: "End", type: "circle" },
  ],
  edges: [
    { from: "start", to: "process" },
    { from: "process", to: "end" },
  ],
  changes: ["Added end node", "Connected process to end"],
};

// Mock Ollama API responses
const mockTagsResponse = {
  models: [
    { name: "llama3.2", model: "llama3.2", modified_at: "2024-01-01", size: 1000000, digest: "abc123" },
    { name: "codellama:7b", model: "codellama:7b", modified_at: "2024-01-01", size: 2000000, digest: "def456" },
  ],
};

const mockGenerateResponse = {
  model: "llama3.2",
  response: JSON.stringify(validTransformResponse),
  done: true,
  prompt_eval_count: 150,
  eval_count: 75,
  total_duration: 5000000000,
};

describe("OllamaProvider", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    // Reset circuit breaker state to prevent test pollution
    circuitBreakers.llm.reset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("constructor", () => {
    test("should use default configuration", () => {
      const provider = new OllamaProvider();
      expect(provider.type).toBe("ollama");
      expect(provider.name).toBe("Ollama (Local)");
      expect(provider.isConfigured).toBe(true);
    });

    test("should accept custom configuration", () => {
      const provider = new OllamaProvider({
        baseUrl: "http://custom:8080",
        model: "mistral",
        temperature: 0.5,
      });
      expect(provider.isConfigured).toBe(true);
    });
  });

  describe("healthCheck", () => {
    test("should return true when Ollama is available", async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTagsResponse),
        } as Response)
      );

      const provider = new OllamaProvider();
      const result = await provider.healthCheck();
      expect(result).toBe(true);
    });

    test("should return false when Ollama is unavailable", async () => {
      global.fetch = mock(() => Promise.reject(new Error("Connection refused")));

      const provider = new OllamaProvider();
      const result = await provider.healthCheck();
      expect(result).toBe(false);
    });

    test("should return false when API returns error", async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response)
      );

      const provider = new OllamaProvider();
      const result = await provider.healthCheck();
      expect(result).toBe(false);
    });

    test("should warn when model is not found", async () => {
      const consoleSpy = spyOn(console, "warn").mockImplementation(() => {});

      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: [{ name: "other-model" }] }),
        } as Response)
      );

      const provider = new OllamaProvider({ model: "nonexistent" });
      await provider.healthCheck();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("listModels", () => {
    test("should return list of available models", async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTagsResponse),
        } as Response)
      );

      const provider = new OllamaProvider();
      const models = await provider.listModels();
      expect(models).toEqual(["llama3.2", "codellama:7b"]);
    });

    test("should return empty array on error", async () => {
      global.fetch = mock(() => Promise.reject(new Error("Connection refused")));

      const provider = new OllamaProvider();
      const models = await provider.listModels();
      expect(models).toEqual([]);
    });
  });

  describe("transformDiagram", () => {
    const transformRequest: DiagramTransformRequest = {
      spec: mockDiagram,
      prompt: "Add an end node and connect it",
    };

    test("should successfully transform a diagram", async () => {
      let callCount = 0;
      global.fetch = mock((url: string) => {
        callCount++;
        if (url.includes("/api/tags")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTagsResponse),
          } as Response);
        }
        if (url.includes("/api/generate")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockGenerateResponse),
          } as Response);
        }
        return Promise.reject(new Error("Unknown endpoint"));
      });

      const provider = new OllamaProvider();
      const result = await provider.transformDiagram(transformRequest);

      expect(result.success).toBe(true);
      expect(result.spec).toBeDefined();
      expect(result.spec?.nodes).toHaveLength(3);
      expect(result.changes).toEqual(["Added end node", "Connected process to end"]);
      expect(result.usage).toBeDefined();
      expect(result.usage?.model).toBe("llama3.2");
    });

    test("should return error when Ollama is not available", async () => {
      global.fetch = mock(() => Promise.reject(new Error("Connection refused")));

      const provider = new OllamaProvider();
      const result = await provider.transformDiagram(transformRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Ollama not available");
    });

    test("should handle invalid JSON response", async () => {
      global.fetch = mock((url: string) => {
        if (url.includes("/api/tags")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTagsResponse),
          } as Response);
        }
        if (url.includes("/api/generate")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                ...mockGenerateResponse,
                response: "invalid json {{{",
              }),
          } as Response);
        }
        return Promise.reject(new Error("Unknown endpoint"));
      });

      const provider = new OllamaProvider();
      const result = await provider.transformDiagram({
        ...transformRequest,
        maxRetries: 0, // Disable retries for faster test
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("invalid JSON");
    });

    test("should handle schema validation errors", async () => {
      global.fetch = mock((url: string) => {
        if (url.includes("/api/tags")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTagsResponse),
          } as Response);
        }
        if (url.includes("/api/generate")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                ...mockGenerateResponse,
                response: JSON.stringify({ invalid: "schema" }),
              }),
          } as Response);
        }
        return Promise.reject(new Error("Unknown endpoint"));
      });

      const provider = new OllamaProvider();
      const result = await provider.transformDiagram({
        ...transformRequest,
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid transformation output");
    });

    test("should handle API errors", async () => {
      global.fetch = mock((url: string) => {
        if (url.includes("/api/tags")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTagsResponse),
          } as Response);
        }
        if (url.includes("/api/generate")) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve("Internal server error"),
          } as Response);
        }
        return Promise.reject(new Error("Unknown endpoint"));
      });

      const provider = new OllamaProvider();
      const result = await provider.transformDiagram({
        ...transformRequest,
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Ollama API error");
    });

    test("should include context in prompt when provided", async () => {
      let capturedBody: string | undefined;
      global.fetch = mock((url: string, options?: RequestInit) => {
        if (url.includes("/api/tags")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTagsResponse),
          } as Response);
        }
        if (url.includes("/api/generate")) {
          capturedBody = options?.body as string;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockGenerateResponse),
          } as Response);
        }
        return Promise.reject(new Error("Unknown endpoint"));
      });

      const provider = new OllamaProvider();
      await provider.transformDiagram({
        ...transformRequest,
        context: "This is a microservices architecture",
      });

      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.prompt).toContain("microservices architecture");
    });

    test("should retry on transient failures", async () => {
      let attempts = 0;
      global.fetch = mock((url: string) => {
        if (url.includes("/api/tags")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTagsResponse),
          } as Response);
        }
        if (url.includes("/api/generate")) {
          attempts++;
          if (attempts < 2) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  ...mockGenerateResponse,
                  response: "invalid", // First attempt returns invalid JSON
                }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockGenerateResponse),
          } as Response);
        }
        return Promise.reject(new Error("Unknown endpoint"));
      });

      const provider = new OllamaProvider();
      const result = await provider.transformDiagram({
        ...transformRequest,
        maxRetries: 2,
      });

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });
  });

  describe("factory function", () => {
    test("should create provider with createOllamaProvider", () => {
      const provider = createOllamaProvider({ model: "codellama" });
      expect(provider).toBeInstanceOf(OllamaProvider);
    });
  });
});
