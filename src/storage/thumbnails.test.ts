/**
 * Thumbnail Storage Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  dataUrlToBuffer,
  bufferToDataUrl,
  getThumbnailPath,
  saveThumbnail,
  loadThumbnail,
  thumbnailExists,
  deleteThumbnail,
  getThumbnailInfo,
  listThumbnails,
  cleanupOrphans,
  THUMBNAIL_DIRECTORY,
} from "./thumbnails";

// Test data: 1x1 pixel PNG
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TEST_DATA_URL = `data:image/png;base64,${TEST_PNG_BASE64}`;

describe("Data URL Conversion", () => {
  it("converts valid data URL to buffer", () => {
    const buffer = dataUrlToBuffer(TEST_DATA_URL);
    expect(buffer).not.toBeNull();
    expect(buffer!.length).toBeGreaterThan(0);
  });

  it("returns null for invalid data URL", () => {
    expect(dataUrlToBuffer("not a data url")).toBeNull();
    expect(dataUrlToBuffer("data:text/plain;base64,dGVzdA==")).toBeNull();
  });

  it("converts buffer back to data URL", () => {
    const buffer = Buffer.from(TEST_PNG_BASE64, "base64");
    const dataUrl = bufferToDataUrl(buffer);

    expect(dataUrl).toBe(TEST_DATA_URL);
  });

  it("round-trips data URL to buffer and back", () => {
    const buffer = dataUrlToBuffer(TEST_DATA_URL);
    const dataUrl = bufferToDataUrl(buffer!);

    expect(dataUrl).toBe(TEST_DATA_URL);
  });
});

describe("Thumbnail Path", () => {
  it("generates path for valid ID", () => {
    const path = getThumbnailPath("abc123");
    expect(path).toContain("abc123.png");
    expect(path).toContain("thumbnails");
  });

  it("sanitizes dangerous characters", () => {
    const path = getThumbnailPath("../../../etc/passwd");
    // Path should not contain ".." for path traversal
    // Extract just the filename part
    const filename = path.split("/").pop()!;
    expect(filename).not.toContain("..");
    expect(filename).toContain("_");
    expect(filename.endsWith(".png")).toBe(true);
  });

  it("preserves valid characters", () => {
    const path = getThumbnailPath("test-diagram_123");
    expect(path).toContain("test-diagram_123.png");
  });
});

describe("Thumbnail Operations", () => {
  const testDiagramId = `test-thumbnail-${Date.now()}`;

  afterAll(async () => {
    // Cleanup test file
    await deleteThumbnail(testDiagramId);
  });

  it("saves thumbnail", async () => {
    const result = await saveThumbnail(testDiagramId, TEST_DATA_URL);
    expect(result).toBe(true);

    // Verify file exists
    const path = getThumbnailPath(testDiagramId);
    expect(existsSync(path)).toBe(true);
  });

  it("loads thumbnail", async () => {
    // Ensure it was saved first
    await saveThumbnail(testDiagramId, TEST_DATA_URL);

    const dataUrl = await loadThumbnail(testDiagramId);
    expect(dataUrl).not.toBeNull();
    expect(dataUrl).toBe(TEST_DATA_URL);
  });

  it("checks if thumbnail exists", async () => {
    // Save first
    await saveThumbnail(testDiagramId, TEST_DATA_URL);

    const exists = await thumbnailExists(testDiagramId);
    expect(exists).toBe(true);

    const notExists = await thumbnailExists("nonexistent-diagram");
    expect(notExists).toBe(false);
  });

  it("gets thumbnail info", async () => {
    // Save first
    await saveThumbnail(testDiagramId, TEST_DATA_URL);

    const info = await getThumbnailInfo(testDiagramId);
    expect(info).not.toBeNull();
    expect(info!.size).toBeGreaterThan(0);
    expect(info!.modifiedAt).toBeInstanceOf(Date);
  });

  it("returns null for nonexistent thumbnail", async () => {
    const dataUrl = await loadThumbnail("definitely-does-not-exist");
    expect(dataUrl).toBeNull();

    const info = await getThumbnailInfo("definitely-does-not-exist");
    expect(info).toBeNull();
  });

  it("deletes thumbnail", async () => {
    const deleteId = `test-delete-${Date.now()}`;

    // Save first
    await saveThumbnail(deleteId, TEST_DATA_URL);
    expect(await thumbnailExists(deleteId)).toBe(true);

    // Delete
    const result = await deleteThumbnail(deleteId);
    expect(result).toBe(true);
    expect(await thumbnailExists(deleteId)).toBe(false);
  });

  it("returns false when deleting nonexistent thumbnail", async () => {
    const result = await deleteThumbnail("nonexistent-for-delete");
    expect(result).toBe(false);
  });
});

describe("Invalid Data Handling", () => {
  it("returns false for invalid data URL", async () => {
    const result = await saveThumbnail("invalid-data", "not a valid data url");
    expect(result).toBe(false);
  });

  it("handles save errors gracefully", async () => {
    // This test just verifies the function doesn't throw
    const result = await saveThumbnail("test", "data:image/png;base64,invalid!!!base64");
    expect(typeof result).toBe("boolean");
  });
});

describe("Thumbnail Listing and Cleanup", () => {
  const testPrefix = `list-test-${Date.now()}`;
  const testIds = [`${testPrefix}-1`, `${testPrefix}-2`, `${testPrefix}-3`];

  beforeAll(async () => {
    // Create test thumbnails
    for (const id of testIds) {
      await saveThumbnail(id, TEST_DATA_URL);
    }
  });

  afterAll(async () => {
    // Cleanup
    for (const id of testIds) {
      await deleteThumbnail(id);
    }
  });

  it("lists all thumbnails", async () => {
    const list = await listThumbnails();

    // Should include our test thumbnails
    for (const id of testIds) {
      expect(list).toContain(id);
    }
  });

  it("cleans up orphaned thumbnails older than threshold", async () => {
    // Create an orphan
    const orphanId = `orphan-${Date.now()}`;
    await saveThumbnail(orphanId, TEST_DATA_URL);

    // Cleanup with only testIds as existing, but with 0ms threshold (delete immediately)
    const existingIds = new Set(testIds);
    const deleted = await cleanupOrphans(existingIds, 0);

    // Should have deleted at least the orphan
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await thumbnailExists(orphanId)).toBe(false);
  });

  it("skips orphaned thumbnails that are too new", async () => {
    // Create an orphan
    const newOrphanId = `new-orphan-${Date.now()}`;
    await saveThumbnail(newOrphanId, TEST_DATA_URL);

    // Cleanup with high age threshold (1 hour) - should skip the new orphan
    const existingIds = new Set(testIds);
    const deleted = await cleanupOrphans(existingIds, 60 * 60 * 1000);

    // The new orphan should still exist because it's too new
    expect(await thumbnailExists(newOrphanId)).toBe(true);

    // Clean up manually for test isolation
    await deleteThumbnail(newOrphanId);
  });
});

describe("Edge Cases", () => {
  it("handles empty diagram ID", async () => {
    const path = getThumbnailPath("");
    expect(path).toContain(".png");
  });

  it("handles very long diagram ID", async () => {
    const longId = "a".repeat(200);
    const path = getThumbnailPath(longId);
    expect(path).toContain(".png");
  });

  it("handles special characters in ID", async () => {
    const specialId = "test<>:\"/\\|?*";
    const path = getThumbnailPath(specialId);
    // Extract just the filename to check sanitization
    // (full path will contain directory separators)
    const filename = path.split("/").pop()!;
    // Should be sanitized - no dangerous characters in filename
    expect(filename).not.toContain("<");
    expect(filename).not.toContain(">");
    expect(filename).not.toContain(":");
    expect(filename).not.toContain("\"");
    expect(filename).not.toContain("\\");
    expect(filename).not.toContain("|");
    expect(filename).not.toContain("?");
    expect(filename).not.toContain("*");
    expect(filename.endsWith(".png")).toBe(true);
  });
});
