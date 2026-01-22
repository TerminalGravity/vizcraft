/**
 * Room Manager Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { COLLAB_CONFIG } from "./types";
import { roomManager } from "./room-manager";

// Create a mock WebSocket
function createMockWs(): MockWebSocket {
  return {
    readyState: 1,
    messages: [],
    closed: false,
    send(message: string) {
      this.messages.push(message);
    },
    close() {
      this.closed = true;
      this.readyState = 3;
    },
  };
}

interface MockWebSocket {
  readyState: number;
  messages: string[];
  closed: boolean;
  send: (message: string) => void;
  close: () => void;
}

// We'll test the types and config since the room manager
// requires actual WebSocket connections to test fully

describe("Collaboration Config", () => {
  it("has sensible presence timeout", () => {
    expect(COLLAB_CONFIG.PRESENCE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(COLLAB_CONFIG.PRESENCE_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it("has sensible ping interval", () => {
    expect(COLLAB_CONFIG.PING_INTERVAL_MS).toBeGreaterThan(0);
    expect(COLLAB_CONFIG.PING_INTERVAL_MS).toBeLessThan(COLLAB_CONFIG.PRESENCE_TIMEOUT_MS);
  });

  it("has reasonable max participants limit", () => {
    expect(COLLAB_CONFIG.MAX_PARTICIPANTS).toBeGreaterThan(0);
    expect(COLLAB_CONFIG.MAX_PARTICIPANTS).toBeLessThanOrEqual(100);
  });

  it("has cursor throttle configured", () => {
    expect(COLLAB_CONFIG.CURSOR_THROTTLE_MS).toBeGreaterThan(0);
    expect(COLLAB_CONFIG.CURSOR_THROTTLE_MS).toBeLessThanOrEqual(100);
  });

  it("has participant colors defined", () => {
    expect(COLLAB_CONFIG.PARTICIPANT_COLORS.length).toBeGreaterThan(0);
    // All colors should be valid hex colors
    for (const color of COLLAB_CONFIG.PARTICIPANT_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("Collaboration Types", () => {
  it("participant structure is valid", () => {
    const participant = {
      id: "test-123",
      name: "Test User",
      color: "#3b82f6",
      cursor: { x: 100, y: 200 },
      selection: ["node-1", "node-2"],
      lastSeen: Date.now(),
    };

    expect(participant.id).toBe("test-123");
    expect(participant.name).toBe("Test User");
    expect(participant.color).toBe("#3b82f6");
    expect(participant.cursor?.x).toBe(100);
    expect(participant.cursor?.y).toBe(200);
    expect(participant.selection).toHaveLength(2);
  });

  it("room state structure is valid", () => {
    const roomState = {
      diagramId: "diagram-abc",
      participants: [
        { id: "p1", name: "User 1", color: "#3b82f6", lastSeen: Date.now() },
        { id: "p2", name: "User 2", color: "#10b981", lastSeen: Date.now() },
      ],
      version: 5,
    };

    expect(roomState.diagramId).toBe("diagram-abc");
    expect(roomState.participants).toHaveLength(2);
    expect(roomState.version).toBe(5);
  });
});

describe("Message Types", () => {
  it("client messages have correct structure", () => {
    // Join message
    const joinMsg = { type: "join" as const, diagramId: "d1", name: "User" };
    expect(joinMsg.type).toBe("join");
    expect(joinMsg.diagramId).toBe("d1");

    // Cursor message
    const cursorMsg = { type: "cursor" as const, x: 100, y: 200 };
    expect(cursorMsg.type).toBe("cursor");
    expect(cursorMsg.x).toBe(100);

    // Selection message
    const selectionMsg = { type: "selection" as const, nodeIds: ["n1", "n2"] };
    expect(selectionMsg.type).toBe("selection");
    expect(selectionMsg.nodeIds).toHaveLength(2);

    // Change message
    const changeMsg = {
      type: "change" as const,
      changes: [{ action: "update_node" as const, target: "n1", data: { label: "New" } }],
      baseVersion: 3,
    };
    expect(changeMsg.type).toBe("change");
    expect(changeMsg.changes).toHaveLength(1);
    expect(changeMsg.baseVersion).toBe(3);
  });

  it("server messages have correct structure", () => {
    // Joined message
    const joinedMsg = {
      type: "joined" as const,
      participant: { id: "p1", name: "User", color: "#fff", lastSeen: Date.now() },
      room: { diagramId: "d1", participants: [], version: 0 },
    };
    expect(joinedMsg.type).toBe("joined");

    // Cursor update message
    const cursorUpdateMsg = {
      type: "cursor_update" as const,
      participantId: "p1",
      x: 100,
      y: 200,
    };
    expect(cursorUpdateMsg.type).toBe("cursor_update");

    // Changes message
    const changesMsg = {
      type: "changes" as const,
      changes: [],
      author: "p1",
      version: 4,
    };
    expect(changesMsg.type).toBe("changes");
    expect(changesMsg.version).toBe(4);

    // Conflict message
    const conflictMsg = {
      type: "conflict" as const,
      message: "Version mismatch",
      currentVersion: 5,
    };
    expect(conflictMsg.type).toBe("conflict");
    expect(conflictMsg.currentVersion).toBe(5);
  });
});

describe("Rate Limiting Config", () => {
  it("has sensible rate limit settings", () => {
    expect(COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGES).toBeGreaterThan(0);
    expect(COLLAB_CONFIG.RATE_LIMIT.WINDOW_MS).toBeGreaterThan(0);
    expect(COLLAB_CONFIG.RATE_LIMIT.MAX_WARNINGS).toBeGreaterThan(0);
  });

  it("window is at least 1 second", () => {
    expect(COLLAB_CONFIG.RATE_LIMIT.WINDOW_MS).toBeGreaterThanOrEqual(1000);
  });

  it("allows reasonable message burst", () => {
    // Should allow at least 10 messages per second for real-time collab
    expect(COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGES).toBeGreaterThanOrEqual(10);
  });
});

describe("Rate Limiting Logic", () => {
  it("allows messages under the rate limit", () => {
    const ws = createMockWs();
    roomManager.registerConnection(ws);

    // Send messages up to the limit
    for (let i = 0; i < COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGES; i++) {
      const allowed = roomManager.checkRateLimit(ws);
      expect(allowed).toBe(true);
    }

    // Cleanup
    roomManager.handleDisconnect(ws);
  });

  it("sends warning when rate limit exceeded", () => {
    const ws = createMockWs();
    roomManager.registerConnection(ws);

    // Send messages up to limit
    for (let i = 0; i < COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGES; i++) {
      roomManager.checkRateLimit(ws);
    }

    // Clear previous messages
    ws.messages = [];

    // Next message should trigger warning
    const allowed = roomManager.checkRateLimit(ws);

    expect(allowed).toBe(false);
    expect(ws.messages.length).toBe(1);
    expect(JSON.parse(ws.messages[0]).code).toBe("RATE_LIMIT_WARNING");

    // Cleanup
    roomManager.handleDisconnect(ws);
  });

  it("provides rate limit state for monitoring", () => {
    const ws = createMockWs();
    roomManager.registerConnection(ws);

    // Send some messages
    for (let i = 0; i < 5; i++) {
      roomManager.checkRateLimit(ws);
    }

    const state = roomManager.getRateLimitState(ws);
    expect(state).not.toBeNull();
    expect(state!.messageCount).toBe(5);
    expect(state!.warnings).toBe(0);

    // Cleanup
    roomManager.handleDisconnect(ws);
  });

  it("returns null for unregistered connection", () => {
    const ws = createMockWs();

    const state = roomManager.getRateLimitState(ws);
    expect(state).toBeNull();

    const allowed = roomManager.checkRateLimit(ws);
    expect(allowed).toBe(false);
  });

  it("resets rate limit after window expires", async () => {
    const ws = createMockWs();
    roomManager.registerConnection(ws);

    // Fill up the limit
    for (let i = 0; i < COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGES; i++) {
      roomManager.checkRateLimit(ws);
    }

    // Trigger warning
    let allowed = roomManager.checkRateLimit(ws);
    expect(allowed).toBe(false);

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, COLLAB_CONFIG.RATE_LIMIT.WINDOW_MS + 50));

    // Should be allowed again
    allowed = roomManager.checkRateLimit(ws);
    expect(allowed).toBe(true);

    // Cleanup
    roomManager.handleDisconnect(ws);
  });
});

describe("RoomManager Connection Handling", () => {
  it("registers new connections", () => {
    const ws = createMockWs();
    const statsBefore = roomManager.getStats();

    roomManager.registerConnection(ws);

    const statsAfter = roomManager.getStats();
    expect(statsAfter.connections).toBe(statsBefore.connections + 1);

    // Cleanup
    roomManager.handleDisconnect(ws);
  });

  it("handles disconnect cleanly", () => {
    const ws = createMockWs();

    roomManager.registerConnection(ws);
    const statsBefore = roomManager.getStats();

    roomManager.handleDisconnect(ws);
    const statsAfter = roomManager.getStats();

    expect(statsAfter.connections).toBe(statsBefore.connections - 1);
  });
});

describe("RoomManager Room Operations", () => {
  it("creates room on first join", () => {
    const ws = createMockWs();
    const diagramId = `test-diagram-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId, "Test User");

    const roomInfo = roomManager.getRoomInfo(diagramId);
    expect(roomInfo).not.toBeNull();
    expect(roomInfo!.participants.length).toBe(1);
    expect(roomInfo!.participants[0].name).toBe("Test User");

    // Cleanup
    roomManager.handleDisconnect(ws);
  });

  it("adds multiple participants to same room", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `shared-diagram-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);
    roomManager.joinRoom(ws1, diagramId, "User 1");
    roomManager.joinRoom(ws2, diagramId, "User 2");

    const roomInfo = roomManager.getRoomInfo(diagramId);
    expect(roomInfo!.participants.length).toBe(2);

    // Cleanup
    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });

  it("removes participant on leave", () => {
    const ws = createMockWs();
    const diagramId = `leave-test-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId, "Leaver");
    roomManager.leaveRoom(ws);

    const roomInfo = roomManager.getRoomInfo(diagramId);
    expect(roomInfo).toBeNull(); // Room cleaned up when empty

    // Cleanup
    roomManager.handleDisconnect(ws);
  });
});
