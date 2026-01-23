/**
 * Room Manager
 *
 * Manages collaboration rooms (one per diagram) and participants.
 * Handles presence tracking and room lifecycle.
 */

import { nanoid } from "nanoid";
import type { Room, Participant, RoomState, ServerMessage, DiagramChange } from "./types";
import { COLLAB_CONFIG, validateDiagramChanges } from "./types";
import { createLogger } from "../logging";

const log = createLogger("collab");

// WebSocket connection type with optional user info
type WebSocketConnection = {
  send: (message: string) => void;
  close: (code?: number, reason?: string) => void;
  readyState: number;
  userId?: string | null;
  role?: "admin" | "user" | "viewer" | null;
};

// Rate limit state for a connection
interface RateLimitState {
  messageCount: number;
  windowStart: number;
  warnings: number;
}

// Connection state
interface ConnectionState {
  ws: WebSocketConnection;
  participantId: string;
  diagramId: string | null;
  pingInterval?: ReturnType<typeof setInterval>;
  rateLimit: RateLimitState;
  /** Timestamp of last activity (message received) */
  lastActivity: number;
  /** Authenticated user ID (null if anonymous) */
  userId: string | null;
  /** User role for authorization */
  role: "admin" | "user" | "viewer" | null;
}

/** TTL for empty rooms before cleanup (30 minutes) */
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;

class RoomManager {
  private rooms = new Map<string, Room>();
  private connections = new Map<WebSocketConnection, ConnectionState>();
  /** Reverse index: diagramId → Set of connections in that room (for O(1) broadcast) */
  private roomConnections = new Map<string, Set<WebSocketConnection>>();
  /** Tracks when rooms became empty (diagramId → timestamp) for TTL-based cleanup */
  private emptyRoomTimestamps = new Map<string, number>();
  private colorIndex = 0;

  /**
   * Register a new WebSocket connection
   * Captures userId and role from the WebSocket if authenticated
   */
  registerConnection(ws: WebSocketConnection): void {
    const now = Date.now();
    const userId = ws.userId ?? null;
    const role = ws.role ?? null;

    const state: ConnectionState = {
      ws,
      participantId: nanoid(8),
      diagramId: null,
      rateLimit: {
        messageCount: 0,
        windowStart: now,
        warnings: 0,
      },
      lastActivity: now,
      userId,
      role,
    };
    this.connections.set(ws, state);

    // Set up ping interval with self-cleanup
    // If WebSocket is closed, clear the interval to prevent resource leak
    state.pingInterval = setInterval(() => {
      if (ws.readyState === 1) {
        this.send(ws, { type: "pong" });
      } else {
        // WebSocket is closed but handleDisconnect wasn't called
        // Self-cleanup to prevent resource leak
        if (state.pingInterval) {
          clearInterval(state.pingInterval);
          state.pingInterval = undefined;
        }
      }
    }, COLLAB_CONFIG.PING_INTERVAL_MS);

    const authStatus = userId ? `authenticated as ${userId}` : "anonymous";
    log.debug("Connection registered", { participantId: state.participantId, authStatus });
  }

  /**
   * Handle connection close
   */
  handleDisconnect(ws: WebSocketConnection): void {
    const state = this.connections.get(ws);
    if (!state) return;

    // Clear ping interval
    if (state.pingInterval) {
      clearInterval(state.pingInterval);
    }

    // Leave room if in one
    if (state.diagramId) {
      this.leaveRoom(ws);
    }

    this.connections.delete(ws);
    log.debug("Connection closed", { participantId: state.participantId });
  }

