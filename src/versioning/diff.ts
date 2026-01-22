/**
 * Diagram Version Diff Utilities
 *
 * Provides semantic diffing for diagram specs, showing meaningful changes
 * like added/removed/modified nodes and edges rather than raw JSON diffs.
 */

import type { DiagramSpec, DiagramNode, DiagramEdge } from "../types";

export interface NodeChange {
  type: "added" | "removed" | "modified";
  nodeId: string;
  before?: DiagramNode;
  after?: DiagramNode;
  changes?: string[];
}

export interface EdgeChange {
  type: "added" | "removed" | "modified";
  edgeKey: string; // "from->to"
  before?: DiagramEdge;
  after?: DiagramEdge;
  changes?: string[];
}

export interface GroupChange {
  type: "added" | "removed" | "modified";
  groupId: string;
  changes?: string[];
}

export interface SpecChange {
  type: "modified";
  field: "type" | "theme";
  before: string | undefined;
  after: string | undefined;
}

export interface DiagramDiff {
  hasChanges: boolean;
  summary: string;
  nodeChanges: NodeChange[];
  edgeChanges: EdgeChange[];
  groupChanges: GroupChange[];
  specChanges: SpecChange[];
  stats: {
    nodesAdded: number;
    nodesRemoved: number;
    nodesModified: number;
    edgesAdded: number;
    edgesRemoved: number;
    edgesModified: number;
    groupsAdded: number;
    groupsRemoved: number;
    groupsModified: number;
  };
}

/**
 * Calculate diff between two diagram specs
 */
export function diffSpecs(before: DiagramSpec, after: DiagramSpec): DiagramDiff {
  const nodeChanges = diffNodes(before.nodes || [], after.nodes || []);
  const edgeChanges = diffEdges(before.edges || [], after.edges || []);
  const groupChanges = diffGroups(before.groups || [], after.groups || []);
  const specChanges = diffSpecMeta(before, after);

  const stats = {
    nodesAdded: nodeChanges.filter((c) => c.type === "added").length,
    nodesRemoved: nodeChanges.filter((c) => c.type === "removed").length,
    nodesModified: nodeChanges.filter((c) => c.type === "modified").length,
    edgesAdded: edgeChanges.filter((c) => c.type === "added").length,
    edgesRemoved: edgeChanges.filter((c) => c.type === "removed").length,
    edgesModified: edgeChanges.filter((c) => c.type === "modified").length,
    groupsAdded: groupChanges.filter((c) => c.type === "added").length,
    groupsRemoved: groupChanges.filter((c) => c.type === "removed").length,
    groupsModified: groupChanges.filter((c) => c.type === "modified").length,
  };

  const hasChanges =
    nodeChanges.length > 0 ||
    edgeChanges.length > 0 ||
    groupChanges.length > 0 ||
    specChanges.length > 0;

  const summary = generateSummary(stats, specChanges);

  return {
    hasChanges,
    summary,
    nodeChanges,
    edgeChanges,
    groupChanges,
    specChanges,
    stats,
  };
}

function diffNodes(before: DiagramNode[], after: DiagramNode[]): NodeChange[] {
  const changes: NodeChange[] = [];
  const beforeMap = new Map(before.map((n) => [n.id, n]));
  const afterMap = new Map(after.map((n) => [n.id, n]));

  // Find removed and modified nodes
  for (const [id, beforeNode] of beforeMap) {
    const afterNode = afterMap.get(id);
    if (!afterNode) {
      changes.push({ type: "removed", nodeId: id, before: beforeNode });
    } else {
      const nodeChanges = diffNode(beforeNode, afterNode);
      if (nodeChanges.length > 0) {
        changes.push({
          type: "modified",
          nodeId: id,
          before: beforeNode,
          after: afterNode,
          changes: nodeChanges,
        });
      }
    }
  }

  // Find added nodes
  for (const [id, afterNode] of afterMap) {
    if (!beforeMap.has(id)) {
      changes.push({ type: "added", nodeId: id, after: afterNode });
    }
  }

  return changes;
}

function diffNode(before: DiagramNode, after: DiagramNode): string[] {
  const changes: string[] = [];

  if (before.label !== after.label) {
    changes.push(`label: "${before.label}" → "${after.label}"`);
  }
  if (before.type !== after.type) {
    changes.push(`type: ${before.type} → ${after.type}`);
  }
  if (before.color !== after.color) {
    changes.push(`color: ${before.color} → ${after.color}`);
  }
  if (before.details !== after.details) {
    changes.push(`details changed`);
  }
  if (JSON.stringify(before.position) !== JSON.stringify(after.position)) {
    changes.push(`position moved`);
  }
  if (before.width !== after.width || before.height !== after.height) {
    changes.push(`size changed`);
  }

  return changes;
}

function diffEdges(before: DiagramEdge[], after: DiagramEdge[]): EdgeChange[] {
  const changes: EdgeChange[] = [];

  const makeKey = (e: DiagramEdge) => `${e.from}->${e.to}`;
  const beforeMap = new Map(before.map((e) => [makeKey(e), e]));
  const afterMap = new Map(after.map((e) => [makeKey(e), e]));

  // Find removed and modified edges
  for (const [key, beforeEdge] of beforeMap) {
    const afterEdge = afterMap.get(key);
    if (!afterEdge) {
      changes.push({ type: "removed", edgeKey: key, before: beforeEdge });
    } else {
      const edgeChanges = diffEdge(beforeEdge, afterEdge);
      if (edgeChanges.length > 0) {
        changes.push({
          type: "modified",
          edgeKey: key,
          before: beforeEdge,
          after: afterEdge,
          changes: edgeChanges,
        });
      }
    }
  }

  // Find added edges
  for (const [key, afterEdge] of afterMap) {
    if (!beforeMap.has(key)) {
      changes.push({ type: "added", edgeKey: key, after: afterEdge });
    }
  }

  return changes;
}

