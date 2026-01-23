/**
 * WebSocket Handler for Collaboration
 *
 * Handles WebSocket connections for real-time diagram collaboration.
 * Uses Bun's native WebSocket support.
 *
 * Authentication:
 * - Token can be provided via query parameter: /ws/collab?token=<jwt>
 * - If no token, connection is allowed but userId will be null
 * - User ID is associated with participant for attribution
 */

import { roomManager } from "./room-manager";
import type { ClientMessage } from "./types";
import { COLLAB_CONFIG, validateClientMessage } from "./types";
import type { Server } from "bun";
import { verifyJWT } from "../auth/jwt";
import { createLogger } from "../logging";

const log = createLogger("collab-ws");

/**
 * WebSocket data includes authentication info
 */
export interface WebSocketData {
  participantId?: string;
  userId?: string | null;
  role?: "admin" | "user" | "viewer" | null;
}

/**
 * Bun WebSocket interface for collaboration handlers
 * Provides a typed interface for Bun's ServerWebSocket
 */
export type BunWebSocket = {
  send: (message: string) => void;
  close: () => void;
  readyState: number;
  data?: WebSocketData;
};

/**
 * Bun server with WebSocket support
 */
export type BunServerWithWS = Server<WebSocketData> & {
  upgrade: (req: Request, options?: { data?: unknown }) => boolean;
};

/**
 * Handle WebSocket upgrade request
 * Validates JWT token if provided and associates user with connection
 */
export async function handleWebSocketUpgrade(req: Request, server: BunServerWithWS): Promise<Response | undefined> {
  const url = new URL(req.url);

  // Only handle /ws/collab path
  if (url.pathname !== "/ws/collab") {
    return undefined;
  }

  // Extract token from query parameter
  const token = url.searchParams.get("token");
  let userId: string | null = null;
  let role: "admin" | "user" | "viewer" | null = null;

  // Validate token if provided
  if (token) {
    const result = await verifyJWT(token);
    if (result.valid && result.payload) {
      userId = result.payload.sub;
      role = result.payload.role as "admin" | "user" | "viewer" | null;
    } else {
      // Invalid token - reject connection
      log.warn("WebSocket upgrade rejected: invalid token");
      return new Response("Invalid authentication token", { status: 401 });
    }
  }
  // Note: If no token provided, connection is allowed but userId will be null
  // This maintains backwards compatibility with anonymous collaboration

  // Upgrade to WebSocket with user context
  const upgraded = server.upgrade(req, {
    data: {
      participantId: undefined,
      userId: userId ?? undefined,
      role: role ?? undefined,
    } satisfies WebSocketData,
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
    log.warn("Message too large", { size: messageSize, maxSize: COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGE_SIZE });
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
      log.warn("Invalid message", { error: validation.error });
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
        log.warn("Too many changes", { count: data.changes.length, max: COLLAB_CONFIG.RATE_LIMIT.MAX_CHANGES_PER_MESSAGE });
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
        log.warn("Unknown message type", { type: (data as any).type });
    }
  } catch (err) {
    log.error("Error handling message", { error: err instanceof Error ? err.message : String(err) });
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
  log.error("WebSocket error", { error: error.message });
  const wrappedWs = wrapWebSocket(ws);
  roomManager.handleDisconnect(wrappedWs);
}

/**
 * Wrapped WebSocket interface with user context
 */
export interface WrappedWebSocket {
  send: (message: string) => void;
  close: () => void;
  readyState: number;
  userId: string | null;
  role: "admin" | "user" | "viewer" | null;
}

/**
 * Wrap Bun's WebSocket to match our interface
 */
function wrapWebSocket(ws: BunWebSocket): WrappedWebSocket {
  return {
    send: (message: string) => ws.send(message),
    close: () => ws.close(),
    get readyState() { return ws.readyState; },
    get userId() { return ws.data?.userId ?? null; },
    get role() { return ws.data?.role ?? null; },
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
