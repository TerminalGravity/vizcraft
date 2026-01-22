/**
 * Path Safety Utilities
 *
 * Prevents path traversal attacks by sanitizing user input before
 * using it in filesystem operations.
 */

import { join, normalize, basename, resolve } from "path";

/**
 * Sanitize a filename by removing dangerous characters
 * Replaces anything that's not alphanumeric, dash, underscore, or dot
 */
export function sanitizeFilename(name: string): string {
  if (!name) return "untitled";

  return (
    name
      // Replace path separators and traversal patterns
      .replace(/\.\./g, "_")
      .replace(/[/\\]/g, "_")
      // Replace other dangerous characters
      .replace(/[<>:"|?*]/g, "_")
      // Replace control characters
      .replace(/[\x00-\x1f\x7f]/g, "")
      // Collapse multiple underscores
      .replace(/_+/g, "_")
      // Trim leading/trailing underscores and dots
      .replace(/^[_.\s]+|[_.\s]+$/g, "")
      // Truncate to reasonable length (255 is typical max filename)
      .slice(0, 200) || "untitled"
  );
}

/**
 * Validates that a path is within an allowed directory
 * Prevents path traversal attacks
 */
export function isPathWithinDirectory(targetPath: string, allowedDirectory: string): boolean {
  const normalizedTarget = resolve(normalize(targetPath));
  const normalizedAllowed = resolve(normalize(allowedDirectory));

  return normalizedTarget.startsWith(normalizedAllowed + "/") || normalizedTarget === normalizedAllowed;
}

/**
 * Create a safe export path within the exports directory
 * Returns null if the path would escape the allowed directory
 */
export function createSafeExportPath(
  filename: string,
  extension: string,
  baseDir: string = "./data/exports"
): string {
  // Sanitize the filename
  const safeName = sanitizeFilename(filename);

  // Handle extension - empty string means no extension
  let safeExt = "";
  if (extension && extension.trim()) {
    safeExt = extension.startsWith(".") ? extension : `.${extension}`;
  }

  // Construct the path
  const fullPath = join(baseDir, `${safeName}${safeExt}`);

  // Verify it's within the allowed directory
  if (!isPathWithinDirectory(fullPath, baseDir)) {
    throw new Error("Invalid export path: path traversal detected");
  }

  return fullPath;
}

/**
 * Validate and normalize a user-provided path
 * Returns the safe path or throws if it would escape the allowed directory
 */
export function validateExportPath(
  userPath: string,
  allowedDirectory: string = "./data/exports"
): string {
  // If user provides a full path, extract just the filename
  const filename = basename(userPath);

  // Get the extension from the path
  const extMatch = filename.match(/\.[a-zA-Z0-9]+$/);
  const extension = extMatch ? extMatch[0] : "";
  const nameWithoutExt = filename.slice(0, filename.length - extension.length);

  // Create safe path
  return createSafeExportPath(nameWithoutExt, extension, allowedDirectory);
}
