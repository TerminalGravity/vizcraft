/**
 * Mermaid Export
 *
 * Converts Vizcraft diagrams to Mermaid format for compatibility
 * with documentation tools, GitHub, and other platforms.
 */

import type { DiagramSpec, DiagramNode, DiagramType } from "../types";

/**
 * Export a diagram to Mermaid format
 */
export function exportToMermaid(spec: DiagramSpec): string {
  switch (spec.type) {
    case "flowchart":
      return exportFlowchart(spec);
    case "sequence":
      return exportSequence(spec);
    case "state":
      return exportStateDiagram(spec);
    case "class":
      return exportClassDiagram(spec);
    case "er":
      return exportERDiagram(spec);
    case "mindmap":
      return exportMindmap(spec);
    default:
      // Default to flowchart for architecture, network, freeform
      return exportFlowchart(spec);
  }
}

function exportFlowchart(spec: DiagramSpec): string {
  const lines: string[] = ["flowchart TD"];
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];

  // Add nodes with shapes
  for (const node of nodes) {
    const shape = getMermaidShape(node);
    lines.push(`    ${sanitizeId(node.id)}${shape}`);
  }

  // Add edges
  for (const edge of edges) {
    const from = sanitizeId(edge.from);
    const to = sanitizeId(edge.to);
    const arrow = edge.style === "dashed" ? "-.->" : "-->";
    const label = edge.label ? `|${sanitizeLabel(edge.label)}|` : "";
    lines.push(`    ${from} ${arrow}${label} ${to}`);
  }

  // Add subgraphs for groups
  if (spec.groups?.length) {
    for (const group of spec.groups) {
      lines.push(`    subgraph ${sanitizeId(group.id)}[${sanitizeLabel(group.label)}]`);
      for (const nodeId of group.nodeIds) {
        lines.push(`        ${sanitizeId(nodeId)}`);
      }
      lines.push("    end");
    }
  }

  return lines.join("\n");
}

function exportSequence(spec: DiagramSpec): string {
  const lines: string[] = ["sequenceDiagram"];
  const nodes = spec.nodes ?? [];

  // Declare participants
  for (const node of nodes) {
    const type = node.type === "actor" ? "actor" : "participant";
    lines.push(`    ${type} ${sanitizeId(node.id)} as ${sanitizeLabel(node.label)}`);
  }

  // Add messages
  if (spec.messages?.length) {
    const sortedMessages = [...spec.messages].sort((a, b) => a.order - b.order);
    for (const msg of sortedMessages) {
      const from = sanitizeId(msg.from);
      const to = sanitizeId(msg.to);
      let arrow: string;
      switch (msg.type) {
        case "async":
          arrow = "->>";
          break;
        case "return":
          arrow = "-->>";
          break;
        case "create":
          lines.push(`    create participant ${to}`);
          arrow = "->>";
          break;
        case "destroy":
          arrow = "->>";
          lines.push(`    destroy ${to}`);
          continue;
        default:
          arrow = "->>";
      }
      lines.push(`    ${from}${arrow}${to}: ${sanitizeLabel(msg.label)}`);
    }
  }

  return lines.join("\n");
}

function exportStateDiagram(spec: DiagramSpec): string {
  const lines: string[] = ["stateDiagram-v2"];
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];

  // Add states
  for (const node of nodes) {
    if (node.type === "initial") {
      lines.push(`    [*] --> ${sanitizeId(node.id)}`);
    } else if (node.type === "final") {
      // Final states handled in transitions
    } else if (node.type === "choice") {
      lines.push(`    state ${sanitizeId(node.id)} <<choice>>`);
    } else if (node.type === "fork" || node.type === "join") {
      lines.push(`    state ${sanitizeId(node.id)} <<fork>>`);
    } else {
      lines.push(`    ${sanitizeId(node.id)}: ${sanitizeLabel(node.label)}`);
    }
  }

  // Add transitions
  for (const edge of edges) {
    const from = sanitizeId(edge.from);
    const to = sanitizeId(edge.to);
    const toNode = nodes.find((n) => n.id === edge.to);

    if (toNode?.type === "final") {
      const label = edge.label ? `: ${sanitizeLabel(edge.label)}` : "";
      lines.push(`    ${from} --> [*]${label}`);
    } else {
      const label = edge.label ? `: ${sanitizeLabel(edge.label)}` : "";
      lines.push(`    ${from} --> ${to}${label}`);
    }
  }

  return lines.join("\n");
}

function exportClassDiagram(spec: DiagramSpec): string {
  const lines: string[] = ["classDiagram"];
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];

  // Add classes
  for (const node of nodes) {
    if (node.stereotype) {
      lines.push(`    class ${sanitizeId(node.id)} {`);
      lines.push(`        <<${node.stereotype}>>`);
    } else {
      lines.push(`    class ${sanitizeId(node.id)} {`);
    }

    // Add attributes
    if (node.attributes?.length) {
      for (const attr of node.attributes) {
        lines.push(`        ${attr}`);
      }
    }

    // Add methods
    if (node.methods?.length) {
      for (const method of node.methods) {
        lines.push(`        ${method}`);
      }
    }

    lines.push("    }");
  }

  // Add relationships
  for (const edge of edges) {
    const from = sanitizeId(edge.from);
    const to = sanitizeId(edge.to);

    let arrow: string;
    if (edge.label?.includes("extends") || edge.label?.includes("implements")) {
      arrow = edge.style === "dashed" ? "..|>" : "--|>";
    } else if (edge.label?.includes("composition")) {
      arrow = "*--";
    } else if (edge.label?.includes("aggregation")) {
      arrow = "o--";
    } else {
      arrow = "-->";
    }

    const label = edge.label && !["extends", "implements", "composition", "aggregation"].some((k) => edge.label?.includes(k))
      ? `: ${sanitizeLabel(edge.label)}`
      : "";

    lines.push(`    ${from} ${arrow} ${to}${label}`);
  }

  return lines.join("\n");
}

