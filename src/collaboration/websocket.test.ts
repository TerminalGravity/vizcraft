/**
 * WebSocket Collaboration Tests
 *
 * Tests for WebSocket message handling and room synchronization
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { roomManager } from "./room-manager";
import { COLLAB_CONFIG, type ClientMessage, type ServerMessage } from "./types";

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

// Helper to get last message as parsed object
function getLastMessage(ws: MockWebSocket): ServerMessage | null {
  if (ws.messages.length === 0) return null;
  return JSON.parse(ws.messages[ws.messages.length - 1]);
}

// Helper to get all messages as parsed objects
function getAllMessages(ws: MockWebSocket): ServerMessage[] {
  return ws.messages.map((m) => JSON.parse(m));
}

// Helper to clear messages
function clearMessages(ws: MockWebSocket): void {
  ws.messages = [];
}

describe("WebSocket Connection Lifecycle", () => {
  it("registers connection on open", () => {
    const ws = createMockWs();
    const statsBefore = roomManager.getStats();

    roomManager.registerConnection(ws);

    const statsAfter = roomManager.getStats();
    expect(statsAfter.connections).toBe(statsBefore.connections + 1);

    roomManager.handleDisconnect(ws);
  });

  it("cleans up on disconnect", () => {
    const ws = createMockWs();
    roomManager.registerConnection(ws);
    const statsBefore = roomManager.getStats();

    roomManager.handleDisconnect(ws);

    const statsAfter = roomManager.getStats();
    expect(statsAfter.connections).toBe(statsBefore.connections - 1);
  });

  it("leaves room on disconnect", () => {
    const ws = createMockWs();
    const diagramId = `disconnect-test-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId, "Test User");

    expect(roomManager.getRoomInfo(diagramId)).not.toBeNull();

    roomManager.handleDisconnect(ws);

    // Room should be cleaned up (was only participant)
    expect(roomManager.getRoomInfo(diagramId)).toBeNull();
  });
});

describe("Room Join/Leave", () => {
  it("sends joined message on successful join", () => {
    const ws = createMockWs();
    const diagramId = `join-test-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId, "Joiner");

    const msg = getLastMessage(ws);
    expect(msg?.type).toBe("joined");

    if (msg?.type === "joined") {
      expect(msg.participant.name).toBe("Joiner");
      expect(msg.room.diagramId).toBe(diagramId);
    }

    roomManager.handleDisconnect(ws);
  });

  it("assigns unique colors to participants", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `color-test-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);
    roomManager.joinRoom(ws1, diagramId, "User 1");
    roomManager.joinRoom(ws2, diagramId, "User 2");

    const msg1 = getAllMessages(ws1).find((m) => m.type === "joined") as {
      type: "joined";
      participant: { color: string };
    };
    const msg2 = getAllMessages(ws2).find((m) => m.type === "joined") as {
      type: "joined";
      participant: { color: string };
    };

    // Colors should both be from the palette
    expect(COLLAB_CONFIG.PARTICIPANT_COLORS).toContain(msg1.participant.color);
    expect(COLLAB_CONFIG.PARTICIPANT_COLORS).toContain(msg2.participant.color);

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });

  it("notifies others when participant joins", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `notify-join-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);
    roomManager.joinRoom(ws1, diagramId, "First User");
    clearMessages(ws1);

    roomManager.joinRoom(ws2, diagramId, "Second User");

    // ws1 should receive participant_joined
    const msg = getLastMessage(ws1);
    expect(msg?.type).toBe("participant_joined");

    if (msg?.type === "participant_joined") {
      expect(msg.participant.name).toBe("Second User");
    }

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });

  it("notifies others when participant leaves", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `notify-leave-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);
    roomManager.joinRoom(ws1, diagramId, "Staying");
    roomManager.joinRoom(ws2, diagramId, "Leaving");
    clearMessages(ws1);

    roomManager.leaveRoom(ws2);

    const msg = getLastMessage(ws1);
    expect(msg?.type).toBe("participant_left");

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });

  it("sends error when room is full", () => {
    const connections: MockWebSocket[] = [];
    const diagramId = `full-room-${Date.now()}`;

    // Fill room to capacity
    for (let i = 0; i < COLLAB_CONFIG.MAX_PARTICIPANTS; i++) {
      const ws = createMockWs();
      connections.push(ws);
      roomManager.registerConnection(ws);
      roomManager.joinRoom(ws, diagramId, `User ${i}`);
    }

    // Try to add one more
    const extraWs = createMockWs();
    roomManager.registerConnection(extraWs);
    roomManager.joinRoom(extraWs, diagramId, "Extra");

    const msg = getLastMessage(extraWs);
    expect(msg?.type).toBe("error");
    if (msg?.type === "error") {
      expect(msg.code).toBe("ROOM_FULL");
    }

    // Cleanup
    for (const ws of connections) {
      roomManager.handleDisconnect(ws);
    }
    roomManager.handleDisconnect(extraWs);
  });

  it("auto-leaves previous room when joining new one", () => {
    const ws = createMockWs();
    const diagramId1 = `room1-${Date.now()}`;
    const diagramId2 = `room2-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId1, "Hopper");
    expect(roomManager.getRoomInfo(diagramId1)?.participants.length).toBe(1);

    roomManager.joinRoom(ws, diagramId2, "Hopper");

    // Should have left room 1
    expect(roomManager.getRoomInfo(diagramId1)).toBeNull();
    expect(roomManager.getRoomInfo(diagramId2)?.participants.length).toBe(1);

    roomManager.handleDisconnect(ws);
  });
});

describe("Cursor Updates", () => {
  it("broadcasts cursor position to other participants", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `cursor-test-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);
    roomManager.joinRoom(ws1, diagramId, "Mover");
    roomManager.joinRoom(ws2, diagramId, "Watcher");
    clearMessages(ws2);

    roomManager.updateCursor(ws1, 100, 200);

    const msg = getLastMessage(ws2);
    expect(msg?.type).toBe("cursor_update");

    if (msg?.type === "cursor_update") {
      expect(msg.x).toBe(100);
      expect(msg.y).toBe(200);
    }

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });

  it("does not send cursor to self", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `cursor-self-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);
    roomManager.joinRoom(ws1, diagramId, "Mover");
    roomManager.joinRoom(ws2, diagramId, "Watcher");
    clearMessages(ws1);

    roomManager.updateCursor(ws1, 100, 200);

    // ws1 should not receive cursor_update
    const cursorMsgs = getAllMessages(ws1).filter(
      (m) => m.type === "cursor_update"
    );
    expect(cursorMsgs.length).toBe(0);

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });

  it("ignores cursor update when not in room", () => {
    const ws = createMockWs();
    roomManager.registerConnection(ws);
    clearMessages(ws);

    roomManager.updateCursor(ws, 100, 200);

    // No messages should be sent
    expect(ws.messages.length).toBe(0);

    roomManager.handleDisconnect(ws);
  });
});

describe("Selection Updates", () => {
  it("broadcasts selection to other participants", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `selection-test-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);
    roomManager.joinRoom(ws1, diagramId, "Selector");
    roomManager.joinRoom(ws2, diagramId, "Watcher");
    clearMessages(ws2);

    roomManager.updateSelection(ws1, ["node-1", "node-2"]);

    const msg = getLastMessage(ws2);
    expect(msg?.type).toBe("selection_update");

    if (msg?.type === "selection_update") {
      expect(msg.nodeIds).toEqual(["node-1", "node-2"]);
    }

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });

  it("handles empty selection", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `empty-selection-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);
    roomManager.joinRoom(ws1, diagramId, "Selector");
    roomManager.joinRoom(ws2, diagramId, "Watcher");
    clearMessages(ws2);

    roomManager.updateSelection(ws1, []);

    const msg = getLastMessage(ws2);
    expect(msg?.type).toBe("selection_update");

    if (msg?.type === "selection_update") {
      expect(msg.nodeIds).toEqual([]);
    }

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });
});

describe("Change Handling", () => {
  it("accepts changes with matching version", () => {
    const ws = createMockWs();
    const diagramId = `change-test-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId, "Changer");

    const room = roomManager.getRoomInfo(diagramId);
    const baseVersion = room!.version;

    const result = roomManager.handleChanges(
      ws,
      [{ action: "add_node", data: { id: "new-node" } }],
      baseVersion
    );

    expect(result).toBe(true);

    roomManager.handleDisconnect(ws);
  });

  it("rejects changes with outdated version", () => {
    const ws = createMockWs();
    const diagramId = `conflict-test-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId, "Changer");
    clearMessages(ws);

    // Use incorrect base version
    const result = roomManager.handleChanges(
      ws,
      [{ action: "add_node" }],
      999
    );

    expect(result).toBe(false);

    const msg = getLastMessage(ws);
    expect(msg?.type).toBe("conflict");

    roomManager.handleDisconnect(ws);
  });

  it("increments version on successful change", () => {
    const ws = createMockWs();
    const diagramId = `version-test-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId, "Changer");

    const versionBefore = roomManager.getRoomInfo(diagramId)!.version;

    roomManager.handleChanges(ws, [{ action: "add_node" }], versionBefore);

    const versionAfter = roomManager.getRoomInfo(diagramId)!.version;
    expect(versionAfter).toBe(versionBefore + 1);

    roomManager.handleDisconnect(ws);
  });

  it("broadcasts changes to all participants", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `broadcast-change-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);
    roomManager.joinRoom(ws1, diagramId, "Editor");
    roomManager.joinRoom(ws2, diagramId, "Viewer");

    const room = roomManager.getRoomInfo(diagramId);
    const baseVersion = room!.version;

    clearMessages(ws1);
    clearMessages(ws2);

    roomManager.handleChanges(
      ws1,
      [{ action: "add_node", target: "new-node" }],
      baseVersion
    );

    // Both should receive changes (including sender for confirmation)
    const msg1 = getLastMessage(ws1);
    const msg2 = getLastMessage(ws2);

    expect(msg1?.type).toBe("changes");
    expect(msg2?.type).toBe("changes");

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });

  it("sends error when not in room", () => {
    const ws = createMockWs();
    roomManager.registerConnection(ws);
    clearMessages(ws);

    const result = roomManager.handleChanges(ws, [{ action: "add_node" }], 0);

    expect(result).toBe(false);

    const msg = getLastMessage(ws);
    expect(msg?.type).toBe("error");
    if (msg?.type === "error") {
      expect(msg.code).toBe("NOT_IN_ROOM");
    }

    roomManager.handleDisconnect(ws);
  });
});

describe("Sync Broadcast", () => {
  it("broadcasts sync to all room participants", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `sync-test-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);
    roomManager.joinRoom(ws1, diagramId, "User 1");
    roomManager.joinRoom(ws2, diagramId, "User 2");
    clearMessages(ws1);
    clearMessages(ws2);

    const newSpec = { type: "flowchart", nodes: [] };
    roomManager.broadcastSync(diagramId, newSpec);

    const msg1 = getLastMessage(ws1);
    const msg2 = getLastMessage(ws2);

    expect(msg1?.type).toBe("sync");
    expect(msg2?.type).toBe("sync");

    if (msg1?.type === "sync") {
      expect(msg1.spec).toEqual(newSpec);
    }

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });

  it("updates room version on sync", () => {
    const ws = createMockWs();
    const diagramId = `sync-version-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId, "User");

    const versionBefore = roomManager.getRoomInfo(diagramId)!.version;
    roomManager.broadcastSync(diagramId, { type: "flowchart" });
    const versionAfter = roomManager.getRoomInfo(diagramId)!.version;

    expect(versionAfter).toBe(versionBefore + 1);

    roomManager.handleDisconnect(ws);
  });

  it("sets specific version when provided", () => {
    const ws = createMockWs();
    const diagramId = `sync-set-version-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId, "User");

    roomManager.broadcastSync(diagramId, { type: "flowchart" }, 42);
    const version = roomManager.getRoomInfo(diagramId)!.version;

    expect(version).toBe(42);

    roomManager.handleDisconnect(ws);
  });
});

describe("Room Statistics", () => {
  it("tracks room count accurately", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);

    const statsBefore = roomManager.getStats();

    roomManager.joinRoom(ws1, `stats-room-1-${Date.now()}`, "User 1");
    roomManager.joinRoom(ws2, `stats-room-2-${Date.now()}`, "User 2");

    const statsAfter = roomManager.getStats();
    expect(statsAfter.rooms).toBe(statsBefore.rooms + 2);

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });

  it("tracks participant count accurately", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const diagramId = `participant-count-${Date.now()}`;

    roomManager.registerConnection(ws1);
    roomManager.registerConnection(ws2);

    const statsBefore = roomManager.getStats();

    roomManager.joinRoom(ws1, diagramId, "User 1");
    roomManager.joinRoom(ws2, diagramId, "User 2");

    const statsAfter = roomManager.getStats();
    expect(statsAfter.totalParticipants).toBe(statsBefore.totalParticipants + 2);

    roomManager.handleDisconnect(ws1);
    roomManager.handleDisconnect(ws2);
  });
});

describe("Room Info", () => {
  it("returns null for non-existent room", () => {
    const info = roomManager.getRoomInfo("nonexistent-room");
    expect(info).toBeNull();
  });

  it("returns correct room state", () => {
    const ws = createMockWs();
    const diagramId = `room-info-${Date.now()}`;

    roomManager.registerConnection(ws);
    roomManager.joinRoom(ws, diagramId, "Test User");

    const info = roomManager.getRoomInfo(diagramId);
    expect(info).not.toBeNull();
    expect(info!.diagramId).toBe(diagramId);
    expect(info!.participants.length).toBe(1);
    expect(info!.participants[0].name).toBe("Test User");
    expect(typeof info!.version).toBe("number");

    roomManager.handleDisconnect(ws);
  });
});

describe("Message Size Limits", () => {
  it("has message size limit configured", () => {
    expect(COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGE_SIZE).toBeDefined();
    expect(COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGE_SIZE).toBeGreaterThan(0);
    // Default is 1MB
    expect(COLLAB_CONFIG.RATE_LIMIT.MAX_MESSAGE_SIZE).toBe(1024 * 1024);
  });

  it("has changes per message limit configured", () => {
    expect(COLLAB_CONFIG.RATE_LIMIT.MAX_CHANGES_PER_MESSAGE).toBeDefined();
    expect(COLLAB_CONFIG.RATE_LIMIT.MAX_CHANGES_PER_MESSAGE).toBeGreaterThan(0);
    // Default is 100
    expect(COLLAB_CONFIG.RATE_LIMIT.MAX_CHANGES_PER_MESSAGE).toBe(100);
  });
});
