/**
 * Collaboration System Types
 *
 * Types for real-time diagram collaboration via WebSockets
 */

import { z } from "zod";
import {
  DiagramNodeSchema,
  DiagramEdgeSchema,
  LIMITS,
} from "../validation/schemas";

export interface Participant {
  id: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number };
  selection?: string[]; // Selected node IDs
  lastSeen: number;
  /** Authenticated user ID (null if anonymous) */
  userId?: string | null;
}

export interface Room {
  id: string; // Diagram ID
  participants: Map<string, Participant>;
  version: number; // Current spec version for conflict detection
  createdAt: number;
}

// Client → Server Messages
export type ClientMessage =
  | { type: "join"; diagramId: string; name: string }
  | { type: "leave" }
  | { type: "cursor"; x: number; y: number }
  | { type: "selection"; nodeIds: string[] }
  | { type: "change"; changes: DiagramChange[]; baseVersion: number }
  | { type: "ping" };

// Server → Client Messages
export type ServerMessage =
  | { type: "joined"; participant: Participant; room: RoomState }
  | { type: "participant_joined"; participant: Participant }
  | { type: "participant_left"; participantId: string }
  | { type: "cursor_update"; participantId: string; x: number; y: number }
  | { type: "selection_update"; participantId: string; nodeIds: string[] }
  | { type: "changes"; changes: DiagramChange[]; author: string; version: number }
  | { type: "sync"; spec: unknown; version: number }
  | { type: "conflict"; message: string; currentVersion: number }
  | { type: "error"; message: string; code: string }
  | { type: "pong" };

export interface RoomState {
  diagramId: string;
  participants: Participant[];
  version: number;
}

/**
 * Diagram change with validated data
 * Action determines the shape of data:
 * - add_node: DiagramNode (full node)
 * - update_node: Partial<DiagramNode> (at least one field)
 * - remove_node: undefined
 * - add_edge: DiagramEdge (full edge)
 * - update_edge: Partial<DiagramEdge> (at least one field)
 * - remove_edge: undefined
 * - update_style: StyleUpdateData
 */
export type DiagramChange = z.infer<typeof DiagramChangeSchema>;

/**
 * Style update data shape (exported for consumers)
 */
export type StyleUpdateData = z.infer<typeof StyleUpdateDataSchema>;

// ==================== Zod Validation Schemas ====================
// Runtime validation for WebSocket messages (TypeScript types are compile-time only)

const MAX_NAME_LENGTH = 100;
const MAX_DIAGRAM_ID_LENGTH = 100;
const MAX_NODE_ID_LENGTH = 100;
const MAX_SELECTION_SIZE = 100;
const MAX_CHANGES_PER_MESSAGE = 100;
const COORDINATE_MIN = -1_000_000;
const COORDINATE_MAX = 1_000_000;

// ==================== Action-Specific Change Schemas ====================
// Each action type has specific data requirements validated at runtime

/**
 * Add node - requires full node data
 */
const AddNodeChangeSchema = z.object({
  action: z.literal("add_node"),
  target: z.string().max(MAX_NODE_ID_LENGTH).optional(),
  data: DiagramNodeSchema,
});

/**
 * Remove node - only needs target ID, data optional
 */
const RemoveNodeChangeSchema = z.object({
  action: z.literal("remove_node"),
  target: z.string().min(1).max(MAX_NODE_ID_LENGTH),
  data: z.undefined().optional(),
});

/**
 * Update node - requires partial node data (at least one field)
 */
const UpdateNodeChangeSchema = z.object({
  action: z.literal("update_node"),
  target: z.string().min(1).max(MAX_NODE_ID_LENGTH),
  data: DiagramNodeSchema.partial().refine(
    (data) => Object.keys(data).length > 0,
    { message: "Update data must contain at least one field" }
  ),
});

/**
 * Add edge - requires full edge data
 */
const AddEdgeChangeSchema = z.object({
  action: z.literal("add_edge"),
  target: z.string().max(MAX_NODE_ID_LENGTH).optional(),
  data: DiagramEdgeSchema,
});

/**
 * Remove edge - only needs target ID
 */
const RemoveEdgeChangeSchema = z.object({
  action: z.literal("remove_edge"),
  target: z.string().min(1).max(MAX_NODE_ID_LENGTH),
  data: z.undefined().optional(),
});

/**
 * Update edge - requires partial edge data
 */
const UpdateEdgeChangeSchema = z.object({
  action: z.literal("update_edge"),
  target: z.string().min(1).max(MAX_NODE_ID_LENGTH),
  data: DiagramEdgeSchema.partial().refine(
    (data) => Object.keys(data).length > 0,
    { message: "Update data must contain at least one field" }
  ),
});

/**
 * Update style - applies style changes to entire diagram
 * Theme must be valid, colors must be valid hex or CSS names
 */
const StyleUpdateDataSchema = z.object({
  theme: z.enum(["dark", "light", "professional"]).optional(),
  nodeColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$/).max(50).optional(),
  edgeColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$/).max(50).optional(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$/).max(50).optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "Style update must contain at least one field" }
);

const UpdateStyleChangeSchema = z.object({
  action: z.literal("update_style"),
  target: z.undefined().optional(),
  data: StyleUpdateDataSchema,
});

/**
 * Discriminated union of all valid diagram changes
 * Validates data field based on action type
 */
export const DiagramChangeSchema = z.discriminatedUnion("action", [
  AddNodeChangeSchema,
  RemoveNodeChangeSchema,
  UpdateNodeChangeSchema,
  AddEdgeChangeSchema,
  RemoveEdgeChangeSchema,
  UpdateEdgeChangeSchema,
  UpdateStyleChangeSchema,
]);

/**
 * Validate a single diagram change
 * Returns validation result with error details
 */
