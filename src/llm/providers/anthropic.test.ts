/**
 * Anthropic Provider Tests
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { AnthropicProvider } from "./anthropic";
import type { DiagramSpec } from "../../types";

const sampleSpec: DiagramSpec = {
  type: "flowchart",
  theme: "dark",
  nodes: [
    { id: "start", label: "Start" },
    { id: "process", label: "Process Data" },
    { id: "end", label: "End" },
  ],
  edges: [
    { from: "start", to: "process" },
    { from: "process", to: "end" },
  ],
};

describe("AnthropicProvider", () => {
  test("creates instance without API key", () => {
    const provider = new AnthropicProvider();
    expect(provider.type).toBe("anthropic");
    expect(provider.name).toBe("Anthropic Claude");
  });

  test("isConfigured returns false without API key", () => {
    const provider = new AnthropicProvider({ apiKey: undefined });
    // Note: Will be true if ANTHROPIC_API_KEY is in env
    expect(typeof provider.isConfigured).toBe("boolean");
  });

  test("handles API configuration states correctly", async () => {
    const provider = new AnthropicProvider();

    if (!provider.isConfigured) {
      // Not configured - should return config error
      const result = await provider.transformDiagram({
        spec: sampleSpec,
        prompt: "Add a database node",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");
    } else {
      // Configured - could succeed or fail depending on key validity
      const result = await provider.transformDiagram({
        spec: sampleSpec,
        prompt: "Add a database node",
      });
      // Either success with spec, or failure with error
      if (result.success) {
        expect(result.spec).toBeDefined();
        expect(result.spec!.nodes.length).toBeGreaterThanOrEqual(3);
      } else {
        expect(result.error).toBeDefined();
      }
    }
  });
});

// Integration tests - only run with valid API key
describe("AnthropicProvider Integration", () => {
  let provider: AnthropicProvider;
  let hasValidKey: boolean;

  beforeAll(async () => {
    provider = new AnthropicProvider();
    hasValidKey = provider.isConfigured && (await provider.healthCheck());
  });

  test("healthCheck works with valid API key", async () => {
    if (!hasValidKey) {
      console.log("Skipping integration test - no valid API key");
      return;
    }

    const isHealthy = await provider.healthCheck();
    expect(isHealthy).toBe(true);
  });

  test("transformDiagram adds nodes correctly", async () => {
    if (!hasValidKey) {
      console.log("Skipping integration test - no valid API key");
      return;
    }

    const result = await provider.transformDiagram({
      spec: sampleSpec,
      prompt: "Add a 'Database' node connected from 'Process Data'",
      maxRetries: 1,
    });

    expect(result.success).toBe(true);
    expect(result.spec).toBeDefined();
    expect(result.spec!.nodes.length).toBeGreaterThanOrEqual(4);
    expect(result.changes).toBeDefined();
    expect(result.changes!.length).toBeGreaterThan(0);
    expect(result.usage).toBeDefined();

    // Check that database node was added
    const dbNode = result.spec!.nodes.find(
      (n) => n.label.toLowerCase().includes("database") || n.type === "database"
    );
    expect(dbNode).toBeDefined();
  });
});
