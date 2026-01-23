/**
 * RFC 5987/6266 Compliant Content-Disposition Header
 *
 * Generates Content-Disposition headers that work with both legacy
 * and modern HTTP clients, properly handling Unicode filenames.
 */

/**
 * Generate a Content-Disposition header value for file downloads.
 *
 * Provides both:
 * - `filename` parameter: ASCII-safe fallback (replaces non-ASCII with underscore)
 * - `filename*` parameter: RFC 5987 UTF-8 encoded original name
 *
 * @param originalName - The original filename (may contain Unicode)
 * @param extension - File extension including the dot (e.g., ".svg")
 * @returns Content-Disposition header value
 *
 * @example
 * getContentDisposition("My Diagram", ".svg")
 * // Returns: 'attachment; filename="My_Diagram.svg"; filename*=UTF-8\'\'My%20Diagram.svg'
 *
 * @example
 * getContentDisposition("日本語ダイアグラム", ".png")
 * // Returns: 'attachment; filename="___.png"; filename*=UTF-8\'\'%E6%97%A5%E6%9C%AC%E8%AA%9E...png'
 */
export function getContentDisposition(originalName: string, extension: string): string {
  // ASCII-safe filename: replace non-alphanumeric (except dash/underscore) with underscore
  const asciiSafe = originalName.replace(/[^a-zA-Z0-9-_]/g, "_");

  // RFC 5987 encoding: percent-encode for UTF-8
  // encodeURIComponent handles most characters, but we need to also encode
  // characters that are valid in URIs but not in RFC 5987 attr-char
  const rfc5987Encoded = encodeRFC5987(originalName);

  // If the name is already ASCII-safe, no need for filename*
  if (asciiSafe === originalName) {
    return `attachment; filename="${asciiSafe}${extension}"`;
  }

  // Provide both for compatibility:
  // - filename: for legacy clients that don't support RFC 5987
  // - filename*: for modern clients (takes precedence per RFC 6266)
  return `attachment; filename="${asciiSafe}${extension}"; filename*=UTF-8''${rfc5987Encoded}${encodeRFC5987(extension)}`;
}

/**
 * Encode a string per RFC 5987 attr-char production.
 *
 * RFC 5987 attr-char allows: ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
 * Everything else must be percent-encoded.
 *
 * @param str - String to encode
 * @returns RFC 5987 encoded string
 */
function encodeRFC5987(str: string): string {
  // Start with encodeURIComponent which handles most encoding
  // Then encode additional characters that encodeURIComponent doesn't handle
  // but are not allowed in RFC 5987 attr-char
  return encodeURIComponent(str)
    // RFC 5987 doesn't allow these (but encodeURIComponent leaves them):
    .replace(/'/g, "%27")
    // These are safe in RFC 5987, so decode them for readability:
    .replace(/%21/g, "!")
    .replace(/%23/g, "#")
    .replace(/%24/g, "$")
    .replace(/%26/g, "&")
    .replace(/%2B/g, "+")
    .replace(/%5E/g, "^")
    .replace(/%60/g, "`")
    .replace(/%7C/g, "|")
    .replace(/%7E/g, "~");
}
