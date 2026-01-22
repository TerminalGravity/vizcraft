/**
 * SVG Security Utilities
 *
 * Provides XSS-safe escaping and sanitization for SVG generation.
 * SVG is a powerful format that can contain executable code through
 * various vectors including script tags, event handlers, and external references.
 */

/**
 * Escape XML/HTML special characters
 * This is the basic level of escaping for text content
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Escape a value for use in an SVG/XML attribute
 * More restrictive than text content escaping
 */
export function escapeAttribute(str: string): string {
  // First do standard XML escaping
  let escaped = escapeXml(str);

  // Remove any potential event handlers (onclick, onload, etc.)
  // These could be injected even in attribute values
  escaped = escaped.replace(/on\w+\s*=/gi, "");

  // Remove javascript: and data: URLs
  escaped = escaped.replace(/javascript:/gi, "");
  escaped = escaped.replace(/data:/gi, "");

  // Remove vbscript: (IE legacy)
  escaped = escaped.replace(/vbscript:/gi, "");

  return escaped;
}

/**
 * Sanitize a string for use as an SVG ID
 * IDs should only contain safe characters
 */
export function sanitizeId(id: string): string {
  // Only allow alphanumeric, dash, underscore
  // Replace anything else with underscore
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Sanitize numeric values
 * Ensures the value is actually a number to prevent injection
 */
export function sanitizeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * Sanitize a color value
 * Only allows safe color formats
 */
export function sanitizeColor(color: string | undefined, fallback: string = "#000000"): string {
  if (!color) return fallback;

  // Allow hex colors
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    return color;
  }

  // Allow rgb/rgba colors
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/i.test(color)) {
    return color;
  }

  // Allow hsl/hsla colors
  if (/^hsla?\(\s*\d+\s*,\s*\d+%?\s*,\s*\d+%?\s*(,\s*[\d.]+\s*)?\)$/i.test(color)) {
    return color;
  }

  // Allow named colors (limited set) - all lowercase for comparison
  const safeColorNames = [
    "black", "white", "red", "green", "blue", "yellow", "orange", "purple",
    "pink", "gray", "grey", "cyan", "magenta", "transparent", "currentcolor",
  ];
  const lowerColor = color.toLowerCase();
  if (safeColorNames.includes(lowerColor)) {
    // Return the canonical lowercase form
    return lowerColor;
  }

  return fallback;
}

/**
 * Generate safe SVG headers for XSS protection
 */
export function getSvgSecurityHeaders(): Record<string, string> {
  return {
    // Prevent browsers from MIME-sniffing away from declared content type
    "X-Content-Type-Options": "nosniff",
    // Disable inline scripts in the SVG
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    // Prevent being embedded in frames/iframes
    "X-Frame-Options": "DENY",
    // Additional XSS protection
    "X-XSS-Protection": "1; mode=block",
    // Correct content type
    "Content-Type": "image/svg+xml",
  };
}

/**
 * SVG sanitization options
 */
export interface SvgSanitizeOptions {
  /** Allow style tags (default: true, but limited) */
  allowStyles?: boolean;
  /** Allow external references (default: false) */
  allowExternalReferences?: boolean;
  /** Maximum dimension (default: 10000) */
  maxDimension?: number;
}

/**
 * Post-process and sanitize generated SVG
 * This is a defense-in-depth measure
 */
export function sanitizeSvgOutput(svg: string, options: SvgSanitizeOptions = {}): string {
  const { maxDimension = 10000 } = options;

  // Remove any script tags (should never be present, but defense in depth)
  let sanitized = svg.replace(/<script[\s\S]*?<\/script>/gi, "");
  sanitized = sanitized.replace(/<script[^>]*>/gi, "");

  // Remove event handlers from any remaining tags
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, "");

  // Remove javascript: URLs
  sanitized = sanitized.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href=""');
  sanitized = sanitized.replace(/xlink:href\s*=\s*["']javascript:[^"']*["']/gi, 'xlink:href=""');

  // Remove foreignObject (can embed HTML)
  sanitized = sanitized.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");

  // Validate dimensions aren't absurdly large
  const widthMatch = sanitized.match(/width\s*=\s*["']?(\d+)/);
  const heightMatch = sanitized.match(/height\s*=\s*["']?(\d+)/);

  const widthValue = widthMatch?.[1];
  if (widthValue && parseInt(widthValue) > maxDimension) {
    sanitized = sanitized.replace(
      /width\s*=\s*["']?\d+/,
      `width="${maxDimension}"`
    );
  }

  const heightValue = heightMatch?.[1];
  if (heightValue && parseInt(heightValue) > maxDimension) {
    sanitized = sanitized.replace(
      /height\s*=\s*["']?\d+/,
      `height="${maxDimension}"`
    );
  }

  return sanitized;
}

/**
 * Helper to create a safe SVG element
 */
export function svgElement(
  tag: string,
  attributes: Record<string, string | number | undefined>,
  content?: string
): string {
  const safeAttrs = Object.entries(attributes)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => {
      const safeKey = k.replace(/[^a-zA-Z0-9-:]/g, "");
      const safeValue = typeof v === "number"
        ? String(sanitizeNumber(v))
        : escapeAttribute(String(v));
      return `${safeKey}="${safeValue}"`;
    })
    .join(" ");

  const safeTag = tag.replace(/[^a-zA-Z0-9]/g, "");

  if (content === undefined) {
    return `<${safeTag} ${safeAttrs} />`;
  }

  return `<${safeTag} ${safeAttrs}>${content}</${safeTag}>`;
}
