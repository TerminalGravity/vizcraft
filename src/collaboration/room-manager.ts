/**
 * Room Manager
 *
 * Manages collaboration rooms (one per diagram) and participants.
 * Handles presence tracking and room lifecycle.
 */

import { nanoid } from "nanoid";
import type { Room, Participant, RoomState, ServerMessage } from "./types";
import { COLLAB_CONFIG } from "./types";

// WebSocket connection type
type WebSocketConnection = {
  send: (message: string) => void;
  close: () => void;
  readyState: number;
};

// Connection state
interface ConnectionState {
  ws: WebSocketConnection;
  participantId: string;
  diagramId: string | null;
  pingInterval?: ReturnType<typeof setInterval>;
}

class RoomManager {
  private rooms = new Map<string, Room>();
  private connections = new Map<WebSocketConnection, ConnectionState>();
  private colorIndex = 0;

  /**
   * Register a new WebSocket connection
   */
  registerConnection(ws: WebSocketConnection): void {
    const state: ConnectionState = {
      ws,
      participantId: nanoid(8),
      diagramId: null,
    };
    this.connections.set(ws, state);

    // Set up ping interval
    state.pingInterval = setInterval(() => {
      if (ws.readyState === 1) {
        this.send(ws, { type: "pong" });
      }
    }, COLLAB_CONFIG.PING_INTERVAL_MS);

    console.log(`[collab] Connection registered: ${state.participantId}`);
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
    console.log(`[collab] Connection closed: ${state.participantId}`);
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
      console.log(`[collab] Room created: ${diagramId}`);
    }

    // Check max participants
    if (room.participants.size >= COLLAB_CONFIG.MAX_PARTICIPANTS) {
      this.send(ws, { type: "error", message: "Room is full", code: "ROOM_FULL" });
      return;
    }

    // Create participant
    const participant: Participant = {
      id: state.participantId,
      name: name || `User ${state.participantId.slice(0, 4)}`,
      color: this.getNextColor(),
      lastSeen: Date.now(),
    };

    // Add to room
    room.participants.set(participant.id, participant);
    state.diagramId = diagramId;

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

    console.log(`[collab] ${participant.name} joined room ${diagramId} (${room.participants.size} participants)`);
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

    // Notify others
    this.broadcastToRoom(state.diagramId, {
      type: "participant_left",
      participantId: state.participantId,
    }, ws);

    console.log(`[collab] ${state.participantId} left room ${state.diagramId} (${room.participants.size} remaining)`);

    // Clean up empty rooms
    if (room.participants.size === 0) {
      this.rooms.delete(state.diagramId);
      console.log(`[collab] Room ${state.diagramId} closed (empty)`);
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
   */
  handleChanges(ws: WebSocketConnection, changes: unknown[], baseVersion: number): boolean {
    const state = this.connections.get(ws);
    if (!state || !state.diagramId) {
      this.send(ws, { type: "error", message: "Not in a room", code: "NOT_IN_ROOM" });
      return false;
    }

    const room = this.rooms.get(state.diagramId);
    if (!room) return false;

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

    // Broadcast changes to all participants (including sender for confirmation)
    this.broadcastToRoom(state.diagramId, {
      type: "changes",
      changes: changes as any,
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

    console.log(`[collab] Sync broadcast to room ${diagramId} (v${room.version})`);
  }

  /**
   * Get room statistics
   */
  getStats(): {
    rooms: number;
    connections: number;
    totalParticipants: number;
  } {
    let totalParticipants = 0;
    for (const room of this.rooms.values()) {
      totalParticipants += room.participants.size;
    }

    return {
      rooms: this.rooms.size,
      connections: this.connections.size,
      totalParticipants,
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
   * Clean up inactive participants
   */
  cleanupInactive(): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [diagramId, room] of this.rooms) {
      for (const [participantId, participant] of room.participants) {
        if (now - participant.lastSeen > COLLAB_CONFIG.PRESENCE_TIMEOUT_MS) {
          room.participants.delete(participantId);

          this.broadcastToRoom(diagramId, {
            type: "participant_left",
            participantId,
          });

          cleaned++;
        }
      }

      // Clean up empty rooms
      if (room.participants.size === 0) {
        this.rooms.delete(diagramId);
      }
    }

    if (cleaned > 0) {
      console.log(`[collab] Cleaned up ${cleaned} inactive participants`);
    }

    return cleaned;
  }

  // Private helpers

  private send(ws: WebSocketConnection, message: ServerMessage): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcastToRoom(diagramId: string, message: ServerMessage, exclude?: WebSocketConnection): void {
    const messageStr = JSON.stringify(message);

    for (const [ws, state] of this.connections) {
      if (state.diagramId === diagramId && ws !== exclude && ws.readyState === 1) {
        ws.send(messageStr);
      }
    }
  }

  private getNextColor(): string {
    const color = COLLAB_CONFIG.PARTICIPANT_COLORS[this.colorIndex % COLLAB_CONFIG.PARTICIPANT_COLORS.length];
    this.colorIndex++;
    return color;
  }
}

// Singleton instance
export const roomManager = new RoomManager();

// Start cleanup interval
setInterval(() => {
  roomManager.cleanupInactive();
}, COLLAB_CONFIG.PRESENCE_TIMEOUT_MS / 2);
