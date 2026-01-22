/**
 * WebSocket Message Validation Tests
 *
 * Tests Zod schema validation for WebSocket messages to ensure
 * malformed messages are rejected before processing.
 */

import { describe, it, expect } from "bun:test";
import { validateClientMessage, ClientMessageSchema } from "./types";

describe("validateClientMessage", () => {
  describe("join messages", () => {
    it("accepts valid join message", () => {
      const result = validateClientMessage({
        type: "join",
        diagramId: "diagram-123",
        name: "Test User",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("join");
      }
    });

    it("accepts join with default name", () => {
      const result = validateClientMessage({
        type: "join",
        diagramId: "diagram-123",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message).toHaveProperty("name", "Anonymous");
      }
    });

    it("rejects join with empty diagramId", () => {
      const result = validateClientMessage({
        type: "join",
        diagramId: "",
        name: "Test",
      });

      expect(result.success).toBe(false);
    });

    it("rejects join with too long diagramId", () => {
      const result = validateClientMessage({
        type: "join",
        diagramId: "a".repeat(101),
        name: "Test",
      });

      expect(result.success).toBe(false);
    });

    it("rejects join with too long name", () => {
      const result = validateClientMessage({
        type: "join",
        diagramId: "diagram-123",
        name: "x".repeat(101),
      });

      expect(result.success).toBe(false);
    });
  });

  describe("leave messages", () => {
    it("accepts valid leave message", () => {
      const result = validateClientMessage({ type: "leave" });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("leave");
      }
    });
  });

  describe("cursor messages", () => {
    it("accepts valid cursor message", () => {
      const result = validateClientMessage({
        type: "cursor",
        x: 100,
        y: 200,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("cursor");
      }
    });

    it("accepts cursor at coordinate boundaries", () => {
      const result = validateClientMessage({
        type: "cursor",
        x: -1_000_000,
        y: 1_000_000,
      });

      expect(result.success).toBe(true);
    });

    it("rejects cursor with x below minimum", () => {
      const result = validateClientMessage({
        type: "cursor",
        x: -1_000_001,
        y: 0,
      });

      expect(result.success).toBe(false);
    });

    it("rejects cursor with y above maximum", () => {
      const result = validateClientMessage({
        type: "cursor",
        x: 0,
        y: 1_000_001,
      });

      expect(result.success).toBe(false);
    });

    it("rejects cursor with non-numeric coordinates", () => {
      const result = validateClientMessage({
        type: "cursor",
        x: "100",
        y: 200,
      });

      expect(result.success).toBe(false);
    });
  });

  describe("selection messages", () => {
    it("accepts valid selection message", () => {
      const result = validateClientMessage({
        type: "selection",
        nodeIds: ["node-1", "node-2"],
      });

      expect(result.success).toBe(true);
    });

    it("accepts empty selection", () => {
      const result = validateClientMessage({
        type: "selection",
        nodeIds: [],
      });

      expect(result.success).toBe(true);
    });

    it("rejects selection with too many nodes", () => {
      const result = validateClientMessage({
        type: "selection",
        nodeIds: Array.from({ length: 101 }, (_, i) => `node-${i}`),
      });

      expect(result.success).toBe(false);
    });

    it("rejects selection with too long node ID", () => {
      const result = validateClientMessage({
        type: "selection",
        nodeIds: ["a".repeat(101)],
      });

      expect(result.success).toBe(false);
    });
  });

  describe("change messages", () => {
    it("accepts valid change message", () => {
      const result = validateClientMessage({
        type: "change",
        changes: [
          { action: "add_node", target: "node-1", data: { label: "Test" } },
        ],
        baseVersion: 1,
      });

      expect(result.success).toBe(true);
    });

    it("accepts all valid actions", () => {
      const actions = [
        "add_node", "remove_node", "update_node",
        "add_edge", "remove_edge", "update_edge",
        "update_style",
      ];

      for (const action of actions) {
        const result = validateClientMessage({
          type: "change",
          changes: [{ action }],
          baseVersion: 0,
        });

        expect(result.success).toBe(true);
      }
    });

    it("rejects change with invalid action", () => {
      const result = validateClientMessage({
        type: "change",
        changes: [{ action: "destroy_everything" }],
        baseVersion: 0,
      });

      expect(result.success).toBe(false);
    });

    it("rejects change with too many changes", () => {
      const result = validateClientMessage({
        type: "change",
        changes: Array.from({ length: 101 }, () => ({ action: "add_node" })),
        baseVersion: 0,
      });

      expect(result.success).toBe(false);
    });

    it("rejects change with negative baseVersion", () => {
      const result = validateClientMessage({
        type: "change",
        changes: [{ action: "add_node" }],
        baseVersion: -1,
      });

      expect(result.success).toBe(false);
    });

    it("rejects change with non-integer baseVersion", () => {
      const result = validateClientMessage({
        type: "change",
        changes: [{ action: "add_node" }],
        baseVersion: 1.5,
      });

      expect(result.success).toBe(false);
    });
  });

  describe("ping messages", () => {
    it("accepts valid ping message", () => {
      const result = validateClientMessage({ type: "ping" });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe("ping");
      }
    });
  });

  describe("invalid messages", () => {
    it("rejects unknown message type", () => {
      const result = validateClientMessage({
        type: "hack_the_server",
        payload: "evil",
      });

      expect(result.success).toBe(false);
    });

    it("rejects null", () => {
      const result = validateClientMessage(null);

      expect(result.success).toBe(false);
    });

    it("rejects undefined", () => {
      const result = validateClientMessage(undefined);

      expect(result.success).toBe(false);
    });

    it("rejects string", () => {
      const result = validateClientMessage("join");

      expect(result.success).toBe(false);
    });

    it("rejects array", () => {
      const result = validateClientMessage([{ type: "join" }]);

      expect(result.success).toBe(false);
    });

    it("rejects message without type", () => {
      const result = validateClientMessage({
        diagramId: "test",
        name: "User",
      });

      expect(result.success).toBe(false);
    });

    it("provides readable error messages", () => {
      const result = validateClientMessage({
        type: "cursor",
        x: "not a number",
        y: 100,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("x");
      }
    });
  });

  describe("prototype pollution protection", () => {
    it("does not allow __proto__ in message", () => {
      // Zod doesn't specifically block __proto__, but the parsed result
      // won't include it in a way that causes prototype pollution
      const result = validateClientMessage({
        type: "join",
        diagramId: "test",
        name: "User",
        __proto__: { isAdmin: true },
      });

      // The message should still be valid (extra properties are stripped or ignored)
      // but the __proto__ should not affect anything
      if (result.success) {
        expect((result.message as any).isAdmin).toBeUndefined();
      }
    });
  });
});
