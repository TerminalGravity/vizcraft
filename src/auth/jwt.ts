/**
 * JWT Token Utilities
 *
 * Simple, secure JWT implementation using HMAC-SHA256.
 * Uses Web Crypto API for cryptographic operations.
 *
 * Security Features:
 * - HMAC-SHA256 signing (timing-safe via Web Crypto API)
 * - Token size limits to prevent memory exhaustion
 * - Algorithm validation to prevent "alg: none" attacks
 * - Issuer validation
 * - Expiration (exp) and not-before (nbf) claim support
 */

import { config } from "../config";

/**
 * Maximum token size in bytes (8KB)
 * Prevents memory exhaustion attacks via huge tokens.
 * A typical JWT with reasonable claims is ~500 bytes.
 */
export const MAX_TOKEN_SIZE = 8 * 1024;

/** Supported JWT algorithm (only HS256) */
const SUPPORTED_ALGORITHM = "HS256";

export interface JWTPayload {
  /** Subject - user identifier */
  sub: string;
  /** Issuer */
  iss: string;
  /** Issued at (Unix timestamp) */
  iat: number;
  /** Expiration (Unix timestamp) */
  exp: number;
  /** Not before (Unix timestamp) - token is invalid before this time */
  nbf?: number;
  /** User role */
  role?: "admin" | "user" | "viewer";
  /** Additional claims */
  [key: string]: unknown;
}

export interface TokenValidationResult {
  valid: boolean;
  payload?: JWTPayload;
  error?: string;
}

// Base64url encoding/decoding
function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlDecode(str: string): Uint8Array {
  // Restore padding
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
}

// Get secret from centralized config
// Note: Production validation happens at startup in config/index.ts (fail-fast)
function getSecret(): string {
  return config.security.jwtSecret;
}

// Import key for HMAC operations
async function getSigningKey(): Promise<CryptoKey> {
  const secret = getSecret();
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Sign a JWT token
 *
 * @param payload - Token payload (sub required, role optional)
 * @param options - Token options
 * @param options.expiresInSeconds - Token lifetime (default: 24 hours)
 * @param options.notBeforeSeconds - Seconds from now until token becomes valid (default: 0)
 */
export async function signJWT(
  payload: Omit<JWTPayload, "iat" | "exp" | "iss" | "nbf">,
  options: { expiresInSeconds?: number; notBeforeSeconds?: number } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = options.expiresInSeconds ?? 24 * 60 * 60; // 24 hours default

  // Build full payload - explicitly set known fields to ensure types
  // (the index signature makes spread types looser than desired)
  const fullPayload: JWTPayload = {
    ...payload,
    sub: payload.sub as string, // Type is narrowed correctly but needs explicit cast
    iss: "vizcraft",
    iat: now,
    exp: now + expiresIn,
  };

  // Add nbf claim if specified (token becomes valid in the future)
  if (options.notBeforeSeconds !== undefined && options.notBeforeSeconds > 0) {
    fullPayload.nbf = now + options.notBeforeSeconds;
  }

  // Create header
  const header = { alg: "HS256", typ: "JWT" };
  const encoder = new TextEncoder();

  // Encode header and payload
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));

  // Sign
  const key = await getSigningKey();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${headerB64}.${payloadB64}`)
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * Verify and decode a JWT token
 *
 * Security checks performed:
 * 1. Token size limit (prevents memory exhaustion)
 * 2. Token format validation
 * 3. Algorithm validation (prevents "alg: none" attacks)
 * 4. Cryptographic signature verification (timing-safe via Web Crypto)
 * 5. Expiration check
 * 6. Not-before check (if nbf claim present)
 * 7. Issuer validation
 */
export async function verifyJWT(token: string): Promise<TokenValidationResult> {
  try {
    // Security: Check token size before any parsing
    // Prevents memory exhaustion via huge tokens
    if (token.length > MAX_TOKEN_SIZE) {
      return { valid: false, error: "Token too large" };
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Invalid token format" };
    }

    const headerB64 = parts[0];
    const payloadB64 = parts[1];
    const signatureB64 = parts[2];

    // Guard against undefined (TypeScript strict mode)
    if (!headerB64 || !payloadB64 || !signatureB64) {
      return { valid: false, error: "Invalid token format" };
    }

    // Security: Validate algorithm before signature verification
    // Prevents "alg: none" and algorithm confusion attacks
    const headerStr = new TextDecoder().decode(base64UrlDecode(headerB64));
    const header = JSON.parse(headerStr) as { alg?: string; typ?: string };
    if (header.alg !== SUPPORTED_ALGORITHM) {
      return { valid: false, error: "Unsupported algorithm" };
    }

    // Verify signature (Web Crypto's verify is timing-safe)
    const key = await getSigningKey();
    const encoder = new TextEncoder();
    const signatureBytes = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes.buffer as ArrayBuffer,
      encoder.encode(`${headerB64}.${payloadB64}`)
    );

    if (!valid) {
      return { valid: false, error: "Invalid signature" };
    }

    // Decode payload
    const payloadStr = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadStr) as JWTPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return { valid: false, error: "Token expired" };
    }

    // Check not-before (if present)
    if (payload.nbf !== undefined && payload.nbf > now) {
      return { valid: false, error: "Token not yet valid" };
    }

    // Check issuer
    if (payload.iss !== "vizcraft") {
      return { valid: false, error: "Invalid issuer" };
    }

    return { valid: true, payload };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Token validation failed",
    };
  }
}

/**
 * Decode a JWT without verification (for debugging only)
 */
export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payloadB64 = parts[1];
    if (!payloadB64) return null;

    const payloadStr = new TextDecoder().decode(base64UrlDecode(payloadB64));
    return JSON.parse(payloadStr) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Check if token is close to expiration
 */
export function isTokenExpiringSoon(payload: JWTPayload, thresholdSeconds = 300): boolean {
  const now = Math.floor(Date.now() / 1000);
  return payload.exp - now < thresholdSeconds;
}