  /**
   * Join a diagram's collaboration room
   */
  joinRoom(ws: WebSocketConnection, diagramId: string, name: string): void {
    const state = this.connections.get(ws);
    if (!state) {
      this.send(ws, { type: "error", message: "Connection not registered", code: "NOT_REGISTERED" });
      return;
    }

    // Leave current room if in one
    if (state.diagramId) {
      this.leaveRoom(ws);
    }

    // Get or create room
    let room = this.rooms.get(diagramId);
    if (!room) {
      room = {
        id: diagramId,
        participants: new Map(),
        version: 0,
        createdAt: Date.now(),
      };
      this.rooms.set(diagramId, room);
      log.debug("Room created", { diagramId });
    }

    // Clear empty room timestamp since someone is joining
    this.emptyRoomTimestamps.delete(diagramId);

    // Check max participants
    if (room.participants.size >= COLLAB_CONFIG.MAX_PARTICIPANTS) {
      this.send(ws, { type: "error", message: "Room is full", code: "ROOM_FULL" });
      return;
    }

    // Create participant with user association
    const participant: Participant = {
      id: state.participantId,
      name: name || `User ${state.participantId.slice(0, 4)}`,
      color: this.getNextColor(),
      lastSeen: Date.now(),
      userId: state.userId,
    };

    // Add to room
    room.participants.set(participant.id, participant);
    state.diagramId = diagramId;

    // Add to room connections index for O(1) broadcast lookup
    let roomConns = this.roomConnections.get(diagramId);
    if (!roomConns) {
      roomConns = new Set();
      this.roomConnections.set(diagramId, roomConns);
    }
    roomConns.add(ws);

    // Notify joiner
    const roomState: RoomState = {
      diagramId,
      participants: Array.from(room.participants.values()),
      version: room.version,
    };
    this.send(ws, { type: "joined", participant, room: roomState });

    // Notify others in room
    this.broadcastToRoom(diagramId, {
      type: "participant_joined",
      participant,
    }, ws);

    log.info("Participant joined room", { name: participant.name, diagramId, participantCount: room.participants.size });
  }

  /**
   * Leave current room
   */
  leaveRoom(ws: WebSocketConnection): void {
    const state = this.connections.get(ws);
    if (!state || !state.diagramId) return;

    const room = this.rooms.get(state.diagramId);
    if (!room) return;

    // Remove participant
    room.participants.delete(state.participantId);

    // Remove from room connections index
    const roomConns = this.roomConnections.get(state.diagramId);
    if (roomConns) {
      roomConns.delete(ws);
      if (roomConns.size === 0) {
        this.roomConnections.delete(state.diagramId);
      }
    }

    // Notify others
    this.broadcastToRoom(state.diagramId, {
      type: "participant_left",
      participantId: state.participantId,
    }, ws);

    log.info("Participant left room", { participantId: state.participantId, diagramId: state.diagramId, remainingParticipants: room.participants.size });

    // Clean up empty rooms
    if (room.participants.size === 0) {
      this.rooms.delete(state.diagramId);
      log.debug("Room closed (empty)", { diagramId: state.diagramId });
    }

    state.diagramId = null;
  }

  /**
   * Update participant cursor
   */
  updateCursor(ws: WebSocketConnection, x: number, y: number): void {
    const state = this.connections.get(ws);
    if (!state || !state.diagramId) return;

    const room = this.rooms.get(state.diagramId);
    if (!room) return;

    const participant = room.participants.get(state.participantId);
    if (!participant) return;

    // Update participant cursor
    participant.cursor = { x, y };
    participant.lastSeen = Date.now();

    // Broadcast to others
    this.broadcastToRoom(state.diagramId, {
      type: "cursor_update",
      participantId: state.participantId,
      x,
      y,
    }, ws);
  }

  /**
   * Update participant selection
   */
  updateSelection(ws: WebSocketConnection, nodeIds: string[]): void {
    const state = this.connections.get(ws);
    if (!state || !state.diagramId) return;

    const room = this.rooms.get(state.diagramId);
    if (!room) return;

    const participant = room.participants.get(state.participantId);
    if (!participant) return;

    // Update participant selection
    participant.selection = nodeIds;
    participant.lastSeen = Date.now();

    // Broadcast to others
    this.broadcastToRoom(state.diagramId, {
      type: "selection_update",
      participantId: state.participantId,
      nodeIds,
    }, ws);
  }

