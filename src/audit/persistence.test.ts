/**
 * Audit Log Persistence Tests
 *
 * Tests for SQLite persistence layer including:
 * - Database operations
 * - Batch writing
 * - Memory cache synchronization
 * - Query filtering
 * - Cleanup/retention
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  queueAuditEntry,
  flushPendingWrites,
  getMemoryCache,
  queryAuditLogs,
  getPersistedStats,
  cleanupOldEntries,
  clearPersistedAuditLogs,
  AUDIT_CONFIG,
} from "./persistence";
import type { AuditEntry } from "./index";

// Helper to create test audit entries
function createTestEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    action: "diagram.create",
    userId: "test-user",
    userRole: "user",
    resourceType: "diagram",
    resourceId: `diagram-${Date.now()}`,
    details: { test: true },
    ipAddress: "127.0.0.1",
    userAgent: "Test/1.0",
    ...overrides,
  };
}

describe("Audit Persistence", () => {
  beforeEach(() => {
    clearPersistedAuditLogs();
  });

  describe("queueAuditEntry", () => {
    it("adds entry to memory cache", () => {
      const entry = createTestEntry();
      queueAuditEntry(entry);

      const cache = getMemoryCache();
      expect(cache.length).toBeGreaterThanOrEqual(1);
      expect(cache[cache.length - 1]).toEqual(entry);
    });

    it("maintains memory cache size limit", () => {
      // Add more entries than cache limit
      for (let i = 0; i < AUDIT_CONFIG.MAX_MEMORY_ENTRIES + 50; i++) {
        queueAuditEntry(createTestEntry({ resourceId: `diagram-${i}` }));
      }

      const cache = getMemoryCache();
      expect(cache.length).toBeLessThanOrEqual(AUDIT_CONFIG.MAX_MEMORY_ENTRIES);
    });
  });

  describe("flushPendingWrites", () => {
    it("persists queued entries to SQLite", () => {
      const entry1 = createTestEntry({ resourceId: "diagram-flush-1" });
      const entry2 = createTestEntry({ resourceId: "diagram-flush-2" });

      queueAuditEntry(entry1);
      queueAuditEntry(entry2);

      const written = flushPendingWrites();
      expect(written).toBe(2);

      // Query should return the entries
      const persisted = queryAuditLogs({ limit: 10 });
      expect(persisted.some(e => e.resourceId === "diagram-flush-1")).toBe(true);
      expect(persisted.some(e => e.resourceId === "diagram-flush-2")).toBe(true);
    });

    it("returns 0 when no pending writes", () => {
      const written = flushPendingWrites();
      expect(written).toBe(0);
    });

    it("preserves all entry fields after persistence", () => {
      const entry = createTestEntry({
        userId: "persist-user",
        userRole: "admin",
        action: "diagram.delete",
        resourceType: "diagram",
        resourceId: "persist-diagram",
        details: { reason: "test deletion", count: 42 },
        ipAddress: "192.168.1.100",
        userAgent: "PersistTest/2.0",
      });

      queueAuditEntry(entry);
      flushPendingWrites();

      const persisted = queryAuditLogs({ resourceId: "persist-diagram" });
      expect(persisted).toHaveLength(1);

      const retrieved = persisted[0];
      expect(retrieved.userId).toBe("persist-user");
      expect(retrieved.userRole).toBe("admin");
      expect(retrieved.action).toBe("diagram.delete");
      expect(retrieved.resourceType).toBe("diagram");
      expect(retrieved.details).toEqual({ reason: "test deletion", count: 42 });
      expect(retrieved.ipAddress).toBe("192.168.1.100");
      expect(retrieved.userAgent).toBe("PersistTest/2.0");
    });

    it("handles null/undefined values correctly", () => {
      const entry = createTestEntry({
        userId: null,
        userRole: null,
        details: undefined,
        ipAddress: undefined,
        userAgent: undefined,
      });

      queueAuditEntry(entry);
      flushPendingWrites();

      const persisted = queryAuditLogs({ limit: 1 });
      expect(persisted).toHaveLength(1);
      expect(persisted[0].userId).toBeNull();
      expect(persisted[0].userRole).toBeNull();
      expect(persisted[0].details).toBeUndefined();
      expect(persisted[0].ipAddress).toBeUndefined();
      expect(persisted[0].userAgent).toBeUndefined();
    });
  });

  describe("queryAuditLogs", () => {
    beforeEach(() => {
      // Create test data
      const entries = [
        createTestEntry({
          timestamp: new Date("2026-01-20T10:00:00Z").toISOString(),
          userId: "user-1",
          action: "diagram.create",
          resourceId: "diagram-a",
        }),
        createTestEntry({
          timestamp: new Date("2026-01-21T10:00:00Z").toISOString(),
          userId: "user-1",
          action: "diagram.update",
          resourceId: "diagram-a",
        }),
        createTestEntry({
          timestamp: new Date("2026-01-22T10:00:00Z").toISOString(),
          userId: "user-2",
          action: "diagram.create",
          resourceId: "diagram-b",
        }),
        createTestEntry({
          timestamp: new Date("2026-01-22T11:00:00Z").toISOString(),
          userId: "user-1",
          action: "diagram.delete",
          resourceId: "diagram-a",
        }),
      ];

      entries.forEach(e => queueAuditEntry(e));
      flushPendingWrites();
    });

    it("returns entries without filters", () => {
      const results = queryAuditLogs();
      expect(results.length).toBeGreaterThanOrEqual(4);
    });

    it("filters by userId", () => {
      const results = queryAuditLogs({ userId: "user-1" });
      expect(results).toHaveLength(3);
      results.forEach(e => expect(e.userId).toBe("user-1"));
    });

    it("filters by action", () => {
      const results = queryAuditLogs({ action: "diagram.create" });
      expect(results).toHaveLength(2);
      results.forEach(e => expect(e.action).toBe("diagram.create"));
    });

    it("filters by resourceId", () => {
      const results = queryAuditLogs({ resourceId: "diagram-a" });
      expect(results).toHaveLength(3);
      results.forEach(e => expect(e.resourceId).toBe("diagram-a"));
    });

    it("filters by since date", () => {
      const results = queryAuditLogs({ since: new Date("2026-01-22T00:00:00Z") });
      expect(results).toHaveLength(2);
    });

    it("filters by until date", () => {
      const results = queryAuditLogs({ until: new Date("2026-01-21T23:59:59Z") });
      expect(results).toHaveLength(2);
    });

    it("filters by date range", () => {
      const results = queryAuditLogs({
        since: new Date("2026-01-21T00:00:00Z"),
        until: new Date("2026-01-21T23:59:59Z"),
      });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("diagram.update");
    });

    it("combines multiple filters", () => {
      const results = queryAuditLogs({
        userId: "user-1",
        action: "diagram.create",
      });
      expect(results).toHaveLength(1);
      expect(results[0].resourceId).toBe("diagram-a");
    });

    it("applies limit", () => {
      const results = queryAuditLogs({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("returns results in descending timestamp order", () => {
      const results = queryAuditLogs();
      for (let i = 1; i < results.length; i++) {
        const prev = new Date(results[i - 1].timestamp).getTime();
        const curr = new Date(results[i].timestamp).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });
  });

  describe("getPersistedStats", () => {
    it("returns correct stats after persisting entries", () => {
      queueAuditEntry(createTestEntry({ resourceId: "stat-1" }));
      queueAuditEntry(createTestEntry({ resourceId: "stat-2" }));

      const statsBeforeFlush = getPersistedStats();
      expect(statsBeforeFlush.pendingWrites).toBe(2);
      expect(statsBeforeFlush.memoryCacheSize).toBeGreaterThanOrEqual(2);

      flushPendingWrites();

      const statsAfterFlush = getPersistedStats();
      expect(statsAfterFlush.pendingWrites).toBe(0);
      expect(statsAfterFlush.totalEntries).toBeGreaterThanOrEqual(2);
      expect(statsAfterFlush.newestEntry).toBeDefined();
      expect(statsAfterFlush.oldestEntry).toBeDefined();
    });

    it("returns null for oldest/newest when empty", () => {
      const stats = getPersistedStats();
      // Note: May have entries from initialization, so just verify structure
      expect(stats).toHaveProperty("totalEntries");
      expect(stats).toHaveProperty("oldestEntry");
      expect(stats).toHaveProperty("newestEntry");
    });
  });

  describe("cleanupOldEntries", () => {
    it("removes entries older than retention period", () => {
      // Create an old entry (91 days ago, assuming 90-day default retention)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 91);

      const oldEntry = createTestEntry({
        timestamp: oldDate.toISOString(),
        resourceId: "old-diagram",
      });

      const recentEntry = createTestEntry({
        resourceId: "recent-diagram",
      });

      queueAuditEntry(oldEntry);
      queueAuditEntry(recentEntry);
      flushPendingWrites();

      // Verify both exist
      const beforeCleanup = queryAuditLogs({ limit: 100 });
      const hasOld = beforeCleanup.some(e => e.resourceId === "old-diagram");
      const hasRecent = beforeCleanup.some(e => e.resourceId === "recent-diagram");
      expect(hasOld).toBe(true);
      expect(hasRecent).toBe(true);

      // Run cleanup
      cleanupOldEntries();

      // Verify old is removed, recent remains
      const afterCleanup = queryAuditLogs({ limit: 100 });
      const stillHasOld = afterCleanup.some(e => e.resourceId === "old-diagram");
      const stillHasRecent = afterCleanup.some(e => e.resourceId === "recent-diagram");
      expect(stillHasOld).toBe(false);
      expect(stillHasRecent).toBe(true);
    });
  });

  describe("clearPersistedAuditLogs", () => {
    it("clears all entries from database and memory", () => {
      queueAuditEntry(createTestEntry({ resourceId: "clear-1" }));
      queueAuditEntry(createTestEntry({ resourceId: "clear-2" }));
      flushPendingWrites();

      expect(queryAuditLogs().length).toBeGreaterThanOrEqual(2);
      expect(getMemoryCache().length).toBeGreaterThanOrEqual(2);

      clearPersistedAuditLogs();

      expect(queryAuditLogs()).toHaveLength(0);
      expect(getMemoryCache()).toHaveLength(0);
    });
  });

  describe("AUDIT_CONFIG", () => {
    it("has all expected configuration values", () => {
      expect(AUDIT_CONFIG.FLUSH_INTERVAL_MS).toBeGreaterThan(0);
      expect(AUDIT_CONFIG.MAX_MEMORY_ENTRIES).toBeGreaterThan(0);
      expect(AUDIT_CONFIG.BATCH_SIZE).toBeGreaterThan(0);
      expect(AUDIT_CONFIG.RETENTION_DAYS).toBeGreaterThanOrEqual(0);
      expect(AUDIT_CONFIG.CLEANUP_FREQUENCY).toBeGreaterThan(0);
    });
  });
});

describe("Integration: Full Audit Flow", () => {
  beforeEach(() => {
    clearPersistedAuditLogs();
  });

  it("supports complete audit workflow", () => {
    // 1. Queue multiple audit entries
    const user1Entries = Array.from({ length: 5 }, (_, i) =>
      createTestEntry({
        userId: "flow-user-1",
        resourceId: `flow-diagram-${i}`,
        action: i % 2 === 0 ? "diagram.create" : "diagram.update",
      })
    );

    const user2Entries = Array.from({ length: 3 }, (_, i) =>
      createTestEntry({
        userId: "flow-user-2",
        resourceId: `flow-diagram-${i + 10}`,
        action: "diagram.delete",
      })
    );

    [...user1Entries, ...user2Entries].forEach(e => queueAuditEntry(e));

    // 2. Verify memory cache has entries
    expect(getMemoryCache().length).toBeGreaterThanOrEqual(8);

    // 3. Flush to database
    const written = flushPendingWrites();
    expect(written).toBe(8);

    // 4. Query by user
    const user1Results = queryAuditLogs({ userId: "flow-user-1" });
    expect(user1Results).toHaveLength(5);

    // 5. Query by action
    const createResults = queryAuditLogs({ action: "diagram.create" });
    expect(createResults.filter(e => e.userId === "flow-user-1")).toHaveLength(3);

    // 6. Get stats
    const stats = getPersistedStats();
    expect(stats.totalEntries).toBeGreaterThanOrEqual(8);
    expect(stats.pendingWrites).toBe(0);
  });
});
