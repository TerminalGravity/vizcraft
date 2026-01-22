/**
 * Path Safety Utilities
 *
 * Prevents path traversal attacks by sanitizing user input before
 * using it in filesystem operations.
 *
 * Security features:
 * - Extension whitelist enforcement
 * - Path traversal prevention
 * - Filename sanitization
 * - MIME type validation for data URLs
 */

import { join, normalize, basename, resolve } from "path";

/**
 * Whitelist of allowed file extensions for exports
 * Only these extensions can be written to the filesystem
 */
export const ALLOWED_EXTENSIONS = new Set([
  ".json",
  ".svg",
  ".png",
  ".pdf",
  ".jpeg",
  ".jpg",
  ".webp",
]);

/**
 * Mapping of MIME types to allowed extensions
 */
export const MIME_TO_EXTENSION: Record<string, string> = {
  "application/json": ".json",
  "image/svg+xml": ".svg",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

/**
 * Allowed MIME types for data URLs
 */
export const ALLOWED_MIME_TYPES = new Set(Object.keys(MIME_TO_EXTENSION));

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
      // Replace control characters (ASCII)
      .replace(/[\x00-\x1f\x7f]/g, "")
      // Remove unicode control characters including:
      // - Bidi overrides (U+202A-U+202E, U+2066-U+2069)
      // - Zero-width characters (U+200B-U+200F, U+FEFF)
      // - Other format characters (U+2060-U+2064)
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "")
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
 * Validate that an extension is in the allowed whitelist
 * @throws Error if extension is not allowed
 */
export function validateExtension(extension: string): string {
  // Normalize extension to lowercase with leading dot
  const normalizedExt = extension.toLowerCase().startsWith(".")
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`;

  if (!ALLOWED_EXTENSIONS.has(normalizedExt)) {
    throw new ExtensionNotAllowedError(
      `File extension "${normalizedExt}" is not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`
    );
  }

  return normalizedExt;
}

/**
 * Check if an extension is allowed (non-throwing version)
 */
export function isExtensionAllowed(extension: string): boolean {
  const normalizedExt = extension.toLowerCase().startsWith(".")
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`;
  return ALLOWED_EXTENSIONS.has(normalizedExt);
}

/**
 * Validate and parse a data URL
 * Returns the MIME type and base64 data, or throws if invalid
 */
export function validateDataUrl(dataUrl: string): {
  mimeType: string;
  extension: string;
  data: string;
} {
  // Strict regex for data URL format
  const dataUrlRegex = /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+=*)$/;
  const match = dataUrl.match(dataUrlRegex);

  if (!match) {
    throw new InvalidDataUrlError("Invalid data URL format");
  }

  const [, mimeType, data] = match;

  // Check MIME type is allowed
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new InvalidDataUrlError(
      `MIME type "${mimeType}" is not allowed. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`
    );
  }

  // Validate base64 data is not empty and has reasonable size
  if (!data || data.length === 0) {
    throw new InvalidDataUrlError("Data URL contains no data");
  }

  // Limit data URL size to 10MB (base64 encoded)
  const MAX_DATA_SIZE = 10 * 1024 * 1024 * 1.37; // ~13.7MB base64 = 10MB binary
  if (data.length > MAX_DATA_SIZE) {
    throw new InvalidDataUrlError("Data URL exceeds maximum size limit (10MB)");
  }

  const extension = MIME_TO_EXTENSION[mimeType];

  return { mimeType, extension, data };
}

/**
 * Check if a data URL is valid (non-throwing version)
 */
export function isValidDataUrl(dataUrl: string): boolean {
  try {
    validateDataUrl(dataUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a safe export path within the exports directory
 * Validates extension against whitelist before creating path
 * @throws ExtensionNotAllowedError if extension is not whitelisted
 * @throws Error if path traversal is detected
 */
export function createSafeExportPath(
  filename: string,
  extension: string,
  baseDir: string = "./data/exports"
): string {
  // Sanitize the filename
  const safeName = sanitizeFilename(filename);

  // Validate and normalize extension
  let safeExt = "";
  if (extension && extension.trim()) {
    safeExt = validateExtension(extension);
  }

  // Construct the path
  const fullPath = join(baseDir, `${safeName}${safeExt}`);

  // Verify it's within the allowed directory BEFORE any file operation
  if (!isPathWithinDirectory(fullPath, baseDir)) {
    throw new PathTraversalError("Invalid export path: path traversal detected");
  }

  return fullPath;
}

/**
 * Validate and normalize a user-provided path
 * Returns the safe path or throws if it would escape the allowed directory
 * @throws ExtensionNotAllowedError if extension is not whitelisted
 * @throws PathTraversalError if path traversal is detected
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

  // Create safe path (validates extension internally)
  return createSafeExportPath(nameWithoutExt, extension, allowedDirectory);
}

/**
 * Error thrown when file extension is not in the allowed whitelist
 */
export class ExtensionNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionNotAllowedError";
  }
}

/**
 * Error thrown when path traversal is detected
 */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

/**
 * Error thrown when data URL is invalid
 */
export class InvalidDataUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDataUrlError";
  }
}