  /**
   * Handle diagram changes from a participant
   *
   * Security: Validates all change data against schemas before broadcasting.
   * This prevents malicious clients from injecting arbitrary payloads.
   */
  handleChanges(ws: WebSocketConnection, changes: unknown[], baseVersion: number): boolean {
    const state = this.connections.get(ws);
    if (!state || !state.diagramId) {
      this.send(ws, { type: "error", message: "Not in a room", code: "NOT_IN_ROOM" });
      return false;
    }

    const room = this.rooms.get(state.diagramId);
    if (!room) return false;

    // SECURITY: Validate all changes before processing
    // This prevents malformed or malicious data from being broadcast
    const validation = validateDiagramChanges(changes);
    if (!validation.valid) {
      this.send(ws, {
        type: "error",
        message: `Invalid change data: ${validation.error}`,
        code: "INVALID_CHANGE_DATA",
      });
      log.warn("Rejected invalid changes", { participantId: state.participantId, error: validation.error });
      return false;
    }

    const validatedChanges = validation.data!;

    // Simple conflict detection: check if base version matches current
    if (baseVersion !== room.version) {
      this.send(ws, {
        type: "conflict",
        message: "Your changes are based on an outdated version",
        currentVersion: room.version,
      });
      return false;
    }

    // Update room version
    room.version++;

    // Broadcast validated changes to all participants (including sender for confirmation)
    this.broadcastToRoom(state.diagramId, {
      type: "changes",
      changes: validatedChanges,
      author: state.participantId,
      version: room.version,
    });

    return true;
  }

  /**
   * Broadcast sync message when diagram is updated externally (e.g., by an agent)
   */
  broadcastSync(diagramId: string, spec: unknown, newVersion?: number): void {
    const room = this.rooms.get(diagramId);
    if (!room) return;

    if (newVersion !== undefined) {
      room.version = newVersion;
    } else {
      room.version++;
    }

    this.broadcastToRoom(diagramId, {
      type: "sync",
      spec,
      version: room.version,
    });

    log.debug("Sync broadcast to room", { diagramId, version: room.version });
  }

  /**
   * Get room statistics
   */
  getStats(): {
    rooms: number;
    connections: number;
    totalParticipants: number;
    staleConnections: number;
    avgConnectionAgeMs: number;
  } {
    let totalParticipants = 0;
    for (const room of this.rooms.values()) {
      totalParticipants += room.participants.size;
    }

    // Calculate connection health metrics
    const now = Date.now();
    let staleConnections = 0;
    let totalAge = 0;

    for (const [ws, state] of this.connections) {
      const age = now - state.lastActivity;
      totalAge += age;

      if (age > COLLAB_CONFIG.CONNECTION_STALE_TIMEOUT_MS || ws.readyState !== 1) {
        staleConnections++;
      }
    }

    const avgAge = this.connections.size > 0
      ? Math.round(totalAge / this.connections.size)
      : 0;

    return {
      rooms: this.rooms.size,
      connections: this.connections.size,
      totalParticipants,
      staleConnections,
      avgConnectionAgeMs: avgAge,
    };
  }

  /**
   * Get room info
   */
  getRoomInfo(diagramId: string): RoomState | null {
    const room = this.rooms.get(diagramId);
    if (!room) return null;

    return {
      diagramId,
      participants: Array.from(room.participants.values()),
      version: room.version,
    };
  }

