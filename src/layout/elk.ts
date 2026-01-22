/**
 * ELK Layout Engine
 * Advanced layout algorithms using ELK.js
 *
 * Note: ELK.js has compatibility issues with Bun's worker implementation.
 * For now, we'll fall back to dagre for ELK algorithms until Bun worker
 * support improves. This is a known limitation.
 */

import dagre from "@dagrejs/dagre";
import type {
  LayoutOptions,
  LayoutResult,
  LayoutGraph,
  LayoutDirection,
} from "./types";
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_SPACING,
  DEFAULT_PADDING,
} from "./types";
import { createLogger } from "../logging";

const log = createLogger("layout");

// Map our direction to ELK direction
function mapDirection(dir?: LayoutDirection): string {
  switch (dir) {
    case "DOWN": return "DOWN";
    case "RIGHT": return "RIGHT";
    case "UP": return "UP";
    case "LEFT": return "LEFT";
    default: return "DOWN";
  }
}

// Map our algorithm to ELK algorithm ID
function mapAlgorithm(algo: string): string {
  switch (algo) {
    case "elk-layered": return "layered";
    case "elk-force": return "force";
    case "elk-radial": return "radial";
    case "elk-mrtree": return "mrtree";
    default: return "layered";
  }
}

/**
 * ELK-style layout using dagre as backend
 *
 * Since ELK.js requires Web Workers which aren't compatible with Bun,
 * we implement ELK-like algorithms using dagre with different configurations
 * to approximate the various ELK layout behaviors.
 */
export async function elkLayout(
  graph: LayoutGraph,
  options: LayoutOptions
): Promise<LayoutResult> {
  const startTime = performance.now();

  try {
    const nodeSpacing = options.spacing?.nodeSpacing ?? DEFAULT_SPACING;
    const layerSpacing = options.spacing?.layerSpacing ?? DEFAULT_SPACING * 1.5;

    // Map direction to dagre rankdir
    const rankdir = mapDirectionToDagre(options.direction);

    // Create dagre graph with algorithm-specific settings
    const g = new dagre.graphlib.Graph();

    // Configure based on algorithm type
    const graphConfig = getGraphConfig(options.algorithm, nodeSpacing, layerSpacing, rankdir);
    g.setGraph(graphConfig);
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes
    for (const node of graph.nodes) {
      g.setNode(node.id, {
        width: node.width || DEFAULT_NODE_WIDTH,
        height: node.height || DEFAULT_NODE_HEIGHT,
        label: node.label || node.id,
      });
    }

    // Add edges
    for (const edge of graph.edges) {
      g.setEdge(edge.source, edge.target);
    }

    // Run layout
    dagre.layout(g);

    // Extract positions and apply algorithm-specific post-processing
    const positions: Record<string, { x: number; y: number }> = {};
    for (const nodeId of g.nodes()) {
      const node = g.node(nodeId);
      if (node) {
        positions[nodeId] = {
          x: node.x,
          y: node.y,
        };
      }
    }

    // Apply post-processing for specific algorithms
    const processedPositions = postProcessLayout(positions, graph, options);

    const duration = performance.now() - startTime;
    log.info("ELK-style layout completed", {
      algorithm: options.algorithm,
      backend: "dagre",
      durationMs: duration.toFixed(2),
    });

    return {
      success: true,
      positions: processedPositions,
      duration,
    };
  } catch (err) {
    log.error("ELK-style layout failed", { error: err instanceof Error ? err.message : String(err) });
    return {
      success: false,
      positions: {},
      error: err instanceof Error ? err.message : "Layout failed",
      duration: performance.now() - startTime,
    };
  }
}

/**
 * Map our direction to dagre rankdir
 */
function mapDirectionToDagre(dir?: LayoutDirection): "TB" | "BT" | "LR" | "RL" {
  switch (dir) {
    case "DOWN": return "TB";
    case "UP": return "BT";
    case "RIGHT": return "LR";
    case "LEFT": return "RL";
    default: return "TB";
  }
}

/**
 * Get dagre graph configuration based on algorithm type
 */
