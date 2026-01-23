/**
 * Agent Runner
 * Executes agents on diagrams and returns transformed specs
 */

import dagre from "@dagrejs/dagre";
import type { DiagramSpec, DiagramNode } from "../types";
import type { LoadedAgent } from "./loader";
import { getProvider, listConfiguredProviders } from "../llm";
import { circuitBreakers, CircuitBreakerError } from "../utils/circuit-breaker";
import { createLogger } from "../logging";

const log = createLogger("agents");

// ==================== Error Classification ====================

/**
 * Error categories for actionable guidance
 */
type ErrorCategory =
  | "authentication"
  | "rate_limit"
  | "network"
  | "timeout"
  | "invalid_response"
  | "configuration"
  | "unknown";

/**
 * Classify an error to provide targeted guidance
 */
function classifyError(error: Error | unknown): ErrorCategory {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // Authentication errors
  if (
    message.includes("401") ||
    message.includes("unauthorized") ||
    message.includes("invalid api key") ||
    message.includes("authentication") ||
    message.includes("invalid_api_key")
  ) {
    return "authentication";
  }

  // Rate limiting
  if (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("quota") ||
    message.includes("overloaded")
  ) {
    return "rate_limit";
  }

  // Network errors
  if (
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    message.includes("dns") ||
    message.includes("connection refused") ||
    message.includes("fetch failed")
  ) {
    return "network";
  }

  // Timeout errors
  if (message.includes("timeout") || message.includes("timed out") || message.includes("etimedout")) {
    return "timeout";
  }

  // Invalid response from LLM
  if (
    message.includes("invalid") ||
    message.includes("parse") ||
    message.includes("schema") ||
    message.includes("validation")
  ) {
    return "invalid_response";
  }

  // Configuration errors
  if (
    message.includes("not configured") ||
    message.includes("missing") ||
    message.includes("undefined")
  ) {
    return "configuration";
  }

  return "unknown";
}

/**
 * Build an actionable error message with context and suggestions
 */
