/**
 * Diagram Type Definitions and Templates
 *
 * Provides metadata and starter templates for each diagram type.
 */

import type { DiagramSpec, DiagramType, NodeShape } from "../types";

export interface DiagramTypeInfo {
  id: DiagramType;
  name: string;
  description: string;
  icon: string;
  nodeShapes: NodeShape[];
  edgeStyles: ("solid" | "dashed" | "dotted")[];
  supportsGroups: boolean;
  defaultLayout: string;
  features: string[];
}

/**
 * Metadata for each diagram type
 */
export const DIAGRAM_TYPES: Record<DiagramType, DiagramTypeInfo> = {
  flowchart: {
    id: "flowchart",
    name: "Flowchart",
    description: "Process flows, workflows, and decision trees",
    icon: "📊",
    nodeShapes: ["box", "diamond", "circle", "cylinder"],
    edgeStyles: ["solid", "dashed"],
    supportsGroups: true,
    defaultLayout: "dagre",
    features: ["decision branches", "loops", "parallel paths"],
  },
  architecture: {
    id: "architecture",
    name: "Architecture Diagram",
    description: "System architecture, microservices, and infrastructure",
    icon: "🏗️",
    nodeShapes: ["box", "database", "cloud", "cylinder", "server", "router"],
    edgeStyles: ["solid", "dashed", "dotted"],
    supportsGroups: true,
    defaultLayout: "elk-layered",
    features: ["layers", "components", "data flow", "external services"],
  },
  sequence: {
    id: "sequence",
    name: "Sequence Diagram",
    description: "Interactions between objects over time",
    icon: "📨",
    nodeShapes: ["actor", "lifeline", "activation"],
    edgeStyles: ["solid", "dashed"],
    supportsGroups: true, // swimlanes
    defaultLayout: "dagre", // with direction=RIGHT
    features: ["messages", "lifelines", "activation boxes", "return values"],
  },
  er: {
    id: "er",
    name: "Entity-Relationship",
    description: "Database schema and entity relationships",
    icon: "📋",
    nodeShapes: ["entity", "attribute", "relationship", "weak-entity"],
    edgeStyles: ["solid"],
    supportsGroups: false,
    defaultLayout: "elk-layered",
    features: ["cardinality", "attributes", "keys", "relationships"],
  },
  state: {
    id: "state",
    name: "State Machine",
    description: "State transitions and finite automata",
    icon: "🔄",
    nodeShapes: ["state", "initial", "final", "choice", "fork", "join"],
    edgeStyles: ["solid"],
    supportsGroups: true, // composite states
    defaultLayout: "dagre",
    features: ["transitions", "guards", "actions", "composite states"],
  },
  class: {
    id: "class",
    name: "Class Diagram",
    description: "UML class diagrams for OOP design",
    icon: "📦",
    nodeShapes: ["class", "interface", "abstract", "enum"],
    edgeStyles: ["solid", "dashed"],
    supportsGroups: true, // packages
    defaultLayout: "elk-layered",
    features: ["inheritance", "composition", "associations", "methods"],
  },
  mindmap: {
    id: "mindmap",
    name: "Mind Map",
    description: "Brainstorming and idea organization",
    icon: "🧠",
    nodeShapes: ["central", "branch", "topic"],
    edgeStyles: ["solid"],
    supportsGroups: false,
    defaultLayout: "elk-radial",
    features: ["central topic", "branches", "sub-topics", "colors"],
  },
  network: {
    id: "network",
    name: "Network Diagram",
    description: "Network topology and infrastructure",
    icon: "🌐",
    nodeShapes: ["server", "router", "switch", "firewall", "client", "cloud", "internet"],
    edgeStyles: ["solid", "dashed"],
    supportsGroups: true, // subnets
    defaultLayout: "elk-layered",
    features: ["devices", "connections", "subnets", "protocols"],
  },
  freeform: {
    id: "freeform",
    name: "Freeform",
    description: "Custom diagrams with any shapes",
    icon: "✏️",
    nodeShapes: ["box", "diamond", "circle", "database", "cloud", "cylinder"],
    edgeStyles: ["solid", "dashed", "dotted"],
    supportsGroups: true,
    defaultLayout: "grid",
    features: ["any shape", "custom colors", "flexible layout"],
  },
};