  /**
   * Clean up inactive participants and stale connections
   *
   * This handles two scenarios:
   * 1. Participants who haven't sent activity within PRESENCE_TIMEOUT_MS
   * 2. Connections that are stale (no activity within CONNECTION_STALE_TIMEOUT_MS)
   *    This catches orphaned connections where handleDisconnect() was never called
   */
  cleanupInactive(): { participants: number; connections: number; rooms: number } {
    let cleanedParticipants = 0;
    let cleanedConnections = 0;
    const now = Date.now();

    // 1. Clean up inactive participants from rooms
    for (const [diagramId, room] of this.rooms) {
      for (const [participantId, participant] of room.participants) {
        if (now - participant.lastSeen > COLLAB_CONFIG.PRESENCE_TIMEOUT_MS) {
          room.participants.delete(participantId);

          this.broadcastToRoom(diagramId, {
            type: "participant_left",
            participantId,
          });

          cleanedParticipants++;
        }
      }

      // Track when room becomes empty for TTL-based cleanup
      if (room.participants.size === 0) {
        if (!this.emptyRoomTimestamps.has(diagramId)) {
          this.emptyRoomTimestamps.set(diagramId, now);
        }
      }
    }

    // 2b. Clean up rooms that have been empty for too long
    let cleanedRooms = 0;
    for (const [diagramId, emptyAt] of this.emptyRoomTimestamps) {
      if (now - emptyAt > EMPTY_ROOM_TTL_MS) {
        // Room has been empty long enough, clean it up
        this.rooms.delete(diagramId);
        this.roomConnections.delete(diagramId);
        this.emptyRoomTimestamps.delete(diagramId);
        cleanedRooms++;
      }
    }

    // 2. Clean up stale connections (where handleDisconnect was never called)
    // This prevents memory leaks from orphaned pingIntervals
    const staleThreshold = COLLAB_CONFIG.CONNECTION_STALE_TIMEOUT_MS;
    const staleConnections: WebSocketConnection[] = [];

    for (const [ws, state] of this.connections) {
      const age = now - state.lastActivity;

      // Check if connection is stale or WebSocket is already closed
      if (age > staleThreshold || ws.readyState !== 1) {
        staleConnections.push(ws);
      }
    }

    // Force-close stale connections (this clears their intervals)
    for (const ws of staleConnections) {
      const state = this.connections.get(ws);
      if (state) {
        log.debug("Cleaning up stale connection", {
          participantId: state.participantId,
          ageMs: now - state.lastActivity,
        });
      }
      this.handleDisconnect(ws);
      cleanedConnections++;
    }

    if (cleanedParticipants > 0 || cleanedConnections > 0 || cleanedRooms > 0) {
      log.info("Cleanup completed", {
        inactiveParticipants: cleanedParticipants,
        staleConnections: cleanedConnections,
        emptyRooms: cleanedRooms,
      });
    }

    return { participants: cleanedParticipants, connections: cleanedConnections, rooms: cleanedRooms };
  }

  /**
   * Update last activity timestamp for a connection (call on each message received)
   */
  updateActivity(ws: WebSocketConnection): void {
    const state = this.connections.get(ws);
    if (state) {
      state.lastActivity = Date.now();
    }
  }

  /**
   * Check rate limit for a connection
   * Returns true if message is allowed, false if rate limited
   */
  checkRateLimit(ws: WebSocketConnection): boolean {
    const state = this.connections.get(ws);
    if (!state) return false;

    const now = Date.now();
    const { RATE_LIMIT } = COLLAB_CONFIG;

    // Reset window if expired
    if (now - state.rateLimit.windowStart > RATE_LIMIT.WINDOW_MS) {
      state.rateLimit.messageCount = 0;
      state.rateLimit.windowStart = now;
    }

    state.rateLimit.messageCount++;

    // Check if over limit
    if (state.rateLimit.messageCount > RATE_LIMIT.MAX_MESSAGES) {
      state.rateLimit.warnings++;

      if (state.rateLimit.warnings >= RATE_LIMIT.MAX_WARNINGS) {
        // Too many warnings, disconnect
        log.warn("Rate limit exceeded, disconnecting", { participantId: state.participantId });
        this.send(ws, {
          type: "error",
          message: "Rate limit exceeded - disconnected",
          code: "RATE_LIMIT_EXCEEDED",
        });
        ws.close();
        return false;
      }

      // Send warning
      this.send(ws, {
        type: "error",
        message: `Rate limit warning (${state.rateLimit.warnings}/${RATE_LIMIT.MAX_WARNINGS})`,
        code: "RATE_LIMIT_WARNING",
      });

      return false;
    }

    return true;
  }