function getGraphConfig(
  algorithm: string,
  nodeSpacing: number,
  layerSpacing: number,
  rankdir: "TB" | "BT" | "LR" | "RL"
): dagre.GraphLabel {
  switch (algorithm) {
    case "elk-layered":
      return {
        rankdir,
        nodesep: nodeSpacing,
        ranksep: layerSpacing,
        edgesep: nodeSpacing / 2,
        ranker: "network-simplex", // Best for layered layouts
      };

    case "elk-force":
      return {
        rankdir,
        nodesep: nodeSpacing * 1.5, // More spacing for organic feel
        ranksep: layerSpacing * 1.2,
        edgesep: nodeSpacing,
        ranker: "tight-tree", // Creates more compact, organic structures
      };

    case "elk-radial":
      return {
        rankdir: "TB", // Radial starts from center
        nodesep: nodeSpacing * 2,
        ranksep: layerSpacing * 1.5,
        edgesep: nodeSpacing,
        ranker: "longest-path", // Creates distinct layers for radial
      };

    case "elk-mrtree":
      return {
        rankdir,
        nodesep: nodeSpacing,
        ranksep: layerSpacing * 1.3, // More vertical spacing for tree
        edgesep: nodeSpacing / 3,
        ranker: "tight-tree", // Best for tree structures
      };

    default:
      return {
        rankdir,
        nodesep: nodeSpacing,
        ranksep: layerSpacing,
      };
  }
}

/**
 * Post-process layout positions for specific algorithms
 */
function postProcessLayout(
  positions: Record<string, { x: number; y: number }>,
  graph: LayoutGraph,
  options: LayoutOptions
): Record<string, { x: number; y: number }> {
  if (options.algorithm === "elk-radial") {
    return convertToRadialLayout(positions, graph);
  }

  if (options.algorithm === "elk-force") {
    return addJitter(positions, 5); // Add slight randomness for organic feel
  }

  return positions;
}

/**
 * Convert hierarchical layout to radial layout
 */
function convertToRadialLayout(
  positions: Record<string, { x: number; y: number }>,
  graph: LayoutGraph
): Record<string, { x: number; y: number }> {
  const nodeIds = Object.keys(positions);
  if (nodeIds.length === 0) return positions;

  // Find center and layers
  const yValues = nodeIds.map(id => positions[id]?.y ?? 0);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const yRange = maxY - minY || 1;

  // Calculate center
  const centerX = nodeIds.reduce((sum, id) => sum + (positions[id]?.x ?? 0), 0) / nodeIds.length;
  const centerY = nodeIds.reduce((sum, id) => sum + (positions[id]?.y ?? 0), 0) / nodeIds.length;

  // Convert to radial
  const radialPositions: Record<string, { x: number; y: number }> = {};
  const baseRadius = 150;

  // Group nodes by their Y layer
  const layers: Map<number, string[]> = new Map();
  for (const id of nodeIds) {
    const posY = positions[id]?.y ?? 0;
    const layerIndex = Math.round(((posY - minY) / yRange) * 10);
    if (!layers.has(layerIndex)) {
      layers.set(layerIndex, []);
    }
    layers.get(layerIndex)!.push(id);
  }

  // Position nodes in concentric circles
  const sortedLayers = Array.from(layers.keys()).sort((a, b) => a - b);

  for (let layerIdx = 0; layerIdx < sortedLayers.length; layerIdx++) {
    const layer = sortedLayers[layerIdx];
    if (layer === undefined) continue;
    const nodesInLayer = layers.get(layer)!;
    const radius = baseRadius + (layerIdx * 100);

    for (let i = 0; i < nodesInLayer.length; i++) {
      const nodeId = nodesInLayer[i];
      if (!nodeId) continue;
      const angle = (2 * Math.PI * i) / nodesInLayer.length - Math.PI / 2;
      radialPositions[nodeId] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    }
  }

  return radialPositions;
}

/**
 * Add slight randomness to positions for organic feel
 */
function addJitter(
  positions: Record<string, { x: number; y: number }>,
  amount: number
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};

  for (const [id, pos] of Object.entries(positions)) {
    result[id] = {
      x: pos.x + (Math.random() - 0.5) * amount * 2,
      y: pos.y + (Math.random() - 0.5) * amount * 2,
    };
  }

  return result;
}
