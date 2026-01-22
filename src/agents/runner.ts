/**
 * Agent Runner
 * Executes agents on diagrams and returns transformed specs
 */

import dagre from "@dagrejs/dagre";
import type { DiagramSpec, DiagramNode } from "../types";
import type { LoadedAgent } from "./loader";
import { getProvider } from "../llm";
import { circuitBreakers, CircuitBreakerError } from "../utils/circuit-breaker";

export interface AgentRunResult {
  success: boolean;
  spec?: DiagramSpec;
  error?: string;
  changes?: string[];
}

// Run an agent on a diagram spec
export async function runAgent(agent: LoadedAgent, spec: DiagramSpec): Promise<AgentRunResult> {
  try {
    switch (agent.type) {
      case "rule-based":
        return await runRuleBasedAgent(agent, spec);
      case "preset":
        return await runPresetAgent(agent, spec);
      case "llm":
        return await runLLMAgent(agent, spec);
      default:
        return { success: false, error: `Unknown agent type: ${agent.type}` };
    }
  } catch (err) {
    return { success: false, error: `Agent execution failed: ${err}` };
  }
}

// Rule-based agents (like auto-layout)
async function runRuleBasedAgent(agent: LoadedAgent, spec: DiagramSpec): Promise<AgentRunResult> {
  const actions = agent.actions || [];
  let currentSpec = structuredClone(spec);
  const changes: string[] = [];

  for (const action of actions) {
    switch (action) {
      case "dagre_layout":
        currentSpec = applyDagreLayout(currentSpec);
        changes.push("Applied dagre graph layout");
        break;
      case "snap_to_grid":
        currentSpec = snapToGrid(currentSpec, 20);
        changes.push("Snapped nodes to 20px grid");
        break;
      default:
        console.warn(`Unknown action: ${action}`);
    }
  }

  return { success: true, spec: currentSpec, changes };
}

// Preset agents (like themes)
async function runPresetAgent(agent: LoadedAgent, spec: DiagramSpec): Promise<AgentRunResult> {
  const styles = agent.styles || {};
  const currentSpec = structuredClone(spec);
  const changes: string[] = [];

  // Apply colors to nodes
  if (styles.node_fill || styles.node_stroke) {
    currentSpec.nodes = currentSpec.nodes.map((node) => ({
      ...node,
      color: styles.node_fill || node.color,
    }));
    changes.push("Applied node colors");
  }

  // Apply colors to edges
  if (styles.edge_color) {
    currentSpec.edges = currentSpec.edges.map((edge) => ({
      ...edge,
      color: styles.edge_color,
    }));
    changes.push("Applied edge colors");
  }

  // Apply theme
  if (styles.background === "#0f172a") {
    currentSpec.theme = "dark";
    changes.push("Set dark theme");
  } else if (styles.background === "#ffffff" || styles.background === "#f8fafc") {
    currentSpec.theme = "light";
    changes.push("Set light theme");
  }

  return { success: true, spec: currentSpec, changes };
}

// LLM agents - uses model-agnostic provider system with circuit breaker protection
async function runLLMAgent(agent: LoadedAgent, spec: DiagramSpec): Promise<AgentRunResult> {
  // Check circuit breaker state first
  if (!circuitBreakers.llm.canExecute()) {
    const retryAfter = circuitBreakers.llm.getRetryAfter();
    return {
      success: false,
      error: `LLM service temporarily unavailable. Please retry in ${retryAfter} seconds.`,
    };
  }

  // Get the appropriate provider (defaults to Anthropic)
  const provider = getProvider(agent.provider);

  if (!provider) {
    return {
      success: false,
      error: `No LLM provider configured. Set ANTHROPIC_API_KEY environment variable.`,
    };
  }

  if (!provider.isConfigured) {
    return {
      success: false,
      error: `${provider.name} is not configured. Check your API key.`,
    };
  }

  if (!agent.prompt) {
    return {
      success: false,
      error: `LLM agent "${agent.name}" has no prompt defined.`,
    };
  }

  try {
    // Run the transformation through the circuit breaker
    const result = await circuitBreakers.llm.execute(async () => {
      const response = await provider.transformDiagram({
        spec,
        prompt: agent.prompt!,
        context: agent.description,
        maxRetries: 2,
      });

      // If the LLM call succeeded but transformation failed, don't count as circuit failure
      // Only network/API errors should trip the circuit
      if (!response.success && response.error?.includes("API")) {
        throw new Error(response.error);
      }

      return response;
    });

    if (result.success && result.spec) {
      // Log usage for debugging
      if (result.usage) {
        console.error(
          `[llm] ${agent.name}: ${result.usage.inputTokens} input, ${result.usage.outputTokens} output tokens (${result.usage.model})`
        );
      }

      return {
        success: true,
        spec: result.spec,
        changes: result.changes,
      };
    }

    return {
      success: false,
      error: result.error || "LLM transformation failed",
    };
  } catch (err) {
    if (err instanceof CircuitBreakerError) {
      return {
        success: false,
        error: `LLM service temporarily unavailable. Please retry in ${err.retryAfter} seconds.`,
      };
    }
    return {
      success: false,
      error: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Apply dagre layout to diagram
function applyDagreLayout(
  spec: DiagramSpec,
  direction: "TB" | "LR" | "BT" | "RL" = "TB"
): DiagramSpec {
  const g = new dagre.graphlib.Graph();

  // Set graph options
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  });

  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes
  spec.nodes.forEach((node) => {
    g.setNode(node.id, {
      label: node.label,
      width: node.width || 150,
      height: node.height || 80,
    });
  });

  // Add edges
  spec.edges.forEach((edge) => {
    g.setEdge(edge.from, edge.to);
  });

  // Run layout algorithm
  dagre.layout(g);

  // Extract positions
  const newNodes: DiagramNode[] = spec.nodes.map((node) => {
    const layoutNode = g.node(node.id);
    return {
      ...node,
      position: {
        x: Math.round(layoutNode.x - (node.width || 150) / 2),
        y: Math.round(layoutNode.y - (node.height || 80) / 2),
      },
    };
  });

  return {
    ...spec,
    nodes: newNodes,
  };
}

// Snap node positions to grid
function snapToGrid(spec: DiagramSpec, gridSize: number): DiagramSpec {
  const newNodes: DiagramNode[] = spec.nodes.map((node) => {
    if (!node.position) return node;

    return {
      ...node,
      position: {
        x: Math.round(node.position.x / gridSize) * gridSize,
        y: Math.round(node.position.y / gridSize) * gridSize,
      },
    };
  });

  return {
    ...spec,
    nodes: newNodes,
  };
}

// Export utilities for testing
export { applyDagreLayout, snapToGrid };
