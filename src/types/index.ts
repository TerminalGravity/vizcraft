/**
 * Vizcraft Type Definitions
 */

export interface DiagramNode {
  id: string;
  label: string;
  type?: "box" | "diamond" | "circle" | "database" | "cloud" | "cylinder";
  color?: string;
  position?: { x: number; y: number };
  details?: string;
  width?: number;
  height?: number;
}

export interface DiagramEdge {
  id?: string;
  from: string;
  to: string;
  label?: string;
  style?: "solid" | "dashed" | "dotted";
  color?: string;
}

export interface DiagramGroup {
  id: string;
  label: string;
  nodeIds: string[];
  color?: string;
}

export interface DiagramSpec {
  type: "flowchart" | "architecture" | "sequence" | "freeform";
  theme?: "dark" | "light" | "professional";
  title?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups?: DiagramGroup[];
}

export interface Diagram {
  id: string;
  name: string;
  project: string;
  spec: DiagramSpec;
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiagramVersion {
  id: string;
  diagramId: string;
  version: number;
  spec: DiagramSpec;
  message?: string;
  createdAt: string;
}

export interface DiagramChange {
  action: "add_node" | "remove_node" | "update_node" | "add_edge" | "remove_edge" | "update_edge" | "update_style";
  payload: Record<string, unknown>;
}

export interface CreateDiagramInput {
  name: string;
  project?: string;
  spec: DiagramSpec;
}

export interface CreateDiagramResult {
  id: string;
  url: string;
  thumbnail?: string;
}

export interface UpdateDiagramInput {
  id: string;
  changes?: DiagramChange[];
  spec?: DiagramSpec;
}

export interface DiagramDescription {
  id: string;
  name: string;
  project: string;
  summary: string;
  nodeCount: number;
  edgeCount: number;
  nodes: Array<{ id: string; label: string; type?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

export interface ExportInput {
  id: string;
  format: "png" | "svg" | "pdf" | "json";
  path?: string;
}

export interface ExportResult {
  path: string;
  format: string;
  size: number;
}

export interface ListDiagramsInput {
  project?: string;
}

// Agent types
export interface AgentConfig {
  name: string;
  description?: string;
  type: "rule-based" | "preset" | "llm";
  triggers?: string[];
  actions?: string[];
  styles?: Record<string, string>;
  provider?: "anthropic" | "openai" | "ollama";
  prompt?: string;
}

export interface AgentRun {
  id: string;
  diagramId: string;
  agentName: string;
  inputVersion: number;
  outputVersion: number;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
}
