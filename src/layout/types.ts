/**
 * Layout Types
 * Configuration and output types for diagram layout algorithms
 */

export type LayoutAlgorithm =
  | "dagre"           // Hierarchical top-down
  | "elk-layered"     // ELK layered algorithm (hierarchical)
  | "elk-force"       // ELK force-directed
  | "elk-radial"      // ELK radial/circular
  | "elk-mrtree"      // ELK minimum spanning tree
  | "grid"            // Simple grid layout
  | "circular";       // Circular arrangement

export type LayoutDirection = "DOWN" | "RIGHT" | "UP" | "LEFT";

export interface LayoutOptions {
  algorithm: LayoutAlgorithm;
  direction?: LayoutDirection;
  spacing?: {
    nodeSpacing?: number;
    edgeSpacing?: number;
    layerSpacing?: number;
  };
  padding?: number;
  animate?: boolean;
  preserveGroups?: boolean;
}

export interface LayoutResult {
  success: boolean;
  positions: Record<string, { x: number; y: number }>;
  error?: string;
  duration?: number;
}

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  label?: string;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface LayoutGraph {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

// Default dimensions
export const DEFAULT_NODE_WIDTH = 150;
export const DEFAULT_NODE_HEIGHT = 80;
export const DEFAULT_SPACING = 50;
export const DEFAULT_PADDING = 50;
