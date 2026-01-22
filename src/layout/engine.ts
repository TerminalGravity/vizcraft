/**
 * Layout Engine
 * Unified interface for all layout algorithms
 */

import dagre from "@dagrejs/dagre";
import type { DiagramSpec } from "../types";
import type {
  LayoutAlgorithm,
  LayoutOptions,
  LayoutResult,
  LayoutGraph,
} from "./types";
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_SPACING,
} from "./types";
import { elkLayout } from "./elk";
import { gridLayout, circularLayout } from "./simple";

// Available layout algorithms with descriptions
export const LAYOUT_ALGORITHMS: Record<LayoutAlgorithm, { name: string; description: string }> = {
  dagre: {
    name: "Hierarchical (Dagre)",
    description: "Classic hierarchical layout, great for flowcharts",
  },
  "elk-layered": {
    name: "Layered (ELK)",
    description: "Advanced hierarchical with crossing minimization",
  },
  "elk-force": {
    name: "Force-Directed",
    description: "Physics-based organic layout",
  },
  "elk-radial": {
    name: "Radial",
    description: "Circular layers from center",
  },
  "elk-mrtree": {
    name: "Tree",
    description: "Minimum spanning tree layout",
  },
  grid: {
    name: "Grid",
    description: "Simple grid arrangement",
  },
  circular: {
    name: "Circular",
    description: "Nodes arranged in a circle",
  },
};

/**
 * Convert DiagramSpec to LayoutGraph
 */
function specToGraph(spec: DiagramSpec): LayoutGraph {
  return {
    nodes: spec.nodes.map((node) => ({
      id: node.id,
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
      label: node.label,
    })),
    edges: spec.edges.map((edge, i) => ({
      id: `edge-${i}`,
      source: edge.from,
      target: edge.to,
    })),
  };
}

/**
 * Apply layout positions to DiagramSpec
 */
function applyPositions(
  spec: DiagramSpec,
  positions: Record<string, { x: number; y: number }>
): DiagramSpec {
  return {
    ...spec,
    nodes: spec.nodes.map((node) => ({
      ...node,
      position: positions[node.id] || node.position,
    })),
  };
}

/**
 * Dagre layout (original algorithm)
 */
function dagreLayout(graph: LayoutGraph, options: LayoutOptions): LayoutResult {
  const startTime = performance.now();

  try {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: options.direction === "RIGHT" ? "LR" : "TB",
      nodesep: options.spacing?.nodeSpacing ?? DEFAULT_SPACING,
      ranksep: options.spacing?.layerSpacing ?? DEFAULT_SPACING * 1.5,
      marginx: options.padding ?? 50,
      marginy: options.padding ?? 50,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes
    for (const node of graph.nodes) {
      g.setNode(node.id, {
        width: node.width || DEFAULT_NODE_WIDTH,
        height: node.height || DEFAULT_NODE_HEIGHT,
      });
    }

    // Add edges
    for (const edge of graph.edges) {
      g.setEdge(edge.source, edge.target);
    }

    // Run dagre layout
    dagre.layout(g);

    // Extract positions
    const positions: Record<string, { x: number; y: number }> = {};
    for (const nodeId of g.nodes()) {
      const node = g.node(nodeId);
      if (node) {
        positions[nodeId] = {
          x: node.x - (node.width || DEFAULT_NODE_WIDTH) / 2,
          y: node.y - (node.height || DEFAULT_NODE_HEIGHT) / 2,
        };
      }
    }

    const duration = performance.now() - startTime;
    console.log(`[layout] Dagre completed in ${duration.toFixed(2)}ms`);

    return {
      success: true,
      positions,
      duration,
    };
  } catch (err) {
    return {
      success: false,
      positions: {},
      error: err instanceof Error ? err.message : "Dagre layout failed",
      duration: performance.now() - startTime,
    };
  }
}

/**
 * Main layout function
 */
export async function layoutDiagram(
  spec: DiagramSpec,
  options: LayoutOptions
): Promise<{ success: boolean; spec?: DiagramSpec; error?: string; duration?: number }> {
  const graph = specToGraph(spec);

  let result: LayoutResult;

  switch (options.algorithm) {
    case "dagre":
      result = dagreLayout(graph, options);
      break;

    case "elk-layered":
    case "elk-force":
    case "elk-radial":
    case "elk-mrtree":
      result = await elkLayout(graph, options);
      break;

    case "grid":
      result = gridLayout(graph, options);
      break;

    case "circular":
      result = circularLayout(graph, options);
      break;

    default:
      return {
        success: false,
        error: `Unknown layout algorithm: ${options.algorithm}`,
      };
  }

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      duration: result.duration,
    };
  }

  const layoutedSpec = applyPositions(spec, result.positions);

  return {
    success: true,
    spec: layoutedSpec,
    duration: result.duration,
  };
}

/**
 * List available layout algorithms
 */
export function listLayoutAlgorithms(): Array<{
  id: LayoutAlgorithm;
  name: string;
  description: string;
}> {
  return Object.entries(LAYOUT_ALGORITHMS).map(([id, info]) => ({
    id: id as LayoutAlgorithm,
    ...info,
  }));
}
