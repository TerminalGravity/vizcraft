/**
 * Vizcraft Type Definitions
 */

// Node shapes for different diagram types
export type NodeShape =
  // General shapes
  | "box" | "diamond" | "circle" | "database" | "cloud" | "cylinder"
  // Sequence diagram shapes
  | "actor" | "lifeline" | "activation"
  // ER diagram shapes
  | "entity" | "attribute" | "relationship" | "weak-entity"
  // State machine shapes
  | "state" | "initial" | "final" | "choice" | "fork" | "join"
  // Class diagram shapes
  | "class" | "interface" | "abstract" | "enum"
  // Mind map shapes
  | "central" | "branch" | "topic"
  // Network shapes
  | "server" | "router" | "switch" | "firewall" | "client" | "internet";

export interface DiagramNode {
  id: string;
  label: string;
  type?: NodeShape;
  color?: string;
  position?: { x: number; y: number };
  details?: string;
  width?: number;
  height?: number;
  // Extended properties for specific diagram types
  stereotype?: string; // UML stereotype <<>>
  attributes?: string[]; // For class/entity diagrams
  methods?: string[]; // For class diagrams
  swimlane?: string; // For sequence diagrams
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

// Sequence diagram message
export interface SequenceMessage {
  id?: string;
  from: string;
  to: string;
  label: string;
  type: "sync" | "async" | "return" | "create" | "destroy";
  order: number;
}

// ER diagram relationship with cardinality
export interface ERRelationship {
  id?: string;
  entity1: string;
  entity2: string;
  label?: string;
  cardinality: "1:1" | "1:N" | "N:1" | "N:M";
  participation1?: "total" | "partial";
  participation2?: "total" | "partial";
}

// Supported diagram types
export type DiagramType =
  | "flowchart"
  | "architecture"
  | "sequence"
  | "er"
  | "state"
  | "class"
  | "mindmap"
  | "network"
  | "freeform";

export interface DiagramSpec {
  type: DiagramType;
  theme?: "dark" | "light" | "professional";
  title?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups?: DiagramGroup[];
  // Sequence diagram specific
  messages?: SequenceMessage[];
  // ER diagram specific
  relationships?: ERRelationship[];
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