function exportERDiagram(spec: DiagramSpec): string {
  const lines: string[] = ["erDiagram"];
  const nodes = spec.nodes ?? [];

  // Add entities with attributes
  for (const node of nodes) {
    if (node.type === "entity" || node.type === "weak-entity") {
      lines.push(`    ${sanitizeId(node.id)} {`);
      if (node.attributes?.length) {
        for (const attr of node.attributes) {
          // Parse attribute format: "name type PK/FK"
          const parts = attr.split(" ");
          const name = parts[0];
          const type = parts[1] || "string";
          const key = parts[2] || "";
          lines.push(`        ${type} ${name}${key ? " " + key : ""}`);
        }
      }
      lines.push("    }");
    }
  }

  // Add relationships
  if (spec.relationships?.length) {
    for (const rel of spec.relationships) {
      const e1 = sanitizeId(rel.entity1);
      const e2 = sanitizeId(rel.entity2);

      // Convert cardinality to Mermaid format
      let card: string;
      switch (rel.cardinality) {
        case "1:1":
          card = "||--||";
          break;
        case "1:N":
          card = "||--o{";
          break;
        case "N:1":
          card = "}o--||";
          break;
        case "N:M":
          card = "}o--o{";
          break;
        default:
          card = "||--o{";
      }

      const label = rel.label ? ` : ${sanitizeLabel(rel.label)}` : "";
      lines.push(`    ${e1} ${card} ${e2}${label}`);
    }
  }

  return lines.join("\n");
}

function exportMindmap(spec: DiagramSpec): string {
  const lines: string[] = ["mindmap"];
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];

  // Find central node, fall back to first node if none marked as central
  const central = nodes.find((n) => n.type === "central") ?? nodes[0];
  if (central) {
    lines.push(`  root((${sanitizeLabel(central.label)}))`);

    // Build tree from edges
    const edgeMap = new Map<string, string[]>();
    for (const edge of edges) {
      if (!edgeMap.has(edge.from)) {
        edgeMap.set(edge.from, []);
      }
      edgeMap.get(edge.from)!.push(edge.to);
    }

    // Recursively add children
    const addChildren = (nodeId: string, depth: number) => {
      const children = edgeMap.get(nodeId) || [];
      for (const childId of children) {
        const child = nodes.find((n) => n.id === childId);
        if (child) {
          const indent = "  ".repeat(depth + 1);
          lines.push(`${indent}${sanitizeLabel(child.label)}`);
          addChildren(childId, depth + 1);
        }
      }
    };

    addChildren(central.id, 1);
  }

  return lines.join("\n");
}

/**
 * Get Mermaid shape syntax for a node
 */
function getMermaidShape(node: DiagramNode): string {
  const label = sanitizeLabel(node.label);

  switch (node.type) {
    case "diamond":
      return `{${label}}`;
    case "circle":
      return `((${label}))`;
    case "database":
    case "cylinder":
      return `[(${label})]`;
    case "cloud":
      return `>${label}]`;
    case "actor":
      return `{{${label}}}`;
    default:
      return `[${label}]`;
  }
}

/**
 * Sanitize ID for Mermaid (no spaces, special chars)
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Sanitize label for Mermaid to prevent syntax injection
 * Escapes characters that have special meaning in Mermaid syntax:
 * - | (pipe) - edge label delimiters
 * - [ ] { } ( ) < > - node shape delimiters
 * - # - unicode/comments
 * - ; - statement separator
 * - " - string delimiter
 *
 * Uses single-pass replacement to avoid double-escaping of HTML entities.
 */
function sanitizeLabel(label: string): string {
  // Character to HTML entity mapping
  const escapeMap: Record<string, string> = {
    "|": "&#124;",   // pipe
    "[": "&#91;",    // left bracket
    "]": "&#93;",    // right bracket
    "{": "&#123;",   // left brace
    "}": "&#125;",   // right brace
    "<": "&lt;",     // less than
    ">": "&gt;",     // greater than
    "#": "&#35;",    // hash
    ";": "&#59;",    // semicolon
    "\"": "&quot;",  // double quote
  };

  // Single-pass replacement using regex with callback
  // This prevents double-escaping of characters within generated HTML entities
  return label.replace(/[|[\]{}><#;"]/g, (char) => escapeMap[char] ?? char);
}

/**
 * Supported export formats
 */
export function getSupportedExportFormats(): { id: string; name: string; extension: string }[] {
  return [
    { id: "mermaid", name: "Mermaid", extension: ".mmd" },
    { id: "json", name: "JSON", extension: ".json" },
    { id: "svg", name: "SVG", extension: ".svg" },
    { id: "png", name: "PNG", extension: ".png" },
  ];
}
