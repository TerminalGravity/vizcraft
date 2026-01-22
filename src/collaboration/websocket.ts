/**
 * WebSocket Handler for Collaboration
 *
 * Handles WebSocket connections for real-time diagram collaboration.
 * Uses Bun's native WebSocket support.
 */

import { roomManager } from "./room-manager";
import type { ClientMessage } from "./types";
import { COLLAB_CONFIG, validateClientMessage } from "./types";
import type { Server } from "bun";

// Track WebSocket to ServerWebSocket mapping for Bun
type BunWebSocket = {
  send: (message: string) => void;
  close: () => void;
  readyState: number;
  data?: { participantId?: string };
};

/**
 * Bun server with WebSocket support
 */
type BunServerWithWS = Server & {
  upgrade: (req: Request, options?: { data?: unknown }) => boolean;
};

/**
 * Handle WebSocket upgrade request
 */
export function handleWebSocketUpgrade(req: Request, server: BunServerWithWS): Response | undefined {
  const url = new URL(req.url);

  // Only handle /ws/collab path
  if (url.pathname !== "/ws/collab") {
    return undefined;
  }

  // Upgrade to WebSocket
  const upgraded = server.upgrade(req, {
    data: {
      participantId: null,
    },
  });

  if (!upgraded) {
    return new Response("WebSocket upgrade failed", { status: 500 });
  }

  return undefined; // Return nothing on successful upgrade
}

/**
 * Handle WebSocket open
 */
export function handleWebSocketOpen(ws: BunWebSocket): void {
  const wrappedWs = wrapWebSocket(ws);
  roomManager.registerConnection(wrappedWs);
}

/**
 * Handle WebSocket message
 */
export function handleWebSocketMessage(ws: BunWebSocket, message: string | Buffer): void {
  const wrappedWs = wrapWebSocket(ws);

  // Check message size before processing
  const messageSize = typeof message === "string" ? message.length : message.length;
  if (messageSize > COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGE_SIZE) {
    console.warn(`[collab] Message too large: ${messageSize} bytes (max: ${COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGE_SIZE})`);
    wrappedWs.send(JSON.stringify({
      type: "error",
      message: `Message too large (${Math.round(messageSize / 1024)}KB). Maximum allowed: ${Math.round(COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGE_SIZE / 1024)}KB`,
      code: "MESSAGE_TOO_LARGE",
    }));
    return;
  }

  // Check rate limit before processing
  if (!roomManager.checkRateLimit(wrappedWs)) {
    return; // Rate limited, message already sent to client
  }

  // Update activity timestamp for stale connection detection
  roomManager.updateActivity(wrappedWs);

  try {
    // Parse JSON first
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.toString());
    } catch {
      wrappedWs.send(JSON.stringify({
        type: "error",
        message: "Invalid JSON",
        code: "INVALID_JSON",
      }));
      return;
    }

    // Validate message structure with Zod
    const validation = validateClientMessage(parsed);
    if (!validation.success) {
      console.warn(`[collab] Invalid message: ${validation.error}`);
      wrappedWs.send(JSON.stringify({
        type: "error",
        message: validation.error,
        code: "INVALID_MESSAGE",
      }));
      return;
    }

    const data = validation.message;

    // Note: Change count validation is now handled by Zod schema (MAX_CHANGES_PER_MESSAGE)
    // But we keep explicit check for better error messages
    if (data.type === "change" && data.changes) {
      if (data.changes.length > COLLAB_CONFIG.RATE_LIMIT.MAX_CHANGES_PER_MESSAGE) {
        console.warn(`[collab] Too many changes: ${data.changes.length} (max: ${COLLAB_CONFIG.RATE_LIMIT.MAX_CHANGES_PER_MESSAGE})`);
        wrappedWs.send(JSON.stringify({
          type: "error",
          message: `Too many changes in single message (${data.changes.length}). Maximum allowed: ${COLLAB_CONFIG.RATE_LIMIT.MAX_CHANGES_PER_MESSAGE}`,
          code: "TOO_MANY_CHANGES",
        }));
        return;
      }
    }

    switch (data.type) {
      case "join":
        roomManager.joinRoom(wrappedWs, data.diagramId, data.name);
        break;

      case "leave":
        roomManager.leaveRoom(wrappedWs);
        break;

      case "cursor":
        roomManager.updateCursor(wrappedWs, data.x, data.y);
        break;

      case "selection":
        roomManager.updateSelection(wrappedWs, data.nodeIds);
        break;

      case "change":
        roomManager.handleChanges(wrappedWs, data.changes, data.baseVersion);
        break;

      case "ping":
        // Ping is handled automatically, but acknowledge it
        wrappedWs.send(JSON.stringify({ type: "pong" }));
        break;

      default:
        console.warn("[collab] Unknown message type:", (data as any).type);
    }
  } catch (err) {
    console.error("[collab] Error handling message:", err);
    wrappedWs.send(JSON.stringify({
      type: "error",
      message: "Internal error processing message",
      code: "INTERNAL_ERROR",
    }));
  }
}

/**
 * Handle WebSocket close
 */
export function handleWebSocketClose(ws: BunWebSocket): void {
  const wrappedWs = wrapWebSocket(ws);
  roomManager.handleDisconnect(wrappedWs);
}

/**
 * Handle WebSocket error
 */
export function handleWebSocketError(ws: BunWebSocket, error: Error): void {
  console.error("[collab] WebSocket error:", error);
  const wrappedWs = wrapWebSocket(ws);
  roomManager.handleDisconnect(wrappedWs);
}

/**
 * Wrap Bun's WebSocket to match our interface
 */
function wrapWebSocket(ws: BunWebSocket): {
  send: (message: string) => void;
  close: () => void;
  readyState: number;
} {
  return {
    send: (message: string) => ws.send(message),
    close: () => ws.close(),
    get readyState() { return ws.readyState; },
  };
}

/**
 * Broadcast sync to a diagram room
 * Called when diagram is updated through REST API
 */
export function broadcastDiagramSync(diagramId: string, spec: unknown): void {
  roomManager.broadcastSync(diagramId, spec);
}

/**
 * Get collaboration stats
 */
export function getCollabStats(): ReturnType<typeof roomManager.getStats> {
  return roomManager.getStats();
}

/**
 * Get room info
 */
export function getRoomInfo(diagramId: string): ReturnType<typeof roomManager.getRoomInfo> {
  return roomManager.getRoomInfo(diagramId);
}
