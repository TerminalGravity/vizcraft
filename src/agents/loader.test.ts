/**
 * Agent Loader Tests
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { loadAgents, getAgent, validateAgentConfig, clearAgentCache } from "./loader";

describe("Agent Loader", () => {
  beforeEach(() => {
    clearAgentCache();
  });

  test("loads agents from data/agents directory", async () => {
    const agents = await loadAgents();
    expect(agents.length).toBeGreaterThan(0);
  });

  test("agents have required fields", async () => {
    const agents = await loadAgents();
    for (const agent of agents) {
      expect(agent.id).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.type).toBeDefined();
      expect(["rule-based", "preset", "llm"]).toContain(agent.type);
    }
  });

  test("can get agent by ID", async () => {
    const agent = await getAgent("auto-layout");
    expect(agent).not.toBeNull();
    expect(agent?.name).toBe("Auto Layout");
    expect(agent?.type).toBe("rule-based");
  });

  test("returns null for non-existent agent", async () => {
    const agent = await getAgent("non-existent-agent");
    expect(agent).toBeNull();
  });

  test("validates agent config schema", () => {
    const validConfig = {
      name: "Test Agent",
      type: "preset",
      description: "A test agent",
      styles: { color: "#fff" },
    };

    const validated = validateAgentConfig(validConfig);
    expect(validated.name).toBe("Test Agent");
  });

  test("rejects invalid agent config", () => {
    const invalidConfig = {
      // missing name
      type: "invalid-type",
    };

    expect(() => validateAgentConfig(invalidConfig)).toThrow();
  });
});
