/**
 * WebSocket Authentication Tests
 *
 * Tests for JWT-based WebSocket authentication in the collaboration system
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { signJWT, verifyJWT } from "../auth/jwt";
import { roomManager } from "./room-manager";

// Mock WebSocket for testing
function createMockWebSocket(options: {
  userId?: string | null;
  role?: "admin" | "user" | "viewer" | null;
} = {}): {
  send: (message: string) => void;
  close: () => void;
  readyState: number;
  userId?: string | null;
  role?: "admin" | "user" | "viewer" | null;
  messages: string[];
  closed: boolean;
} {
  const ws = {
    messages: [] as string[],
    closed: false,
    send: (message: string) => ws.messages.push(message),
    close: () => { ws.closed = true; },
    readyState: 1, // OPEN
    userId: options.userId ?? null,
    role: options.role ?? null,
  };
  return ws;
}

describe("WebSocket Authentication", () => {
  const registeredWs: any[] = [];

  afterEach(() => {
    // Clean up registered connections
    for (const ws of registeredWs) {
      roomManager.handleDisconnect(ws);
    }
    registeredWs.length = 0;
  });

  describe("JWT Token Generation for WebSocket", () => {
    it("generates valid token that can be used for WebSocket auth", async () => {
      const token = await signJWT({ sub: "user-ws-123", role: "user" });
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");

      const result = await verifyJWT(token);
      expect(result.valid).toBe(true);
      expect(result.payload?.sub).toBe("user-ws-123");
      expect(result.payload?.role).toBe("user");
    });

    it("generates token with different roles", async () => {
      const adminToken = await signJWT({ sub: "admin-1", role: "admin" });
      const viewerToken = await signJWT({ sub: "viewer-1", role: "viewer" });

      const adminResult = await verifyJWT(adminToken);
      const viewerResult = await verifyJWT(viewerToken);

      expect(adminResult.payload?.role).toBe("admin");
      expect(viewerResult.payload?.role).toBe("viewer");
    });
  });

  describe("Connection Registration with Auth", () => {
    it("registers anonymous connection", () => {
      const ws = createMockWebSocket();
      registeredWs.push(ws);

      roomManager.registerConnection(ws);

      const info = roomManager.getConnectionInfo(ws);
      expect(info).not.toBeNull();
      expect(info!.userId).toBeNull();
      expect(info!.role).toBeNull();
    });

    it("registers authenticated connection", () => {
      const ws = createMockWebSocket({
        userId: "user-auth-123",
        role: "user",
      });
      registeredWs.push(ws);

      roomManager.registerConnection(ws);

      const info = roomManager.getConnectionInfo(ws);
      expect(info).not.toBeNull();
      expect(info!.userId).toBe("user-auth-123");
      expect(info!.role).toBe("user");
    });

    it("registers admin connection", () => {
      const ws = createMockWebSocket({
        userId: "admin-123",
        role: "admin",
      });
      registeredWs.push(ws);

      roomManager.registerConnection(ws);

      const info = roomManager.getConnectionInfo(ws);
      expect(info!.role).toBe("admin");
    });

    it("registers viewer connection", () => {
      const ws = createMockWebSocket({
        userId: "viewer-123",
        role: "viewer",
      });
      registeredWs.push(ws);

      roomManager.registerConnection(ws);

      const info = roomManager.getConnectionInfo(ws);
      expect(info!.role).toBe("viewer");
    });
  });

  describe("Room Join with User Association", () => {
    it("associates userId with participant when joining room", () => {
      const ws = createMockWebSocket({
        userId: "user-join-123",
        role: "user",
      });
      registeredWs.push(ws);

      roomManager.registerConnection(ws);
      roomManager.joinRoom(ws, "test-diagram-auth", "Test User");

      const roomInfo = roomManager.getRoomInfo("test-diagram-auth");
      expect(roomInfo).not.toBeNull();
      expect(roomInfo!.participants).toHaveLength(1);
      expect(roomInfo!.participants[0].userId).toBe("user-join-123");
    });

    it("anonymous user joins with null userId", () => {
      const ws = createMockWebSocket();
      registeredWs.push(ws);

      roomManager.registerConnection(ws);
      roomManager.joinRoom(ws, "test-diagram-anon", "Anonymous User");

      const roomInfo = roomManager.getRoomInfo("test-diagram-anon");
      expect(roomInfo).not.toBeNull();
      expect(roomInfo!.participants[0].userId).toBeNull();
    });

    it("multiple users with different auth levels in same room", () => {
      const adminWs = createMockWebSocket({ userId: "admin-1", role: "admin" });
      const userWs = createMockWebSocket({ userId: "user-1", role: "user" });
      const viewerWs = createMockWebSocket({ userId: "viewer-1", role: "viewer" });
      const anonWs = createMockWebSocket();

      registeredWs.push(adminWs, userWs, viewerWs, anonWs);

      roomManager.registerConnection(adminWs);
      roomManager.registerConnection(userWs);
      roomManager.registerConnection(viewerWs);
      roomManager.registerConnection(anonWs);

      roomManager.joinRoom(adminWs, "multi-auth-room", "Admin");
      roomManager.joinRoom(userWs, "multi-auth-room", "User");
      roomManager.joinRoom(viewerWs, "multi-auth-room", "Viewer");
      roomManager.joinRoom(anonWs, "multi-auth-room", "Anonymous");

      const roomInfo = roomManager.getRoomInfo("multi-auth-room");
      expect(roomInfo).not.toBeNull();
      expect(roomInfo!.participants).toHaveLength(4);

      const userIds = roomInfo!.participants.map(p => p.userId);
      expect(userIds).toContain("admin-1");
      expect(userIds).toContain("user-1");
      expect(userIds).toContain("viewer-1");
      expect(userIds).toContain(null);
    });
  });

  describe("Write Permission Check", () => {
    it("admin can write", () => {
      const ws = createMockWebSocket({ userId: "admin-write", role: "admin" });
      registeredWs.push(ws);
      roomManager.registerConnection(ws);

      expect(roomManager.canWrite(ws)).toBe(true);
    });

    it("user can write", () => {
      const ws = createMockWebSocket({ userId: "user-write", role: "user" });
      registeredWs.push(ws);
      roomManager.registerConnection(ws);

      expect(roomManager.canWrite(ws)).toBe(true);
    });

    it("viewer cannot write", () => {
      const ws = createMockWebSocket({ userId: "viewer-write", role: "viewer" });
      registeredWs.push(ws);
      roomManager.registerConnection(ws);

      expect(roomManager.canWrite(ws)).toBe(false);
    });

    it("anonymous cannot write", () => {
      const ws = createMockWebSocket();
      registeredWs.push(ws);
      roomManager.registerConnection(ws);

      expect(roomManager.canWrite(ws)).toBe(false);
    });

    it("unregistered connection cannot write", () => {
      const ws = createMockWebSocket();
      // Don't register
      expect(roomManager.canWrite(ws)).toBe(false);
    });
  });

  describe("Participant Broadcast with User Info", () => {
    it("broadcasts userId when participant joins", () => {
      const ws1 = createMockWebSocket({ userId: "first-user", role: "user" });
      const ws2 = createMockWebSocket({ userId: "second-user", role: "user" });
      registeredWs.push(ws1, ws2);

      roomManager.registerConnection(ws1);
      roomManager.registerConnection(ws2);

      roomManager.joinRoom(ws1, "broadcast-test", "First");
      ws1.messages = []; // Clear messages

      roomManager.joinRoom(ws2, "broadcast-test", "Second");

      // ws1 should receive participant_joined with userId
      expect(ws1.messages).toHaveLength(1);
      const msg = JSON.parse(ws1.messages[0]);
      expect(msg.type).toBe("participant_joined");
      expect(msg.participant.userId).toBe("second-user");
    });
  });
});

describe("Token URL Parameter Parsing", () => {
  it("extracts token from URL query parameter", () => {
    const url = new URL("http://localhost/ws/collab?token=test-jwt-token");
    const token = url.searchParams.get("token");
    expect(token).toBe("test-jwt-token");
  });

  it("handles missing token parameter", () => {
    const url = new URL("http://localhost/ws/collab");
    const token = url.searchParams.get("token");
    expect(token).toBeNull();
  });

  it("handles multiple query parameters", () => {
    const url = new URL("http://localhost/ws/collab?diagramId=123&token=my-token&other=value");
    const token = url.searchParams.get("token");
    expect(token).toBe("my-token");
  });
});
