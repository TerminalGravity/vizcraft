/**
 * In-Memory Cache with LRU Eviction
 *
 * Provides fast access to frequently requested data with
 * automatic eviction when cache size exceeds limits.
 */

// V8 object overhead constants (approximate)
const OBJECT_OVERHEAD = 32; // Hidden class pointer + properties backing store
const ARRAY_OVERHEAD = 24;  // Length + element backing store pointer
const MAP_ENTRY_OVERHEAD = 16; // Key + value pointers
const STRING_OVERHEAD = 20; // V8 string header

/**
 * Estimate the memory size of any JavaScript value in bytes.
 * Handles circular references via WeakSet tracking.
 * More accurate than JSON.stringify().length for memory management.
 */
export function estimateObjectSize(value: unknown, seen?: WeakSet<object>): number {
  // Handle primitives
  if (value === null || value === undefined) {
    return 0;
  }

  const type = typeof value;

  if (type === "boolean") {
    return 4; // V8 uses 4 bytes for booleans
  }

  if (type === "number") {
    return 8; // IEEE 754 double
  }

  if (type === "string") {
    // V8 strings: header + 2 bytes per character (UTF-16)
    return STRING_OVERHEAD + (value as string).length * 2;
  }

  if (type === "bigint") {
    // BigInt: overhead + digits
    const str = (value as bigint).toString();
    return 16 + Math.ceil(str.length / 9) * 8;
  }

  if (type === "symbol" || type === "function") {
    return 64; // Rough estimate for functions/symbols
  }

  // Handle objects (arrays, plain objects, Maps, Sets, etc.)
  if (type === "object") {
    // Initialize seen set for circular reference detection
    const seenSet = seen ?? new WeakSet<object>();

    // Circular reference check
    if (seenSet.has(value as object)) {
      return 0; // Already counted
    }
    seenSet.add(value as object);

    // Arrays
    if (Array.isArray(value)) {
      let size = ARRAY_OVERHEAD;
      for (const item of value) {
        size += estimateObjectSize(item, seenSet);
      }
      return size;
    }

    // Maps
    if (value instanceof Map) {
      let size = OBJECT_OVERHEAD;
      for (const [k, v] of value) {
        size += MAP_ENTRY_OVERHEAD + estimateObjectSize(k, seenSet) + estimateObjectSize(v, seenSet);
      }
      return size;
    }

    // Sets
    if (value instanceof Set) {
      let size = OBJECT_OVERHEAD;
      for (const item of value) {
        size += MAP_ENTRY_OVERHEAD + estimateObjectSize(item, seenSet);
      }
      return size;
    }

    // Date
    if (value instanceof Date) {
      return 32; // Object overhead + timestamp
    }

    // ArrayBuffer / TypedArrays
    if (value instanceof ArrayBuffer) {
      return (value as ArrayBuffer).byteLength + 16;
    }
    if (ArrayBuffer.isView(value)) {
      return (value as ArrayBufferView).byteLength + 24;
    }

    // Plain objects
    let size = OBJECT_OVERHEAD;
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        size += STRING_OVERHEAD + key.length * 2; // Key
        size += estimateObjectSize((value as Record<string, unknown>)[key], seenSet); // Value
      }
    }
    return size;
  }

  // Unknown type fallback
  return 64;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  accessCount: number;
  lastAccess: number;
  size: number;
}

interface CacheOptions {
  maxEntries?: number;
  maxSizeBytes?: number;
  ttlMs?: number;
  /** Percentage of entries to evict at once (0.1 = 10%). Higher = less frequent evictions. */
  evictionBatchPercent?: number;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxEntries: number;
  private maxSizeBytes: number;
  private ttlMs: number;
  private evictionBatchPercent: number;
  private currentSizeBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: CacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.maxSizeBytes = options.maxSizeBytes ?? 50 * 1024 * 1024; // 50MB default
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000; // 5 minutes default
    // Batch eviction: evict 10% of entries at once to reduce O(n) iterations
    this.evictionBatchPercent = options.evictionBatchPercent ?? 0.1;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.delete(key);
      this.misses++;
      return undefined;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccess = Date.now();
    this.hits++;

