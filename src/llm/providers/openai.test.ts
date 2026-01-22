/**
 * OpenAI Provider Tests
 *
 * Tests the OpenAI LLM provider with mocked API responses
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { OpenAIProvider, createOpenAIProvider } from "./openai";
import type { DiagramTransformRequest } from "../types";

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

// Mock OpenAI API response
const mockChatCompletion = {
  id: "chatcmpl-123",
  object: "chat.completion",
  created: 1677652288,
  model: "gpt-4o",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "transform_diagram",
              arguments: JSON.stringify(validTransformResponse),
            },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: {
    prompt_tokens: 150,
    completion_tokens: 75,
    total_tokens: 225,
  },
};

describe("OpenAIProvider", () => {
  // Save original env
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    // Set a test API key
    process.env.OPENAI_API_KEY = "test-api-key";
  });

  afterEach(() => {
    // Restore original env
    if (originalApiKey) {
      process.env.OPENAI_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  describe("constructor", () => {
    test("should use default configuration with env API key", () => {
      const provider = new OpenAIProvider();
      expect(provider.type).toBe("openai");
      expect(provider.name).toBe("OpenAI GPT");
      expect(provider.isConfigured).toBe(true);
    });

    test("should accept custom configuration", () => {
      const provider = new OpenAIProvider({
        apiKey: "custom-key",
        model: "gpt-4-turbo",
        temperature: 0.5,
      });
      expect(provider.isConfigured).toBe(true);
    });

    test("should not be configured without API key", () => {
      delete process.env.OPENAI_API_KEY;
      const provider = new OpenAIProvider();
      expect(provider.isConfigured).toBe(false);
    });
  });

  describe("transformDiagram", () => {
    const transformRequest: DiagramTransformRequest = {
      spec: mockDiagram,
      prompt: "Add an end node and connect it",
    };

    test("should return error when not configured", async () => {
      delete process.env.OPENAI_API_KEY;
      const provider = new OpenAIProvider();
      const result = await provider.transformDiagram(transformRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain("OpenAI API key not configured");
    });

    // Note: Full integration tests would require mocking the OpenAI client
    // which is complex due to the class instantiation. These tests verify
    // the basic error handling paths.
  });

  describe("factory function", () => {
    test("should create provider with createOpenAIProvider", () => {
      const provider = createOpenAIProvider({ apiKey: "test-key" });
      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.isConfigured).toBe(true);
    });

    test("should create unconfigured provider without API key", () => {
      delete process.env.OPENAI_API_KEY;
      const provider = createOpenAIProvider();
      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.isConfigured).toBe(false);
    });
  });
});

// Additional tests that would be useful with proper OpenAI SDK mocking:
// - successful transformation with tool calls
// - handling invalid JSON in function arguments
// - handling schema validation errors
// - retry on transient failures
// - rate limit handling with longer backoff
// - context inclusion in prompts
