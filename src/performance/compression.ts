/**
 * Diagram Compression Utilities
 *
 * Compresses large diagram specs for efficient storage and transfer.
 * Uses Bun's built-in gzip compression.
 */

import type { DiagramSpec } from "../types";
import { createLogger } from "../logging";
import { safeParseSpec } from "../validation/schemas";

const log = createLogger("compression");

const COMPRESSION_THRESHOLD = 10 * 1024; // 10KB - compress specs larger than this

/** Maximum allowed decompressed size (50MB) - prevents decompression bomb attacks */
const MAX_DECOMPRESSED_SIZE = 50 * 1024 * 1024;

/** Error thrown when decompressed data exceeds size limit */
export class DecompressionLimitError extends Error {
  constructor(size: number, limit: number) {
    super(`Decompressed data exceeds limit: ${size} bytes > ${limit} bytes`);
    this.name = "DecompressionLimitError";
  }
}

/**
 * Compress a diagram spec if it exceeds threshold
 * Returns base64-encoded gzip data prefixed with 'gz:' or original JSON
 */
export async function compressSpec(spec: DiagramSpec): Promise<string> {
  const json = JSON.stringify(spec);

  if (json.length < COMPRESSION_THRESHOLD) {
    return json;
  }

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(json);

    // Use CompressionStream for gzip
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();

    const compressedChunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      compressedChunks.push(value);
    }

    // Combine chunks
    const totalLength = compressedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const compressed = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of compressedChunks) {
      compressed.set(chunk, offset);
      offset += chunk.length;
    }

    // Only use compression if it actually reduces size
    if (compressed.length < json.length * 0.8) {
      const base64 = btoa(String.fromCharCode(...compressed));
      const compressedSize = base64.length + 3;
      const reductionPct = ((1 - compressedSize / json.length) * 100).toFixed(1);
      log.info("Compressed spec", {
        originalBytes: json.length,
        compressedBytes: compressedSize,
        reductionPct,
      });
      return `gz:${base64}`;
    }
  } catch (err) {
    log.warn("Compression failed, using raw JSON", { error: err instanceof Error ? err.message : String(err) });
  }

  return json;
}

/**
 * Decompress a spec string (handles both compressed and uncompressed)
 *
 * Security features:
 * - Size limit prevents decompression bomb attacks
 * - Schema validation ensures result is a valid DiagramSpec
 */
export async function decompressSpec(data: string): Promise<DiagramSpec> {
  // Handle uncompressed JSON
  if (!data.startsWith("gz:")) {
    const result = safeParseSpec(data, "decompressSpec:uncompressed");
    if (!result.valid) {
      log.warn("Decompressed spec failed validation", { errors: result.errors.slice(0, 3) });
    }
    return result.spec;
  }

  try {
    const base64 = data.slice(3);

    // Validate base64 format before decoding
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw new Error("Invalid base64 encoding");
    }

    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Use DecompressionStream for gunzip
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();

    const decompressedChunks: Uint8Array[] = [];
    const reader = ds.readable.getReader();
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Check size limit during decompression (early abort for bombs)
      totalLength += value.length;
      if (totalLength > MAX_DECOMPRESSED_SIZE) {
        // Cancel the stream to stop decompression
        await reader.cancel();
        throw new DecompressionLimitError(totalLength, MAX_DECOMPRESSED_SIZE);
      }

      decompressedChunks.push(value);
    }

    // Combine chunks
    const decompressed = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of decompressedChunks) {
      decompressed.set(chunk, offset);
      offset += chunk.length;
    }

    const decoder = new TextDecoder();
    const json = decoder.decode(decompressed);

    // Validate against schema
    const result = safeParseSpec(json, "decompressSpec:compressed");
    if (!result.valid) {
      log.warn("Decompressed spec failed validation", { errors: result.errors.slice(0, 3) });
    }
    return result.spec;
  } catch (err) {
    // Re-throw DecompressionLimitError without wrapping
    if (err instanceof DecompressionLimitError) {
      throw err;
    }
    log.error("Decompression failed", { error: err instanceof Error ? err.message : String(err) });
    throw new Error("Failed to decompress diagram spec");
  }
}

/**
 * Optimize a diagram spec by removing unnecessary data
 */
export function optimizeSpec(spec: DiagramSpec): DiagramSpec {
  return {
    type: spec.type,
    theme: spec.theme,
    nodes: spec.nodes.map((node) => {
      const optimized: typeof node = { id: node.id, label: node.label };

      // Only include non-default values
      if (node.type && node.type !== "box") optimized.type = node.type;
      if (node.color) optimized.color = node.color;
      if (node.position) {
        // Round positions to reduce JSON size
        optimized.position = {
          x: Math.round(node.position.x * 100) / 100,
          y: Math.round(node.position.y * 100) / 100,
        };
      }
      if (node.width && node.width !== 120) optimized.width = node.width;
      if (node.height && node.height !== 60) optimized.height = node.height;
      if (node.details) optimized.details = node.details;

      return optimized;
    }),
    edges: spec.edges.map((edge) => {
      const optimized: typeof edge = { from: edge.from, to: edge.to };

      if (edge.label) optimized.label = edge.label;
      if (edge.style && edge.style !== "solid") optimized.style = edge.style;
      if (edge.color) optimized.color = edge.color;

      return optimized;
    }),
    groups: spec.groups?.filter((g) => g.nodeIds.length > 0),
  };
}

/**
 * Calculate spec complexity score (for performance decisions)
 */
export function getSpecComplexity(spec: DiagramSpec): {
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  totalElements: number;
  estimatedBytes: number;
  complexity: "simple" | "moderate" | "complex" | "very_complex";
} {
  const nodeCount = spec.nodes?.length ?? 0;
  const edgeCount = spec.edges?.length ?? 0;
  const groupCount = spec.groups?.length ?? 0;
  const totalElements = nodeCount + edgeCount + groupCount;
  const estimatedBytes = JSON.stringify(spec).length;

  let complexity: "simple" | "moderate" | "complex" | "very_complex";
  if (totalElements < 20) complexity = "simple";
  else if (totalElements < 100) complexity = "moderate";
  else if (totalElements < 500) complexity = "complex";
  else complexity = "very_complex";

  return {
    nodeCount,
    edgeCount,
    groupCount,
    totalElements,
    estimatedBytes,
    complexity,
  };
}