function buildActionableError(
  operation: string,
  category: ErrorCategory,
  originalError?: string
): string {
  const parts: string[] = [];

  // What happened
  parts.push(`${operation} failed.`);

  // Why it might have happened + How to fix
  switch (category) {
    case "authentication":
      parts.push("Cause: Invalid or expired API key.");
      parts.push("Fix: Check that your API key is correct and has not been revoked.");
      parts.push("  - Anthropic: Verify ANTHROPIC_API_KEY in your environment");
      parts.push("  - OpenAI: Verify OPENAI_API_KEY in your environment");
      break;

    case "rate_limit":
      parts.push("Cause: API rate limit exceeded or service overloaded.");
      parts.push("Fix: Wait a moment and try again, or reduce request frequency.");
      parts.push("  - Check your API plan limits at the provider dashboard");
      parts.push("  - Consider using a different provider temporarily");
      break;

    case "network":
      parts.push("Cause: Network connectivity issue.");
      parts.push("Fix: Check your internet connection and firewall settings.");
      parts.push("  - Verify the API endpoint is reachable");
      parts.push("  - For Ollama: Ensure the server is running (ollama serve)");
      break;

    case "timeout":
      parts.push("Cause: Request took too long to complete.");
      parts.push("Fix: Try a simpler transformation or check service status.");
      parts.push("  - Complex diagrams may need multiple smaller changes");
      parts.push("  - Check provider status page for outages");
      break;

    case "invalid_response":
      parts.push("Cause: LLM returned malformed output.");
      parts.push("Fix: Try rephrasing your request or use a different model.");
      parts.push("  - Simpler prompts often produce better structured output");
      parts.push("  - This may indicate a temporary model issue");
      break;

    case "configuration":
      parts.push("Cause: Missing or invalid configuration.");
      parts.push("Fix: Check agent YAML and environment variables.");
      break;

    case "unknown":
    default:
      parts.push("Cause: Unexpected error occurred.");
      if (originalError) {
        parts.push(`Details: ${originalError}`);
      }
      parts.push("Fix: Check logs for more details or try again.");
      break;
  }

  return parts.join("\n");
}

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
    const category = classifyError(err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error("Agent execution failed", {
      agent: agent.name,
      type: agent.type,
      category,
      error: errorMessage,
    });
    return {
      success: false,
      error: buildActionableError(
        `Agent "${agent.name}" (${agent.type})`,
        category,
        errorMessage
      ),
    };
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
        log.warn("Unknown action", { action });
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
    const configuredProviders = listConfiguredProviders();
    const providerList =
      configuredProviders.length > 0
        ? configuredProviders.map((p) => `${p.name} (${p.type})`).join(", ")
        : "none";

    return {
      success: false,
      error: [
        `LLM agent "${agent.name}" requires a provider but none is available.`,
        `Requested provider: ${agent.provider || "default (anthropic)"}`,
        `Available providers: ${providerList}`,
        "",
        "To fix this, set one of these environment variables:",
        "  - ANTHROPIC_API_KEY for Claude models",
        "  - OPENAI_API_KEY for GPT models",
        "  - OLLAMA_HOST (default: localhost:11434) for local Ollama models",
      ].join("\n"),
    };
  }

  if (!provider.isConfigured) {
    // Determine the expected environment variable for this provider type
    // Cast to string in fallback for future extensibility
    const envVar =
      provider.type === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : provider.type === "openai"
          ? "OPENAI_API_KEY"
          : provider.type === "ollama"
            ? "OLLAMA_HOST"
            : `${String(provider.type).toUpperCase()}_API_KEY`;

    return {
      success: false,
      error: [
        `${provider.name} provider is not properly configured.`,
        "",
        "Possible causes:",
        `  - ${envVar} environment variable is not set`,
        `  - ${envVar} contains an invalid or expired key`,
        provider.type === "ollama"
          ? "  - Ollama server is not running (start with: ollama serve)"
          : "",
        "",
        "To fix this:",
        provider.type === "ollama"
          ? `  1. Start Ollama: ollama serve`
          : `  1. Get an API key from the ${provider.name} dashboard`,
        `  2. Set the environment variable: export ${envVar}=your-key`,
        "  3. Restart the application",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (!agent.prompt) {
    return {
      success: false,
      error: [
        `LLM agent "${agent.name}" has no prompt defined.`,
        "",
        "LLM agents require a 'prompt' field in their YAML configuration.",
        "Example:",
        "  type: llm",
        "  prompt: 'Add helpful annotations explaining each component'",
        "",
        "Check the agent file at: data/agents/${agent.name}.yaml",
      ].join("\n"),
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
        log.info("LLM transform completed", {
          agent: agent.name,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          model: result.usage.model,
        });
      }

      return {
        success: true,
        spec: result.spec,
        changes: result.changes,
      };
    }

    // Provider returned an error response (not exception) - still classify it
    const category = classifyError(new Error(result.error || "LLM transformation failed"));
    log.error("LLM transformation returned error", {
      agent: agent.name,
      provider: provider.name,
      category,
      error: result.error,
    });

    return {
      success: false,
      error: buildActionableError(
        `LLM transformation via ${provider.name}`,
        category,
        result.error
      ),
    };
  } catch (err) {
    if (err instanceof CircuitBreakerError) {
      return {
        success: false,
        error: [
          "LLM service temporarily unavailable (circuit breaker open).",
          "",
          "The service has experienced multiple failures and is being protected.",
          `Please retry in ${err.retryAfter} seconds.`,
          "",
          "If this persists:",
          "  - Check the provider's status page for outages",
          "  - Verify your API key is valid",
          "  - Try using a different provider",
        ].join("\n"),
      };
    }

    const category = classifyError(err);
    const errorMessage = err instanceof Error ? err.message : String(err);

    log.error("LLM call failed", {
      agent: agent.name,
      provider: provider.name,
      category,
      error: errorMessage,
    });

    return {
      success: false,
      error: buildActionableError(
        `LLM transformation via ${provider.name}`,
        category,
        errorMessage
      ),
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