export function validateDiagramChange(change: unknown): {
  valid: boolean;
  error?: string;
  data?: DiagramChange;
} {
  const result = DiagramChangeSchema.safeParse(change);

  if (result.success) {
    return { valid: true, data: result.data };
  }

  const errors = result.error.issues.map(issue => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });

  return { valid: false, error: errors.join("; ") };
}

/**
 * Maximum nodes/edges that can be added in a single change batch
 * This provides early rejection before the expensive database quota check
 */
const MAX_BATCH_ADDS = {
  NODES: 100, // Max nodes added per batch
  EDGES: 500, // Max edges added per batch
};

/**
 * Validate an array of diagram changes
 * Returns validation result with index of first invalid change
 *
 * Also validates batch limits to prevent quota bypass attacks:
 * - Rejects batches adding more than MAX_BATCH_ADDS nodes/edges
 * - Full quota validation happens on database persistence
 */
export function validateDiagramChanges(changes: unknown[]): {
  valid: boolean;
  error?: string;
  invalidIndex?: number;
  data?: DiagramChange[];
} {
  const validatedChanges: DiagramChange[] = [];

  // Count adds for quota-aware validation
  let nodesAdded = 0;
  let edgesAdded = 0;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const result = validateDiagramChange(change);

    if (!result.valid) {
      return {
        valid: false,
        error: `Change ${i}: ${result.error}`,
        invalidIndex: i,
      };
    }

    const validated = result.data!;
    validatedChanges.push(validated);

    // Track adds for quota enforcement
    if (validated.action === "add_node") {
      nodesAdded++;
      if (nodesAdded > MAX_BATCH_ADDS.NODES) {
        return {
          valid: false,
          error: `Batch exceeds maximum node additions (${MAX_BATCH_ADDS.NODES})`,
          invalidIndex: i,
        };
      }
    } else if (validated.action === "add_edge") {
      edgesAdded++;
      if (edgesAdded > MAX_BATCH_ADDS.EDGES) {
        return {
          valid: false,
          error: `Batch exceeds maximum edge additions (${MAX_BATCH_ADDS.EDGES})`,
          invalidIndex: i,
        };
      }
    }
  }

  return { valid: true, data: validatedChanges };
}

/**
 * Join message schema
 */
const JoinMessageSchema = z.object({
  type: z.literal("join"),
  diagramId: z.string().min(1).max(MAX_DIAGRAM_ID_LENGTH),
  name: z.string().max(MAX_NAME_LENGTH).default("Anonymous"),
});

/**
 * Leave message schema
 */
const LeaveMessageSchema = z.object({
  type: z.literal("leave"),
});

/**
 * Cursor update message schema
 */
const CursorMessageSchema = z.object({
  type: z.literal("cursor"),
  x: z.number().min(COORDINATE_MIN).max(COORDINATE_MAX),
  y: z.number().min(COORDINATE_MIN).max(COORDINATE_MAX),
});

/**
 * Selection update message schema
 */
const SelectionMessageSchema = z.object({
  type: z.literal("selection"),
  nodeIds: z.array(z.string().max(MAX_NODE_ID_LENGTH)).max(MAX_SELECTION_SIZE),
});

/**
 * Change message schema
 */
const ChangeMessageSchema = z.object({
  type: z.literal("change"),
  changes: z.array(DiagramChangeSchema).max(MAX_CHANGES_PER_MESSAGE),
  baseVersion: z.number().int().min(0),
});

/**
 * Ping message schema
 */
const PingMessageSchema = z.object({
  type: z.literal("ping"),
});

/**
 * Combined client message schema (discriminated union)
 */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  JoinMessageSchema,
  LeaveMessageSchema,
  CursorMessageSchema,
  SelectionMessageSchema,
  ChangeMessageSchema,
  PingMessageSchema,
]);

/**
 * Result of validating a client message
 */
export type ClientMessageValidationResult =
  | { success: true; message: ClientMessage }
  | { success: false; error: string };

/**
 * Validate a raw message and return typed result
 */
export function validateClientMessage(raw: unknown): ClientMessageValidationResult {
  const result = ClientMessageSchema.safeParse(raw);

  if (result.success) {
    return { success: true, message: result.data as ClientMessage };
  }

  // Format error message
  const errors = result.error.issues.map(issue => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });

  return { success: false, error: errors.join("; ") };
}

// Collaboration settings
export const COLLAB_CONFIG = {
  // Presence timeout - consider participant inactive after this
  PRESENCE_TIMEOUT_MS: 30_000,

  // Connection stale timeout - force-close connections with no activity
  // Should be longer than PRESENCE_TIMEOUT to give clients time to reconnect
  CONNECTION_STALE_TIMEOUT_MS: 90_000, // 90 seconds (3x presence timeout)

  // Ping interval to keep connection alive
  PING_INTERVAL_MS: 15_000,

  // Maximum participants per room
  MAX_PARTICIPANTS: 50,

  // Cursor update throttle
  CURSOR_THROTTLE_MS: 50,

  // Rate limiting
  RATE_LIMIT: {
    // Maximum messages per window
    MAX_MESSAGES: 20,
    // Window size in milliseconds
    WINDOW_MS: 1000,
    // Warnings before disconnect
    MAX_WARNINGS: 3,
    // Maximum message size in bytes (1MB)
    MAX_MESSAGE_SIZE: 1024 * 1024,
    // Maximum changes per message (prevents massive payloads)
    MAX_CHANGES_PER_MESSAGE: 100,
  },

  // Color palette for participants
  PARTICIPANT_COLORS: [
    "#3b82f6", // blue
    "#10b981", // green
    "#f59e0b", // amber
    "#ef4444", // red
    "#8b5cf6", // violet
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#f97316", // orange
  ],
};
