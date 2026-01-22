/**
 * Audit Logging Module Tests
 *
 * Tests for the audit logging system that tracks mutations
 * for security and compliance purposes.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  audit,
  getAuditLog,
  clearAuditLog,
  getAuditStats,
  getAuditContext,
  type AuditAction,
  type AuditEntry,
} from "./index";
import type { UserContext } from "../auth";

// Helper to create a mock user context
function createMockUser(overrides: Partial<UserContext> = {}): UserContext {
  return {
    id: "test-user-123",
    role: "user",
    ...overrides,
  };
}

// Helper to create a mock request for audit context extraction
function createMockRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test", {
    headers: new Headers(headers),
  });
}

describe("Audit Logging", () => {
  beforeEach(() => {
    clearAuditLog();
  });

  describe("audit()", () => {
    it("logs an audit entry with all fields", () => {
      const user = createMockUser();
      const details = { name: "Test Diagram", type: "flowchart" };
      const context = { ip: "192.168.1.1", userAgent: "TestBrowser/1.0" };

      audit("diagram.create", user, "diagram-123", details, context);

      const entries = getAuditLog();
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("diagram.create");
      expect(entries[0].userId).toBe("test-user-123");
      expect(entries[0].userRole).toBe("user");
      expect(entries[0].resourceId).toBe("diagram-123");
      expect(entries[0].resourceType).toBe("diagram");
      expect(entries[0].details).toEqual(details);
      expect(entries[0].ipAddress).toBe("192.168.1.1");
      expect(entries[0].userAgent).toBe("TestBrowser/1.0");
      expect(entries[0].timestamp).toBeDefined();
    });

    it("logs entry for anonymous user with null userId", () => {
      audit("diagram.create", null, "diagram-123");

      const entries = getAuditLog();
      expect(entries).toHaveLength(1);
      expect(entries[0].userId).toBeNull();
      expect(entries[0].userRole).toBeNull();
    });

    it("logs entry without optional fields", () => {
      const user = createMockUser();

      audit("diagram.update", user, "diagram-456");

      const entries = getAuditLog();
      expect(entries).toHaveLength(1);
      expect(entries[0].details).toBeUndefined();
      expect(entries[0].ipAddress).toBeUndefined();
      expect(entries[0].userAgent).toBeUndefined();
    });

    it("logs entry with admin role", () => {
      const admin = createMockUser({ id: "admin-1", role: "admin" });

      audit("diagram.delete", admin, "diagram-789");

      const entries = getAuditLog();
      expect(entries[0].userId).toBe("admin-1");
      expect(entries[0].userRole).toBe("admin");
    });

    it("logs entry with viewer role", () => {
      const viewer = createMockUser({ id: "viewer-1", role: "viewer" });

      audit("diagram.fork", viewer, "diagram-fork");

      const entries = getAuditLog();
      expect(entries[0].userId).toBe("viewer-1");
      expect(entries[0].userRole).toBe("viewer");
    });
  });

  describe("Resource type detection", () => {
    it("detects diagram resource type", () => {
      const user = createMockUser();

      const diagramActions: AuditAction[] = [
        "diagram.create",
        "diagram.update",
        "diagram.delete",
        "diagram.fork",
        "diagram.restore",
        "diagram.apply_layout",
        "diagram.apply_theme",
        "diagram.run_agent",
        "diagram.thumbnail_update",
      ];

      diagramActions.forEach((action) => {
        audit(action, user, `diagram-${action}`);
      });

      const entries = getAuditLog();
      entries.forEach((entry) => {
        expect(entry.resourceType).toBe("diagram");
      });
    });

    it("detects share resource type", () => {
      const user = createMockUser();

      audit("share.add", user, "share-123");
      audit("share.remove", user, "share-456");

      const entries = getAuditLog();
      expect(entries[0].resourceType).toBe("share");
      expect(entries[1].resourceType).toBe("share");
    });

    it("detects ownership resource type", () => {
      const user = createMockUser();

      audit("ownership.transfer", user, "ownership-123");

      const entries = getAuditLog();
      expect(entries[0].resourceType).toBe("ownership");
    });

    it("detects visibility resource type", () => {
      const user = createMockUser();

      audit("visibility.change", user, "visibility-123");

      const entries = getAuditLog();
      // visibility.change doesn't start with share. or ownership., so it falls back to diagram
      expect(entries[0].resourceType).toBe("diagram");
    });
  });

  describe("getAuditLog() filtering", () => {
    beforeEach(() => {
      const user1 = createMockUser({ id: "user-1" });
      const user2 = createMockUser({ id: "user-2" });
      const admin = createMockUser({ id: "admin-1", role: "admin" });

      // Create varied entries
      audit("diagram.create", user1, "diagram-1");
      audit("diagram.update", user1, "diagram-1");
      audit("diagram.create", user2, "diagram-2");
      audit("diagram.delete", admin, "diagram-1");
      audit("share.add", user1, "share-1");
    });

    it("returns all entries without filters", () => {
      const entries = getAuditLog();
      expect(entries).toHaveLength(5);
    });

    it("filters by userId", () => {
      const entries = getAuditLog({ userId: "user-1" });
      expect(entries).toHaveLength(3);
      entries.forEach((e) => expect(e.userId).toBe("user-1"));
    });

    it("filters by action", () => {
      const entries = getAuditLog({ action: "diagram.create" });
      expect(entries).toHaveLength(2);
      entries.forEach((e) => expect(e.action).toBe("diagram.create"));
    });

    it("filters by resourceId", () => {
      const entries = getAuditLog({ resourceId: "diagram-1" });
      expect(entries).toHaveLength(3);
      entries.forEach((e) => expect(e.resourceId).toBe("diagram-1"));
    });

    it("filters by since date", () => {
      // Wait a small amount and add another entry
      const futureDate = new Date(Date.now() + 100);

      const entries = getAuditLog({ since: futureDate });
      expect(entries).toHaveLength(0);

      // All existing entries should be before futureDate
      const pastEntries = getAuditLog({ since: new Date(Date.now() - 10000) });
      expect(pastEntries).toHaveLength(5);
    });

    it("applies limit", () => {
      const entries = getAuditLog({ limit: 2 });
      expect(entries).toHaveLength(2);
    });

    it("combines multiple filters", () => {
      const entries = getAuditLog({
        userId: "user-1",
        action: "diagram.create",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].userId).toBe("user-1");
      expect(entries[0].action).toBe("diagram.create");
    });

    it("returns entries in descending timestamp order (most recent first)", () => {
      const entries = getAuditLog();
      for (let i = 1; i < entries.length; i++) {
        const prev = new Date(entries[i - 1].timestamp).getTime();
        const curr = new Date(entries[i].timestamp).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });
  });

  describe("Ring buffer behavior", () => {
    it("maintains maximum buffer size", () => {
      const user = createMockUser();

      // Add more than MAX_BUFFER_SIZE entries
      // MAX_BUFFER_SIZE is 1000, let's add 1010
      for (let i = 0; i < 1010; i++) {
        audit("diagram.update", user, `diagram-${i}`);
      }

      const entries = getAuditLog();
      expect(entries.length).toBeLessThanOrEqual(1000);
    });

    it("keeps most recent entries when buffer is full", () => {
      const user = createMockUser();

      // Add entries up to buffer limit plus some extras
      for (let i = 0; i < 1005; i++) {
        audit("diagram.update", user, `diagram-${i}`);
      }

      const entries = getAuditLog({ limit: 10 });

      // Most recent entries should have higher diagram IDs
      // (accounting for sorting by timestamp desc)
      entries.forEach((entry) => {
        const id = parseInt(entry.resourceId.replace("diagram-", ""), 10);
        // Should have entries from ~5 onwards (first 5 were evicted)
        expect(id).toBeGreaterThanOrEqual(5);
      });
    });
  });

  describe("getAuditStats()", () => {
    it("returns correct total entries count", () => {
      const user = createMockUser();

      audit("diagram.create", user, "d-1");
      audit("diagram.update", user, "d-1");
      audit("diagram.delete", user, "d-1");

      const stats = getAuditStats();
      expect(stats.totalEntries).toBe(3);
    });

    it("returns correct action counts", () => {
      const user = createMockUser();

      audit("diagram.create", user, "d-1");
      audit("diagram.create", user, "d-2");
      audit("diagram.update", user, "d-1");
      audit("diagram.delete", user, "d-1");

      const stats = getAuditStats();
      expect(stats.actionCounts["diagram.create"]).toBe(2);
      expect(stats.actionCounts["diagram.update"]).toBe(1);
      expect(stats.actionCounts["diagram.delete"]).toBe(1);
    });

    it("returns correct unique users count", () => {
      const user1 = createMockUser({ id: "user-1" });
      const user2 = createMockUser({ id: "user-2" });

      audit("diagram.create", user1, "d-1");
      audit("diagram.create", user2, "d-2");
      audit("diagram.update", user1, "d-1"); // Same user again
      audit("diagram.create", null, "d-3"); // Anonymous

      const stats = getAuditStats();
      expect(stats.uniqueUsers).toBe(3); // user-1, user-2, null
    });

    it("returns zero counts for empty log", () => {
      const stats = getAuditStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.uniqueUsers).toBe(0);
      expect(Object.keys(stats.actionCounts)).toHaveLength(0);
    });
  });

  describe("clearAuditLog()", () => {
    it("clears all entries", () => {
      const user = createMockUser();

      audit("diagram.create", user, "d-1");
      audit("diagram.update", user, "d-1");

      expect(getAuditLog()).toHaveLength(2);

      clearAuditLog();

      expect(getAuditLog()).toHaveLength(0);
    });
  });

  describe("getAuditContext()", () => {
    it("extracts IP from x-forwarded-for header", () => {
      const req = createMockRequest({
        "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
      });

      const context = getAuditContext(req);
      expect(context.ip).toBe("203.0.113.195");
    });

    it("extracts IP from x-real-ip header when x-forwarded-for is missing", () => {
      const req = createMockRequest({
        "x-real-ip": "192.168.1.100",
      });

      const context = getAuditContext(req);
      expect(context.ip).toBe("192.168.1.100");
    });

    it("prefers x-forwarded-for over x-real-ip", () => {
      const req = createMockRequest({
        "x-forwarded-for": "10.0.0.1",
        "x-real-ip": "10.0.0.2",
      });

      const context = getAuditContext(req);
      expect(context.ip).toBe("10.0.0.1");
    });

    it("extracts user agent", () => {
      const req = createMockRequest({
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      });

      const context = getAuditContext(req);
      expect(context.userAgent).toBe("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    });

    it("returns undefined for missing headers", () => {
      const req = createMockRequest({});

      const context = getAuditContext(req);
      expect(context.ip).toBeUndefined();
      expect(context.userAgent).toBeUndefined();
    });

    it("trims whitespace from x-forwarded-for first IP", () => {
      const req = createMockRequest({
        "x-forwarded-for": "  203.0.113.195 , 70.41.3.18",
      });

      const context = getAuditContext(req);
      expect(context.ip).toBe("203.0.113.195");
    });
  });

  describe("Timestamp format", () => {
    it("uses ISO 8601 format for timestamps", () => {
      const user = createMockUser();

      audit("diagram.create", user, "d-1");

      const entries = getAuditLog();
      const timestamp = entries[0].timestamp;

      // Should be valid ISO 8601
      const parsed = new Date(timestamp);
      expect(parsed.toISOString()).toBe(timestamp);
    });

    it("timestamps are within reasonable range", () => {
      const user = createMockUser();
      const before = Date.now();

      audit("diagram.create", user, "d-1");

      const after = Date.now();
      const entries = getAuditLog();
      const entryTime = new Date(entries[0].timestamp).getTime();

      expect(entryTime).toBeGreaterThanOrEqual(before);
      expect(entryTime).toBeLessThanOrEqual(after);
    });
  });

  describe("Console logging", () => {
    it("logs to console in structured JSON format", () => {
      const user = createMockUser();
      const originalLog = console.log;
      let loggedMessage: string | undefined;

      console.log = (msg: string) => {
        loggedMessage = msg;
      };

      try {
        audit("diagram.create", user, "d-1");

        expect(loggedMessage).toBeDefined();
        const parsed = JSON.parse(loggedMessage!);
        expect(parsed.level).toBe("audit");
        expect(parsed.action).toBe("diagram.create");
        expect(parsed.userId).toBe("test-user-123");
        expect(parsed.resourceId).toBe("d-1");
      } finally {
        console.log = originalLog;
      }
    });
  });
});