  /**
   * Get rate limit state for a connection (for testing/monitoring)
   */
  getRateLimitState(ws: WebSocketConnection): RateLimitState | null {
    const state = this.connections.get(ws);
    return state ? { ...state.rateLimit } : null;
  }

  /**
   * Get connection info for a WebSocket (for testing/monitoring)
   */
  getConnectionInfo(ws: WebSocketConnection): { participantId: string; userId: string | null; role: string | null; diagramId: string | null } | null {
    const state = this.connections.get(ws);
    if (!state) return null;
    return {
      participantId: state.participantId,
      userId: state.userId,
      role: state.role,
      diagramId: state.diagramId,
    };
  }

  /**
   * Check if a connection can perform write operations (for permission-based filtering)
   * Returns true for admin/user roles, false for viewers
   */
  canWrite(ws: WebSocketConnection): boolean {
    const state = this.connections.get(ws);
    if (!state) return false;
    // Anonymous users and viewers cannot write
    if (!state.userId) return false;
    if (state.role === "viewer") return false;
    return true;
  }

  /**
   * Close all connections gracefully (for shutdown)
   */
  closeAll(reason = "Server shutting down"): number {
    let closed = 0;
    const connections = Array.from(this.connections.keys());

    for (const ws of connections) {
      try {
        // Send shutdown message
        this.send(ws, {
          type: "error",
          message: reason,
          code: "SERVER_SHUTDOWN",
        });

        // Close with normal closure code
        ws.close(1001, reason);
        closed++;
      } catch {
        // Ignore errors during close
      }
    }

    // Clear all state
    this.rooms.clear();
    this.connections.clear();

    log.info("Closed WebSocket connections", { count: closed });
    return closed;
  }

  // Private helpers

  private send(ws: WebSocketConnection, message: ServerMessage): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      log.warn("Failed to send WebSocket message", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private broadcastToRoom(diagramId: string, message: ServerMessage, exclude?: WebSocketConnection): void {
    // Use roomConnections index for O(room_size) instead of O(total_connections)
    const roomConns = this.roomConnections.get(diagramId);
    if (!roomConns || roomConns.size === 0) return;

    let messageStr: string;
    try {
      messageStr = JSON.stringify(message);
    } catch (err) {
      log.warn("Failed to serialize broadcast message", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    for (const ws of roomConns) {
      if (ws !== exclude && ws.readyState === 1) {
        try {
          ws.send(messageStr);
        } catch (err) {
          log.warn("Failed to send broadcast message", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  private getNextColor(): string {
    const colors = COLLAB_CONFIG.PARTICIPANT_COLORS;
    const color = colors[this.colorIndex % colors.length] ?? colors[0] ?? "#808080";
    // Reset colorIndex to prevent integer overflow after many participants
    // (Number.MAX_SAFE_INTEGER would break modulo arithmetic)
    this.colorIndex = (this.colorIndex + 1) % colors.length;
    return color;
  }
}

// Singleton instance
export const roomManager = new RoomManager();

// Cleanup interval management
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the cleanup interval (idempotent)
 */
function startCleanupInterval(): void {
  if (cleanupIntervalId !== null) return;

  cleanupIntervalId = setInterval(() => {
    try {
      roomManager.cleanupInactive();
    } catch (err) {
      // Log error but don't crash - cleanup is best-effort
      log.error("Cleanup failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }, COLLAB_CONFIG.PRESENCE_TIMEOUT_MS / 2);

  // Unref to allow process to exit even if interval is running
  if (typeof cleanupIntervalId === "object" && "unref" in cleanupIntervalId) {
    cleanupIntervalId.unref();
  }

  log.info("Cleanup interval started");
}

/**
 * Stop the cleanup interval (for graceful shutdown)
 */
export function stopCollabCleanup(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    log.info("Cleanup interval stopped");
  }
}

/**
 * Check if cleanup interval is running (for monitoring)
 */
export function isCleanupRunning(): boolean {
  return cleanupIntervalId !== null;
}

// Auto-start cleanup on module load
startCleanupInterval();
