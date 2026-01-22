/**
 * Collaboration System Types
 *
 * Types for real-time diagram collaboration via WebSockets
 */

import { z } from "zod";

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

export interface DiagramChange {
  action: "add_node" | "remove_node" | "update_node" | "add_edge" | "remove_edge" | "update_edge" | "update_style";
  target?: string; // Node or edge ID
  data?: unknown;
}

// ==================== Zod Validation Schemas ====================
// Runtime validation for WebSocket messages (TypeScript types are compile-time only)

const MAX_NAME_LENGTH = 100;
const MAX_DIAGRAM_ID_LENGTH = 100;
const MAX_NODE_ID_LENGTH = 100;
const MAX_SELECTION_SIZE = 100;
const MAX_CHANGES_PER_MESSAGE = 100;
const COORDINATE_MIN = -1_000_000;
const COORDINATE_MAX = 1_000_000;

/**
 * Diagram change validation
 */
const DiagramChangeSchema = z.object({
  action: z.enum([
    "add_node", "remove_node", "update_node",
    "add_edge", "remove_edge", "update_edge",
    "update_style",
  ]),
  target: z.string().max(MAX_NODE_ID_LENGTH).optional(),
  data: z.unknown().optional(),
});

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
