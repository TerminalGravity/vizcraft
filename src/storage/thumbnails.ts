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

// Configuration
const DATA_DIR = process.env.DATA_DIR || "./data";
const THUMBNAIL_DIR = join(DATA_DIR, "thumbnails");

// Ensure thumbnail directory exists
if (!existsSync(THUMBNAIL_DIR)) {
  mkdirSync(THUMBNAIL_DIR, { recursive: true });
}

/**
 * Convert data URL to Buffer
 */
export function dataUrlToBuffer(dataUrl: string): Buffer | null {
  try {
    // Data URL format: data:image/png;base64,<data>
    const matches = dataUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches) {
      return null;
    }
    return Buffer.from(matches[2], "base64");
  } catch {
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
 * @param existingDiagramIds - Set of diagram IDs that exist in the database
 * @returns Number of thumbnails deleted
 */
export async function cleanupOrphans(
  existingDiagramIds: Set<string>
): Promise<number> {
  const thumbnailIds = await listThumbnails();
  let deleted = 0;

  for (const id of thumbnailIds) {
    if (!existingDiagramIds.has(id)) {
      const success = await deleteThumbnail(id);
      if (success) {
        deleted++;
      }
    }
  }

  if (deleted > 0) {
    console.log(`[thumbnails] Cleaned up ${deleted} orphaned thumbnails`);
  }

  return deleted;
}

// Export directory path for testing
export const THUMBNAIL_DIRECTORY = THUMBNAIL_DIR;
