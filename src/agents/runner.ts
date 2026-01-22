/**
 * Agent Runner
 * Executes agents on diagrams and returns transformed specs
 */

import dagre from "@dagrejs/dagre";
import type { DiagramSpec, DiagramNode } from "../types";
import type { LoadedAgent } from "./loader";

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

// LLM agents (placeholder - requires API integration)
async function runLLMAgent(agent: LoadedAgent, spec: DiagramSpec): Promise<AgentRunResult> {
  // For now, return a message that LLM integration is coming
  return {
    success: false,
    error: `LLM agent "${agent.name}" requires API integration. Configure ANTHROPIC_API_KEY to enable.`,
  };
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