function diffEdge(before: DiagramEdge, after: DiagramEdge): string[] {
  const changes: string[] = [];

  if (before.label !== after.label) {
    changes.push(`label: "${before.label}" → "${after.label}"`);
  }
  if (before.style !== after.style) {
    changes.push(`style: ${before.style} → ${after.style}`);
  }
  if (before.color !== after.color) {
    changes.push(`color: ${before.color} → ${after.color}`);
  }

  return changes;
}

function diffGroups(
  before: Array<{ id: string; label: string; nodeIds: string[]; color?: string }>,
  after: Array<{ id: string; label: string; nodeIds: string[]; color?: string }>
): GroupChange[] {
  const changes: GroupChange[] = [];
  const beforeMap = new Map(before.map((g) => [g.id, g]));
  const afterMap = new Map(after.map((g) => [g.id, g]));

  for (const [id, beforeGroup] of beforeMap) {
    const afterGroup = afterMap.get(id);
    if (!afterGroup) {
      changes.push({ type: "removed", groupId: id });
    } else {
      const groupChanges: string[] = [];
      if (beforeGroup.label !== afterGroup.label) {
        groupChanges.push(`label changed`);
      }
      if (JSON.stringify(beforeGroup.nodeIds.sort()) !== JSON.stringify(afterGroup.nodeIds.sort())) {
        groupChanges.push(`members changed`);
      }
      if (beforeGroup.color !== afterGroup.color) {
        groupChanges.push(`color changed`);
      }
      if (groupChanges.length > 0) {
        changes.push({ type: "modified", groupId: id, changes: groupChanges });
      }
    }
  }

  for (const [id] of afterMap) {
    if (!beforeMap.has(id)) {
      changes.push({ type: "added", groupId: id });
    }
  }

  return changes;
}

function diffSpecMeta(before: DiagramSpec, after: DiagramSpec): SpecChange[] {
  const changes: SpecChange[] = [];

  if (before.type !== after.type) {
    changes.push({ type: "modified", field: "type", before: before.type, after: after.type });
  }
  if (before.theme !== after.theme) {
    changes.push({ type: "modified", field: "theme", before: before.theme, after: after.theme });
  }

  return changes;
}

function generateSummary(
  stats: DiagramDiff["stats"],
  specChanges: SpecChange[]
): string {
  const parts: string[] = [];

  if (stats.nodesAdded > 0) parts.push(`+${stats.nodesAdded} node(s)`);
  if (stats.nodesRemoved > 0) parts.push(`-${stats.nodesRemoved} node(s)`);
  if (stats.nodesModified > 0) parts.push(`~${stats.nodesModified} node(s)`);

  if (stats.edgesAdded > 0) parts.push(`+${stats.edgesAdded} edge(s)`);
  if (stats.edgesRemoved > 0) parts.push(`-${stats.edgesRemoved} edge(s)`);
  if (stats.edgesModified > 0) parts.push(`~${stats.edgesModified} edge(s)`);

  if (stats.groupsAdded > 0) parts.push(`+${stats.groupsAdded} group(s)`);
  if (stats.groupsRemoved > 0) parts.push(`-${stats.groupsRemoved} group(s)`);
  if (stats.groupsModified > 0) parts.push(`~${stats.groupsModified} group(s)`);

  for (const change of specChanges) {
    parts.push(`${change.field}: ${change.before} → ${change.after}`);
  }

  return parts.length > 0 ? parts.join(", ") : "No changes";
}

/**
 * Generate a human-readable changelog from diff
 */
export function generateChangelog(diff: DiagramDiff): string {
  if (!diff.hasChanges) {
    return "No changes";
  }

  const lines: string[] = [];

  // Spec changes
  for (const change of diff.specChanges) {
    lines.push(`• Changed ${change.field} from "${change.before}" to "${change.after}"`);
  }

  // Node changes
  for (const change of diff.nodeChanges) {
    if (change.type === "added") {
      lines.push(`• Added node "${change.after?.label || change.nodeId}"`);
    } else if (change.type === "removed") {
      lines.push(`• Removed node "${change.before?.label || change.nodeId}"`);
    } else {
      lines.push(`• Modified node "${change.before?.label || change.nodeId}": ${change.changes?.join(", ")}`);
    }
  }

  // Edge changes
  for (const change of diff.edgeChanges) {
    if (change.type === "added") {
      lines.push(`• Added connection ${change.edgeKey}`);
    } else if (change.type === "removed") {
      lines.push(`• Removed connection ${change.edgeKey}`);
    } else {
      lines.push(`• Modified connection ${change.edgeKey}: ${change.changes?.join(", ")}`);
    }
  }

  // Group changes
  for (const change of diff.groupChanges) {
    if (change.type === "added") {
      lines.push(`• Added group "${change.groupId}"`);
    } else if (change.type === "removed") {
      lines.push(`• Removed group "${change.groupId}"`);
    } else {
      lines.push(`• Modified group "${change.groupId}": ${change.changes?.join(", ")}`);
    }
  }

  return lines.join("\n");
}
