/**
 * Simple Layout Algorithms
 * Grid and circular layouts that don't require external libraries
 */

import type { LayoutOptions, LayoutResult, LayoutGraph } from "./types";
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_SPACING,
  DEFAULT_PADDING,
  safePositiveNumber,
} from "./types";
import { createLogger } from "../logging";

const log = createLogger("layout");

/**
 * Grid Layout
 * Arranges nodes in a grid pattern
 */
export function gridLayout(
  graph: LayoutGraph,
  options: LayoutOptions
): LayoutResult {
  const startTime = performance.now();

  try {
    // Validate numeric inputs to prevent NaN/Infinity propagation
    const nodeSpacing = safePositiveNumber(options.spacing?.nodeSpacing, DEFAULT_SPACING);
    const padding = safePositiveNumber(options.padding, DEFAULT_PADDING);

    const numNodes = graph.nodes.length;
    // Handle edge case: empty graph or single node
    const cols = numNodes > 0 ? Math.ceil(Math.sqrt(numNodes)) : 1;

    const positions: Record<string, { x: number; y: number }> = {};

    graph.nodes.forEach((node, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);

      // Validate node dimensions
      const width = safePositiveNumber(node.width, DEFAULT_NODE_WIDTH);
      const height = safePositiveNumber(node.height, DEFAULT_NODE_HEIGHT);

      positions[node.id] = {
        x: padding + col * (width + nodeSpacing),
        y: padding + row * (height + nodeSpacing),
      };
    });

    const duration = performance.now() - startTime;
    log.info("Grid layout completed", { durationMs: duration.toFixed(2) });

    return {
      success: true,
      positions,
      duration,
    };
  } catch (err) {
    return {
      success: false,
      positions: {},
      error: err instanceof Error ? err.message : "Grid layout failed",
      duration: performance.now() - startTime,
    };
  }
}

/**
 * Circular Layout
 * Arranges nodes in a circle
 */
export function circularLayout(
  graph: LayoutGraph,
  options: LayoutOptions
): LayoutResult {
  const startTime = performance.now();

  try {
    // Validate numeric inputs
    const padding = safePositiveNumber(options.padding, DEFAULT_PADDING);
    const numNodes = graph.nodes.length;

    if (numNodes === 0) {
      return { success: true, positions: {}, duration: 0 };
    }

    // Calculate radius based on number of nodes
    const avgNodeSize = (DEFAULT_NODE_WIDTH + DEFAULT_NODE_HEIGHT) / 2;
    const minRadius = avgNodeSize * 2;
    const radius = Math.max(minRadius, (numNodes * avgNodeSize) / (2 * Math.PI));

    const centerX = padding + radius + DEFAULT_NODE_WIDTH / 2;
    const centerY = padding + radius + DEFAULT_NODE_HEIGHT / 2;

    const positions: Record<string, { x: number; y: number }> = {};

    graph.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / numNodes - Math.PI / 2; // Start from top

      positions[node.id] = {
        x: centerX + radius * Math.cos(angle) - DEFAULT_NODE_WIDTH / 2,
        y: centerY + radius * Math.sin(angle) - DEFAULT_NODE_HEIGHT / 2,
      };
    });

    const duration = performance.now() - startTime;
    log.info("Circular layout completed", { durationMs: duration.toFixed(2) });

    return {
      success: true,
      positions,
      duration,
    };
  } catch (err) {
    return {
      success: false,
      positions: {},
      error: err instanceof Error ? err.message : "Circular layout failed",
      duration: performance.now() - startTime,
    };
  }
}
