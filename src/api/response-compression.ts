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
 * Content types that SHOULD be compressed (text-based formats)
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
 * Content types that should NEVER be compressed (already compressed or binary)
 * Attempting to compress these wastes CPU and may increase size
 */
const INCOMPRESSIBLE_TYPES = new Set([
  // Already compressed images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  // Already compressed archives
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-bzip2",
  "application/x-7z-compressed",
  // Already compressed documents
  "application/pdf",
  // Audio/video (already compressed)
  "audio/mpeg",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  // Fonts (already compressed)
  "font/woff",
  "font/woff2",
  "application/font-woff",
  "application/font-woff2",
]);

/**
 * Check if a content type should be compressed
 */
function isCompressible(contentType: string | null): boolean {
  if (!contentType) return false;
  // Extract base type without charset (split always returns at least one element)
  const baseType = (contentType.split(";")[0] ?? "").trim().toLowerCase();

  // Explicitly reject incompressible types (already compressed formats)
  if (INCOMPRESSIBLE_TYPES.has(baseType)) return false;

  // Only compress known compressible types
  return COMPRESSIBLE_TYPES.has(baseType);
}

/**
 * Check if content type is explicitly incompressible (already compressed)
 */
export function isIncompressible(contentType: string | null): boolean {
  if (!contentType) return false;
  const baseType = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return INCOMPRESSIBLE_TYPES.has(baseType);
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
 * Response compression with content-type filtering
 *
 * Wraps Hono's compress middleware to skip already-compressed formats
 * like PNG, JPEG, PDF, etc. that would waste CPU without benefit.
 *
 * The approach: we run the handler first (via next()), then check if
 * the response should be compressed based on content type and size.
 * For compressible content, we manually compress using CompressionStream.
 */
export function responseCompression(
  config: Partial<CompressionConfig> = {}
): (c: Context, next: Next) => Promise<void | Response> {
  const fullConfig = { ...DEFAULT_COMPRESSION_CONFIG, ...config };

  return async (c: Context, next: Next) => {
    // Check if client accepts gzip
    const acceptEncoding = c.req.header("Accept-Encoding") || "";
    const supportsGzip = acceptEncoding.includes("gzip");

    if (!supportsGzip) {
      return next();
    }

    await next();

    // Get response content type
    const contentType = c.res.headers.get("Content-Type");

    // Skip compression for already-compressed binary formats
    if (isIncompressible(contentType)) {
      return;
    }

    // Skip if already has Content-Encoding
    if (c.res.headers.get("Content-Encoding")) {
      return;
    }

    // Only compress known compressible types
    if (!isCompressible(contentType)) {
      return;
    }

    // Get response body
    const originalResponse = c.res;
    const body = await originalResponse.clone().arrayBuffer();

    // Skip if content is too small
    if (body.byteLength < fullConfig.threshold) {
      return;
    }

    // Compress using CompressionStream
    try {
      const stream = new Blob([body]).stream();
      const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
      const compressedBlob = await new Response(compressedStream).blob();
      const compressedBuffer = await compressedBlob.arrayBuffer();

      // Only use compressed version if it's actually smaller
      if (compressedBuffer.byteLength >= body.byteLength) {
        return; // Compression didn't help, keep original
      }

      // Create new response with compressed body
      const newHeaders = new Headers(originalResponse.headers);
      newHeaders.set("Content-Encoding", "gzip");
      newHeaders.set("Content-Length", compressedBuffer.byteLength.toString());
      newHeaders.append("Vary", "Accept-Encoding");

      c.res = new Response(compressedBuffer, {
        status: originalResponse.status,
        statusText: originalResponse.statusText,
        headers: newHeaders,
      });
    } catch (_err) {
      // Compression failed, keep original response
      // This can happen if CompressionStream is not available
    }
  };
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
  incompressibleTypes: string[];
  threshold: number;
  supportedEncodings: string[];
} {
  return {
    compressibleTypes: Array.from(COMPRESSIBLE_TYPES),
    incompressibleTypes: Array.from(INCOMPRESSIBLE_TYPES),
    threshold: DEFAULT_COMPRESSION_CONFIG.threshold,
    supportedEncodings: DEFAULT_COMPRESSION_CONFIG.encodings,
  };
}