    return entry.value;
  }

  set(key: string, value: T, sizeBytes?: number): void {
    // Estimate size if not provided
    const size = sizeBytes ?? this.estimateSize(value);

    // Delete existing entry if present (before checking limits)
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // Batch eviction: evict multiple entries at once to reduce O(n) iterations
    // This changes amortized cost from O(n) per insert to O(1) per insert
    if (this.cache.size >= this.maxEntries || this.currentSizeBytes + size > this.maxSizeBytes) {
      this.evictBatch();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccess: Date.now(),
      size,
    };

    this.cache.set(key, entry);
    this.currentSizeBytes += size;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSizeBytes -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.currentSizeBytes = 0;
  }

  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.delete(key);
        count++;
      }
    }
    return count;
  }

  getStats(): {
    entries: number;
    sizeBytes: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
  } {
    const total = this.hits + this.misses;
    return {
      entries: this.cache.size,
      sizeBytes: this.currentSizeBytes,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
    };
  }

  /**
   * Evict a batch of LRU entries at once.
   * This is more efficient than evicting one at a time because we do
   * one O(n) pass to find the bottom X% instead of O(n) per eviction.
   */
  private evictBatch(): void {
    const size = this.cache.size;
    if (size === 0) return;

    // Calculate how many to evict (at least 1)
    const toEvict = Math.max(1, Math.floor(size * this.evictionBatchPercent));

    // Score all entries in one pass - O(n)
    const scored: Array<{ key: string; score: number }> = [];
    for (const [key, entry] of this.cache) {
      // LRU score: lower is older/less accessed
      const score = entry.lastAccess + entry.accessCount * 1000;
      scored.push({ key, score });
    }

    // Partial sort to find the lowest-scored entries
    // For small batches, this is faster than full sort
    scored.sort((a, b) => a.score - b.score);

    // Evict the lowest-scored entries
    for (let i = 0; i < toEvict && i < scored.length; i++) {
      const entry = scored[i];
      if (entry) {
        this.delete(entry.key);
        this.evictions++;
      }
    }
  }

  /**
   * Estimate the memory size of a value in bytes.
   * Uses type-aware estimation that handles circular references
   * without the overhead of JSON.stringify.
   */
  private estimateSize(value: T): number {
    return estimateObjectSize(value);
  }
}

/**
 * Generate ETag for response caching
 */
export function generateETag(data: unknown): string {
  const str = JSON.stringify(data);
  // Simple hash function for ETag
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `"${Math.abs(hash).toString(36)}"`;
}

/**
 * Check if ETag matches for conditional requests
 */
export function matchesETag(requestETag: string | null, currentETag: string): boolean {
  if (!requestETag) return false;
  // Handle If-None-Match with multiple ETags
  const tags = requestETag.split(",").map((t) => t.trim());
  return tags.includes(currentETag) || tags.includes("*");
}

// Global cache instances
export const diagramCache = new LRUCache<unknown>({
  maxEntries: 500,
  maxSizeBytes: 100 * 1024 * 1024, // 100MB for diagrams
  ttlMs: 10 * 60 * 1000, // 10 minutes
});

export const versionCache = new LRUCache<unknown>({
  maxEntries: 1000,
  maxSizeBytes: 50 * 1024 * 1024, // 50MB for versions
  ttlMs: 5 * 60 * 1000, // 5 minutes
});

export const listCache = new LRUCache<unknown>({
  maxEntries: 100,
  maxSizeBytes: 10 * 1024 * 1024, // 10MB for list results
  ttlMs: 30 * 1000, // 30 seconds (lists change frequently)
});

// SVG export cache - keyed by diagramId:version for automatic invalidation
export const svgCache = new LRUCache<string>({
  maxEntries: 200,
  maxSizeBytes: 20 * 1024 * 1024, // 20MB for SVG strings (avg 100KB per SVG)
  ttlMs: 5 * 60 * 1000, // 5 minutes
});
