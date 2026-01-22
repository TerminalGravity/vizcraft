/**
 * Cache Module Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { LRUCache, generateETag, matchesETag, svgCache, diagramCache, listCache } from "./cache";

describe("LRUCache", () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    cache = new LRUCache<string>({ maxEntries: 3, ttlMs: 1000 });
  });

  it("stores and retrieves values", () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("returns undefined for missing keys", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("evicts LRU entries when max entries exceeded", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    // Access 'a' to make it recently used
    cache.get("a");

    // Add one more, should evict 'b' (least recently used)
    cache.set("d", "4");

    expect(cache.get("a")).toBe("1"); // Still exists (recently accessed)
    expect(cache.get("b")).toBeUndefined(); // Evicted
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
  });

  it("expires entries after TTL", async () => {
    const shortCache = new LRUCache<string>({ ttlMs: 50 });
    shortCache.set("key", "value");

    expect(shortCache.get("key")).toBe("value");

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(shortCache.get("key")).toBeUndefined();
  });

  it("deletes entries", () => {
    cache.set("key", "value");
    expect(cache.delete("key")).toBe(true);
    expect(cache.get("key")).toBeUndefined();
    expect(cache.delete("key")).toBe(false);
  });

  it("clears all entries", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("invalidates entries matching pattern", () => {
    cache.set("prefix:a", "1");
    cache.set("prefix:b", "2");
    cache.set("other:c", "3");

    const count = cache.invalidatePattern(/^prefix:/);

    expect(count).toBe(2);
    expect(cache.get("prefix:a")).toBeUndefined();
    expect(cache.get("prefix:b")).toBeUndefined();
    expect(cache.get("other:c")).toBe("3");
  });

  it("tracks hit/miss statistics", () => {
    cache.set("key", "value");

    cache.get("key"); // Hit
    cache.get("key"); // Hit
    cache.get("missing"); // Miss

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.667, 2);
  });

  it("tracks evictions in stats", () => {
    // Fill cache to capacity
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    // This should trigger eviction
    cache.set("d", "4");

    const stats = cache.getStats();
    expect(stats.evictions).toBeGreaterThan(0);
  });

  it("batch evicts multiple entries when configured", () => {
    // Create cache with 50% batch eviction for easier testing
    const batchCache = new LRUCache<string>({
      maxEntries: 10,
      ttlMs: 60000,
      evictionBatchPercent: 0.5,
    });

    // Fill cache to capacity
    for (let i = 0; i < 10; i++) {
      batchCache.set(`key${i}`, `value${i}`);
    }

    // Access some keys to make them "hot"
    batchCache.get("key8");
    batchCache.get("key9");

    // Add one more to trigger batch eviction (should evict 5 entries)
    batchCache.set("key10", "value10");

    const stats = batchCache.getStats();
    // With 50% eviction, should have evicted 5 entries
    expect(stats.evictions).toBe(5);
    // Hot keys should still exist
    expect(batchCache.get("key8")).toBe("value8");
    expect(batchCache.get("key9")).toBe("value9");
    expect(batchCache.get("key10")).toBe("value10");
  });

  it("checks existence with has()", () => {
    cache.set("key", "value");
    expect(cache.has("key")).toBe(true);
    expect(cache.has("nonexistent")).toBe(false);
  });
});

describe("ETag utilities", () => {
  it("generates consistent ETags for same data", () => {
    const data = { foo: "bar", num: 42 };
    const etag1 = generateETag(data);
    const etag2 = generateETag(data);
    expect(etag1).toBe(etag2);
  });

  it("generates different ETags for different data", () => {
    const etag1 = generateETag({ foo: "bar" });
    const etag2 = generateETag({ foo: "baz" });
    expect(etag1).not.toBe(etag2);
  });

  it("ETags are properly quoted", () => {
    const etag = generateETag({ test: true });
    expect(etag.startsWith('"')).toBe(true);
    expect(etag.endsWith('"')).toBe(true);
  });

  it("matches ETag correctly", () => {
    const etag = '"abc123"';
    expect(matchesETag('"abc123"', etag)).toBe(true);
    expect(matchesETag('"xyz789"', etag)).toBe(false);
    expect(matchesETag(null, etag)).toBe(false);
  });

  it("matches wildcard ETag", () => {
    expect(matchesETag("*", '"any"')).toBe(true);
  });

  it("matches ETags in comma-separated list", () => {
    const etag = '"abc123"';
    expect(matchesETag('"xyz", "abc123", "def"', etag)).toBe(true);
    expect(matchesETag('"xyz", "def"', etag)).toBe(false);
  });
});

describe("Global Cache Instances", () => {
  it("exports diagramCache", () => {
    expect(diagramCache).toBeDefined();
    const stats = diagramCache.getStats();
    expect(stats).toHaveProperty("entries");
    expect(stats).toHaveProperty("sizeBytes");
    expect(stats).toHaveProperty("hitRate");
  });

  it("exports listCache", () => {
    expect(listCache).toBeDefined();
    const stats = listCache.getStats();
    expect(stats).toHaveProperty("entries");
    expect(stats).toHaveProperty("hitRate");
  });

  it("exports svgCache for SVG export caching", () => {
    expect(svgCache).toBeDefined();
    const stats = svgCache.getStats();
    expect(stats).toHaveProperty("entries");
    expect(stats).toHaveProperty("sizeBytes");
  });

  it("svgCache stores and retrieves SVG strings", () => {
    const testKey = "svg:test-123:1";
    const testSvg = "<svg><rect/></svg>";

    svgCache.set(testKey, testSvg);
    expect(svgCache.get(testKey)).toBe(testSvg);

    // Cleanup
    svgCache.delete(testKey);
  });

  it("svgCache supports invalidatePattern for cleanup", () => {
    svgCache.set("svg:diagram-a:1", "<svg>a</svg>");
    svgCache.set("svg:diagram-a:2", "<svg>a2</svg>");
    svgCache.set("svg:diagram-b:1", "<svg>b</svg>");

    // Invalidate all versions of diagram-a
    svgCache.invalidatePattern(/^svg:diagram-a:/);

    expect(svgCache.get("svg:diagram-a:1")).toBeUndefined();
    expect(svgCache.get("svg:diagram-a:2")).toBeUndefined();
    expect(svgCache.get("svg:diagram-b:1")).toBe("<svg>b</svg>");

    // Cleanup
    svgCache.delete("svg:diagram-b:1");
  });
});
