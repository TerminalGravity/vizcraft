/**
 * Regex Utilities
 *
 * Safe handling of regular expressions with user-provided input.
 */

/**
 * Escape special regex characters in a string.
 *
 * Use this when constructing a RegExp from user input to prevent
 * regex injection attacks or broken patterns.
 *
 * @param str - The string to escape
 * @returns The string with all regex special characters escaped
 *
 * @example
 * ```ts
 * // Safe pattern construction
 * const userInput = "test.value+more";
 * const pattern = new RegExp(`^prefix:${escapeRegex(userInput)}:`);
 * // pattern matches "prefix:test.value+more:" literally
 * ```
 */
export function escapeRegex(str: string): string {
  // Escape special regex metacharacters: . * + ? ^ $ { } ( ) | [ ] \ /
  // The order matters: backslash must be escaped first
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create a RegExp that matches a literal string prefix.
 *
 * This is a safer alternative to `new RegExp(\`^${userInput}\`)`.
 *
 * @param prefix - The literal prefix to match (will be escaped)
 * @param flags - Optional regex flags (e.g., "i" for case-insensitive)
 * @returns A RegExp that safely matches the prefix
 */
export function createPrefixPattern(prefix: string, flags?: string): RegExp {
  return new RegExp(`^${escapeRegex(prefix)}`, flags);
}

/**
 * Create a RegExp that matches a literal string exactly.
 *
 * @param str - The literal string to match (will be escaped)
 * @param flags - Optional regex flags
 * @returns A RegExp that safely matches the exact string
 */
export function createExactPattern(str: string, flags?: string): RegExp {
  return new RegExp(`^${escapeRegex(str)}$`, flags);
}
