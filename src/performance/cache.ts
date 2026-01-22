/**
 * In-Memory Cache with LRU Eviction
 *
 * Provides fast access to frequently requested data with
 * automatic eviction when cache size exceeds limits.
 */

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
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxEntries: number;
  private maxSizeBytes: number;
  private ttlMs: number;
  private currentSizeBytes = 0;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.maxSizeBytes = options.maxSizeBytes ?? 50 * 1024 * 1024; // 50MB default
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000; // 5 minutes default
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

    // Evict if necessary
    while (
      (this.cache.size >= this.maxEntries || this.currentSizeBytes + size > this.maxSizeBytes) &&
      this.cache.size > 0
    ) {
      this.evictLRU();
    }

    // Delete existing entry if present
    if (this.cache.has(key)) {
      this.delete(key);
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
  } {
    const total = this.hits + this.misses;
    return {
      entries: this.cache.size,
      sizeBytes: this.currentSizeBytes,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruScore = Infinity;

    for (const [key, entry] of this.cache) {
      // LRU score: lower is older/less accessed
      const score = entry.lastAccess + entry.accessCount * 1000;
      if (score < lruScore) {
        lruScore = score;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.delete(lruKey);
    }
  }

  private estimateSize(value: T): number {
    try {
      return JSON.stringify(value).length * 2; // Rough byte estimate
    } catch {
      return 1024; // Default 1KB for non-serializable
    }
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
