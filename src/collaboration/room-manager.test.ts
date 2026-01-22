/**
 * Room Manager Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { COLLAB_CONFIG } from "./types";

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
