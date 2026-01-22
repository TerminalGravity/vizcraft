/**
 * Apply Premium Styling to Diagrams
 * Transforms basic specs into beautifully styled visualizations
 */

import type { DiagramSpec, DiagramNode, DiagramEdge } from "../types";
import type { Theme } from "./themes";
import { getTheme, getNodeColor } from "./themes";

/**
 * Apply a theme to a diagram spec
 */
export function applyThemeToDiagram(spec: DiagramSpec, themeId?: string): DiagramSpec {
  const theme = getTheme(themeId || spec.theme || "dark");

  return {
    ...spec,
    theme: theme.id as DiagramSpec["theme"],
    nodes: spec.nodes.map((node) => applyNodeStyling(node, theme)),
    edges: spec.edges.map((edge) => applyEdgeStyling(edge, theme)),
  };
}

/**
 * Apply premium styling to a node
 */
function applyNodeStyling(node: DiagramNode, theme: Theme): DiagramNode {
  // Only apply if not already styled
  if (node.color) return node;

  const color = getNodeColor(theme, node.type);

  return {
    ...node,
    color,
    // Add default dimensions if not set
    width: node.width || 160,
    height: node.height || 80,
  };
}

/**
 * Apply premium styling to an edge
 */
function applyEdgeStyling(edge: DiagramEdge, theme: Theme): DiagramEdge {
  // Only apply if not already styled
  if (edge.color) return edge;

  return {
    ...edge,
    color: theme.colors.edgeStroke,
    style: edge.style || "solid",
  };
}

/**
 * Generate CSS for premium styling effects
 * This CSS can be injected into the web UI for enhanced visuals
 */
export function generateStyledCSS(theme: Theme): string {
  return `
/* Vizcraft Premium Styling - ${theme.name} */
:root {
  --vz-canvas-bg: ${theme.colors.canvas};
  --vz-canvas-gradient-start: ${theme.colors.canvasGradientStart || theme.colors.canvas};
  --vz-canvas-gradient-end: ${theme.colors.canvasGradientEnd || theme.colors.canvas};
  --vz-node-fill: ${theme.colors.nodeFill};
  --vz-node-stroke: ${theme.colors.nodeStroke};
  --vz-node-text: ${theme.colors.nodeText};
  --vz-node-glow: ${theme.colors.nodeGlow || "transparent"};
  --vz-edge-stroke: ${theme.colors.edgeStroke};
  --vz-accent: ${theme.colors.accent};
  --vz-accent-secondary: ${theme.colors.accentSecondary};
  --vz-shadow-color: ${theme.colors.shadowColor};
  --vz-shadow-opacity: ${theme.colors.shadowOpacity};
  --vz-font-family: ${theme.typography.fontFamily};
  --vz-font-weight: ${theme.typography.fontWeight};
  --vz-node-radius: ${theme.effects.nodeRadius}px;
  --vz-shadow-blur: ${theme.effects.shadowBlur}px;
  --vz-glow-intensity: ${theme.effects.glowIntensity};
}

/* Canvas Background */
.tl-background {
  background: linear-gradient(
    135deg,
    var(--vz-canvas-gradient-start) 0%,
    var(--vz-canvas-gradient-end) 100%
  ) !important;
}

/* Node Styling */
.tl-shape[data-shape-type="geo"] .tl-frame__body {
  border-radius: var(--vz-node-radius) !important;
  box-shadow:
    0 4px var(--vz-shadow-blur) rgba(0, 0, 0, var(--vz-shadow-opacity)),
    0 0 calc(var(--vz-shadow-blur) * 2) var(--vz-node-glow) !important;
  transition: box-shadow 0.2s ease, transform 0.2s ease !important;
}

.tl-shape[data-shape-type="geo"]:hover .tl-frame__body {
  box-shadow:
    0 8px calc(var(--vz-shadow-blur) * 1.5) rgba(0, 0, 0, calc(var(--vz-shadow-opacity) * 1.2)),
    0 0 calc(var(--vz-shadow-blur) * 3) var(--vz-node-glow) !important;
  transform: translateY(-2px) !important;
}

/* Text Styling */
.tl-shape[data-shape-type="text"] .tl-text-content,
.tl-shape[data-shape-type="geo"] .tl-text-label {
  font-family: var(--vz-font-family) !important;
  font-weight: var(--vz-font-weight) !important;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
}

/* Arrow/Edge Styling */
.tl-shape[data-shape-type="arrow"] path {
  stroke-linecap: round !important;
  stroke-linejoin: round !important;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2)) !important;
}

/* Selection Styling */
.tl-selection__fg {
  stroke: var(--vz-accent) !important;
  stroke-width: 2px !important;
}

/* Grid Pattern (subtle) */
.tl-grid {
  opacity: 0.3 !important;
}

/* Smooth animations */
.tl-shape {
  transition: opacity 0.15s ease !important;
}

/* Premium scrollbar */
.tl-container::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.tl-container::-webkit-scrollbar-track {
  background: var(--vz-canvas-bg);
}

.tl-container::-webkit-scrollbar-thumb {
  background: var(--vz-node-stroke);
  border-radius: 4px;
}

.tl-container::-webkit-scrollbar-thumb:hover {
  background: var(--vz-accent);
}
`;
}

/**
 * Generate inline styles for a node (for non-CSS environments)
 */
export function getNodeInlineStyles(theme: Theme, nodeType?: string): Record<string, string> {
  const color = getNodeColor(theme, nodeType);

  return {
    fill: theme.colors.nodeFill,
    stroke: color,
    "stroke-width": "2",
    rx: String(theme.effects.nodeRadius),
    ry: String(theme.effects.nodeRadius),
    filter: `drop-shadow(0 4px ${theme.effects.shadowBlur}px ${theme.colors.shadowColor})`,
  };
}

/**
 * Generate inline styles for an edge
 */
export function getEdgeInlineStyles(theme: Theme): Record<string, string> {
  return {
    stroke: theme.colors.edgeStroke,
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    fill: "none",
  };
}