/**
 * Get info for a diagram type
 */
export function getDiagramTypeInfo(type: DiagramType): DiagramTypeInfo {
  return DIAGRAM_TYPES[type] || DIAGRAM_TYPES.freeform;
}

/**
 * List all diagram types
 */
export function listDiagramTypes(): DiagramTypeInfo[] {
  return Object.values(DIAGRAM_TYPES);
}

/**
 * Starter templates for each diagram type
 */
export const DIAGRAM_TEMPLATES: Record<DiagramType, DiagramSpec> = {
  flowchart: {
    type: "flowchart",
    title: "New Flowchart",
    nodes: [
      { id: "start", label: "Start", type: "circle" },
      { id: "process1", label: "Process", type: "box" },
      { id: "decision", label: "Decision?", type: "diamond" },
      { id: "process2", label: "Process 2", type: "box" },
      { id: "end", label: "End", type: "circle" },
    ],
    edges: [
      { from: "start", to: "process1" },
      { from: "process1", to: "decision" },
      { from: "decision", to: "process2", label: "Yes" },
      { from: "decision", to: "end", label: "No" },
      { from: "process2", to: "end" },
    ],
  },
  architecture: {
    type: "architecture",
    title: "New Architecture",
    nodes: [
      { id: "client", label: "Client", type: "client" },
      { id: "lb", label: "Load Balancer", type: "router" },
      { id: "api1", label: "API Server 1", type: "server" },
      { id: "api2", label: "API Server 2", type: "server" },
      { id: "db", label: "Database", type: "database" },
      { id: "cache", label: "Cache", type: "cylinder" },
    ],
    edges: [
      { from: "client", to: "lb" },
      { from: "lb", to: "api1" },
      { from: "lb", to: "api2" },
      { from: "api1", to: "db" },
      { from: "api2", to: "db" },
      { from: "api1", to: "cache", style: "dashed" },
      { from: "api2", to: "cache", style: "dashed" },
    ],
    groups: [
      { id: "backend", label: "Backend", nodeIds: ["api1", "api2"], color: "#3b82f6" },
      { id: "data", label: "Data Layer", nodeIds: ["db", "cache"], color: "#10b981" },
    ],
  },
  sequence: {
    type: "sequence",
    title: "New Sequence Diagram",
    nodes: [
      { id: "user", label: "User", type: "actor" },
      { id: "frontend", label: "Frontend", type: "lifeline" },
      { id: "api", label: "API", type: "lifeline" },
      { id: "db", label: "Database", type: "lifeline" },
    ],
    edges: [],
    messages: [
      { from: "user", to: "frontend", label: "Click button", type: "sync", order: 1 },
      { from: "frontend", to: "api", label: "POST /data", type: "sync", order: 2 },
      { from: "api", to: "db", label: "INSERT", type: "sync", order: 3 },
      { from: "db", to: "api", label: "OK", type: "return", order: 4 },
      { from: "api", to: "frontend", label: "201 Created", type: "return", order: 5 },
      { from: "frontend", to: "user", label: "Show success", type: "return", order: 6 },
    ],
  },
  er: {
    type: "er",
    title: "New ER Diagram",
    nodes: [
      { id: "user", label: "User", type: "entity", attributes: ["id PK", "name", "email"] },
      { id: "post", label: "Post", type: "entity", attributes: ["id PK", "title", "content", "created_at"] },
      { id: "comment", label: "Comment", type: "entity", attributes: ["id PK", "text", "created_at"] },
    ],
    edges: [],
    relationships: [
      { entity1: "user", entity2: "post", label: "writes", cardinality: "1:N" },
      { entity1: "user", entity2: "comment", label: "makes", cardinality: "1:N" },
      { entity1: "post", entity2: "comment", label: "has", cardinality: "1:N" },
    ],
  },
  state: {
    type: "state",
    title: "New State Machine",
    nodes: [
      { id: "initial", label: "", type: "initial" },
      { id: "idle", label: "Idle", type: "state" },
      { id: "loading", label: "Loading", type: "state" },
      { id: "success", label: "Success", type: "state" },
      { id: "error", label: "Error", type: "state" },
      { id: "final", label: "", type: "final" },
    ],
    edges: [
      { from: "initial", to: "idle" },
      { from: "idle", to: "loading", label: "fetch" },
      { from: "loading", to: "success", label: "success" },
      { from: "loading", to: "error", label: "error" },
      { from: "success", to: "idle", label: "reset" },
      { from: "error", to: "idle", label: "retry" },
      { from: "success", to: "final", label: "done" },
    ],
  },
  class: {
    type: "class",
    title: "New Class Diagram",
    nodes: [
      {
        id: "animal",
        label: "Animal",
        type: "abstract",
        stereotype: "abstract",
        attributes: ["- name: string", "- age: int"],
        methods: ["+ eat(): void", "+ sleep(): void"],
      },
      {
        id: "dog",
        label: "Dog",
        type: "class",
        attributes: ["- breed: string"],
        methods: ["+ bark(): void", "+ fetch(): void"],
      },
      {
        id: "cat",
        label: "Cat",
        type: "class",
        attributes: ["- indoor: boolean"],
        methods: ["+ meow(): void", "+ climb(): void"],
      },
    ],
    edges: [
      { from: "dog", to: "animal", label: "extends", style: "dashed" },
      { from: "cat", to: "animal", label: "extends", style: "dashed" },
    ],
  },
  mindmap: {
    type: "mindmap",
    title: "New Mind Map",
    nodes: [
      { id: "central", label: "Main Topic", type: "central" },
      { id: "branch1", label: "Branch 1", type: "branch", color: "#3b82f6" },
      { id: "branch2", label: "Branch 2", type: "branch", color: "#10b981" },
      { id: "branch3", label: "Branch 3", type: "branch", color: "#f59e0b" },
      { id: "topic1a", label: "Topic 1A", type: "topic" },
      { id: "topic1b", label: "Topic 1B", type: "topic" },
      { id: "topic2a", label: "Topic 2A", type: "topic" },
      { id: "topic3a", label: "Topic 3A", type: "topic" },
    ],
    edges: [
      { from: "central", to: "branch1" },
      { from: "central", to: "branch2" },
      { from: "central", to: "branch3" },
      { from: "branch1", to: "topic1a" },
      { from: "branch1", to: "topic1b" },
      { from: "branch2", to: "topic2a" },
      { from: "branch3", to: "topic3a" },
    ],
  },
  network: {
    type: "network",
    title: "New Network Diagram",
    nodes: [
      { id: "internet", label: "Internet", type: "internet" },
      { id: "firewall", label: "Firewall", type: "firewall" },
      { id: "router", label: "Core Router", type: "router" },
      { id: "switch1", label: "Switch 1", type: "switch" },
      { id: "switch2", label: "Switch 2", type: "switch" },
      { id: "server1", label: "Web Server", type: "server" },
      { id: "server2", label: "DB Server", type: "server" },
      { id: "client1", label: "Workstation 1", type: "client" },
      { id: "client2", label: "Workstation 2", type: "client" },
    ],
    edges: [
      { from: "internet", to: "firewall" },
      { from: "firewall", to: "router" },
      { from: "router", to: "switch1" },
      { from: "router", to: "switch2" },
      { from: "switch1", to: "server1" },
      { from: "switch1", to: "server2" },
      { from: "switch2", to: "client1" },
      { from: "switch2", to: "client2" },
    ],
    groups: [
      { id: "dmz", label: "DMZ", nodeIds: ["server1", "server2"], color: "#ef4444" },
      { id: "lan", label: "LAN", nodeIds: ["client1", "client2"], color: "#3b82f6" },
    ],
  },
  freeform: {
    type: "freeform",
    title: "New Diagram",
    nodes: [{ id: "node1", label: "Node 1", type: "box" }],
    edges: [],
  },
};

/**
 * Get a starter template for a diagram type
 */
export function getDiagramTemplate(type: DiagramType): DiagramSpec {
  return JSON.parse(JSON.stringify(DIAGRAM_TEMPLATES[type] || DIAGRAM_TEMPLATES.freeform));
}
