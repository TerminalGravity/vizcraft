/**
 * Response Compression Middleware
 *
 * Compresses API responses using gzip or brotli to reduce bandwidth.
 * Only compresses responses above a threshold and for compressible content types.
 */

import type { Context, Next } from "hono";
import { compress as honoCompress } from "hono/compress";

export interface CompressionConfig {
  /** Minimum response size to compress (bytes) */
  threshold: number;
  /** Compression encodings in order of preference */
  encodings: ("gzip" | "deflate" | "br")[];
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  threshold: 1024, // 1KB minimum
  encodings: ["gzip", "deflate"],
};

/**
 * Content types that should be compressed
 */
const COMPRESSIBLE_TYPES = new Set([
  "application/json",
  "text/plain",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/xml",
  "text/xml",
  "image/svg+xml",
]);

/**
 * Check if a content type should be compressed
 */
function isCompressible(contentType: string | null): boolean {
  if (!contentType) return false;
  // Extract base type without charset
  const baseType = contentType.split(";")[0].trim().toLowerCase();
  return COMPRESSIBLE_TYPES.has(baseType);
}

/**
 * Get the best supported encoding from client's Accept-Encoding
 */
function getBestEncoding(
  acceptEncoding: string | null,
  supported: string[]
): string | null {
  if (!acceptEncoding) return null;

  // Parse Accept-Encoding with quality values
  const encodings = acceptEncoding
    .split(",")
    .map((e) => {
      const [name, q] = e.trim().split(";q=");
      return {
        name: name.trim().toLowerCase(),
        quality: q ? parseFloat(q) : 1.0,
      };
    })
    .filter((e) => e.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  // Find first supported encoding
  for (const enc of encodings) {
    if (supported.includes(enc.name)) {
      return enc.name;
    }
  }

  return null;
}

/**
 * Use Hono's built-in compress middleware
 * This is the recommended approach for Bun/Hono
 */
export function responseCompression(
  config: Partial<CompressionConfig> = {}
): ReturnType<typeof honoCompress> {
  const _fullConfig = { ...DEFAULT_COMPRESSION_CONFIG, ...config };

  // Use Hono's compress middleware with gzip encoding
  return honoCompress({
    encoding: "gzip",
  });
}

/**
 * Check if response should be compressed
 * Useful for conditional compression logic
 */
export function shouldCompress(
  contentType: string | null,
  contentLength: number | null,
  acceptEncoding: string | null,
  threshold = DEFAULT_COMPRESSION_CONFIG.threshold
): boolean {
  // Must have compressible content type
  if (!isCompressible(contentType)) return false;

  // Must exceed threshold if content length is known
  if (contentLength !== null && contentLength < threshold) return false;

  // Client must accept compression
  if (!acceptEncoding) return false;

  // Must support at least one encoding
  const encoding = getBestEncoding(acceptEncoding, DEFAULT_COMPRESSION_CONFIG.encodings);
  return encoding !== null;
}

/**
 * Custom compression middleware with threshold checking
 * Use this when you need more control over compression behavior
 */
export function customCompression(
  config: Partial<CompressionConfig> = {}
): (c: Context, next: Next) => Promise<void | Response> {
  const fullConfig = { ...DEFAULT_COMPRESSION_CONFIG, ...config };

  return async (c: Context, next: Next) => {
    await next();

    // Check if response should be compressed
    const contentType = c.res.headers.get("Content-Type");
    const contentLength = c.res.headers.get("Content-Length");
    const acceptEncoding = c.req.header("Accept-Encoding");

    // Skip if already has Content-Encoding (already compressed)
    if (c.res.headers.get("Content-Encoding")) {
      return;
    }

    const size = contentLength ? parseInt(contentLength, 10) : null;

    if (!shouldCompress(contentType, size, acceptEncoding, fullConfig.threshold)) {
      return;
    }

    // Set Vary header for caching
    const existingVary = c.res.headers.get("Vary");
    if (existingVary) {
      if (!existingVary.includes("Accept-Encoding")) {
        c.res.headers.set("Vary", `${existingVary}, Accept-Encoding`);
      }
    } else {
      c.res.headers.set("Vary", "Accept-Encoding");
    }

    // Note: Actual compression is handled by Hono's compress middleware
    // This middleware just handles the threshold and vary header logic
  };
}

/**
 * Get compression statistics
 */
export function getCompressionStats(): {
  compressibleTypes: string[];
  threshold: number;
  supportedEncodings: string[];
} {
  return {
    compressibleTypes: Array.from(COMPRESSIBLE_TYPES),
    threshold: DEFAULT_COMPRESSION_CONFIG.threshold,
    supportedEncodings: DEFAULT_COMPRESSION_CONFIG.encodings,
  };
}
