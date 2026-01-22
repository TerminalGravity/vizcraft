/**
 * Cache Module Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { LRUCache, generateETag, matchesETag } from "./cache";

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
