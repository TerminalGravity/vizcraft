/**
 * Thumbnail Storage Module
 *
 * Stores diagram thumbnails as files on the filesystem instead of
 * base64 data URLs in the database. This reduces database size and
 * improves query performance.
 *
 * File format: {DATA_DIR}/thumbnails/{diagramId}.png
 */

import { join } from "path";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { validateDataUrl, isValidDataUrl, InvalidDataUrlError } from "../utils/path-safety";

// Configuration
const DATA_DIR = process.env.DATA_DIR || "./data";
const THUMBNAIL_DIR = join(DATA_DIR, "thumbnails");

// Allowed MIME types specifically for thumbnails (images only)
const THUMBNAIL_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Ensure thumbnail directory exists
if (!existsSync(THUMBNAIL_DIR)) {
  mkdirSync(THUMBNAIL_DIR, { recursive: true });
}

/**
 * Convert data URL to Buffer with security validation
 * Only accepts image MIME types (PNG, JPEG, WebP)
 */
export function dataUrlToBuffer(dataUrl: string): Buffer | null {
  try {
    // Use centralized validation for security
    const validated = validateDataUrl(dataUrl);

    // Additional check: only allow image types for thumbnails
    if (!THUMBNAIL_MIME_TYPES.has(validated.mimeType)) {
      console.error(
        `[thumbnails] Rejected non-image MIME type: ${validated.mimeType}`
      );
      return null;
    }

    return Buffer.from(validated.data, "base64");
  } catch (err) {
    if (err instanceof InvalidDataUrlError) {
      console.error(`[thumbnails] Invalid data URL: ${err.message}`);
    }
    return null;
  }
}

/**
 * Convert Buffer to data URL
 */
export function bufferToDataUrl(buffer: Buffer, mimeType = "image/png"): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Get the file path for a diagram's thumbnail
 */
export function getThumbnailPath(diagramId: string): string {
  // Sanitize diagram ID to prevent path traversal
  const safeId = diagramId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(THUMBNAIL_DIR, `${safeId}.png`);
}

/**
 * Save a thumbnail for a diagram
 * @param diagramId - The diagram ID
 * @param dataUrl - The base64 data URL of the thumbnail
 * @returns true if saved successfully
 */
export async function saveThumbnail(
  diagramId: string,
  dataUrl: string
): Promise<boolean> {
  try {
    const buffer = dataUrlToBuffer(dataUrl);
    if (!buffer) {
      console.error(`[thumbnails] Invalid data URL for diagram ${diagramId}`);
      return false;
    }

    const path = getThumbnailPath(diagramId);
    await Bun.write(path, buffer);

    console.log(`[thumbnails] Saved thumbnail for ${diagramId} (${buffer.length} bytes)`);
    return true;
  } catch (err) {
    console.error(`[thumbnails] Failed to save thumbnail for ${diagramId}:`, err);
    return false;
  }
}

/**
 * Load a thumbnail for a diagram
 * @param diagramId - The diagram ID
 * @returns The data URL or null if not found
 */
export async function loadThumbnail(diagramId: string): Promise<string | null> {
  try {
    const path = getThumbnailPath(diagramId);
    const file = Bun.file(path);

    if (!(await file.exists())) {
      return null;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    return bufferToDataUrl(buffer);
  } catch (err) {
    console.error(`[thumbnails] Failed to load thumbnail for ${diagramId}:`, err);
    return null;
  }
}

/**
 * Check if a thumbnail exists for a diagram
 */
export async function thumbnailExists(diagramId: string): Promise<boolean> {
  const path = getThumbnailPath(diagramId);
  const file = Bun.file(path);
  return file.exists();
}

/**
 * Delete a thumbnail for a diagram
 */
export async function deleteThumbnail(diagramId: string): Promise<boolean> {
  try {
    const path = getThumbnailPath(diagramId);

    if (existsSync(path)) {
      unlinkSync(path);
      console.log(`[thumbnails] Deleted thumbnail for ${diagramId}`);
      return true;
    }

    return false;
  } catch (err) {
    console.error(`[thumbnails] Failed to delete thumbnail for ${diagramId}:`, err);
    return false;
  }
}

/**
 * Get thumbnail file info
 */
export async function getThumbnailInfo(
  diagramId: string
): Promise<{ size: number; modifiedAt: Date } | null> {
  try {
    const path = getThumbnailPath(diagramId);
    const file = Bun.file(path);

    if (!(await file.exists())) {
      return null;
    }

    const stat = await file.stat();
    return {
      size: stat.size,
      modifiedAt: new Date(stat.mtime),
    };
  } catch {
    return null;
  }
}

/**
 * List all thumbnail files
 */
export async function listThumbnails(): Promise<string[]> {
  const glob = new Bun.Glob("*.png");
  const files: string[] = [];

  for await (const file of glob.scan(THUMBNAIL_DIR)) {
    // Extract diagram ID from filename
    const diagramId = file.replace(".png", "");
    files.push(diagramId);
  }

  return files;
}

/**
 * Get total size of all thumbnails
 */
export async function getTotalThumbnailSize(): Promise<number> {
  let total = 0;
  const diagramIds = await listThumbnails();

  for (const id of diagramIds) {
    const info = await getThumbnailInfo(id);
    if (info) {
      total += info.size;
    }
  }

  return total;
}

/**
 * Cleanup orphaned thumbnails (thumbnails with no matching diagram)
 *
 * To prevent race conditions where a new diagram+thumbnail is created
 * between checking IDs and deleting thumbnails, we only delete thumbnails
 * that are older than a threshold (default: 5 minutes).
 *
 * @param existingDiagramIds - Set of diagram IDs that exist in the database
 * @param minAgeMs - Minimum age in milliseconds before a thumbnail can be deleted (default: 5 minutes)
 * @returns Number of thumbnails deleted
 */
export async function cleanupOrphans(
  existingDiagramIds: Set<string>,
  minAgeMs: number = 5 * 60 * 1000 // 5 minutes default
): Promise<number> {
  const thumbnailIds = await listThumbnails();
  const now = Date.now();
  let deleted = 0;
  let skippedTooNew = 0;

  for (const id of thumbnailIds) {
    if (!existingDiagramIds.has(id)) {
      // Check the thumbnail's age before deleting to avoid race conditions
      const info = await getThumbnailInfo(id);
      if (info) {
        const age = now - info.modifiedAt.getTime();
        if (age < minAgeMs) {
          // Thumbnail is too new - might have been created for a diagram
          // that we just haven't seen yet. Skip it.
          skippedTooNew++;
          continue;
        }
      }

      const success = await deleteThumbnail(id);
      if (success) {
        deleted++;
      }
    }
  }

  if (deleted > 0 || skippedTooNew > 0) {
    console.log(
      `[thumbnails] Cleanup: ${deleted} deleted, ${skippedTooNew} skipped (too new)`
    );
  }

  return deleted;
}

// Export directory path for testing
export const THUMBNAIL_DIRECTORY = THUMBNAIL_DIR;
