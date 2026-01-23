/**
 * JWT Token Utilities
 *
 * Simple, secure JWT implementation using HMAC-SHA256.
 * Uses Web Crypto API for cryptographic operations.
 */

import { config } from "../config";

export interface JWTPayload {
  /** Subject - user identifier */
  sub: string;
  /** Issuer */
  iss: string;
  /** Issued at (Unix timestamp) */
  iat: number;
  /** Expiration (Unix timestamp) */
  exp: number;
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
 */
export async function signJWT(
  payload: Omit<JWTPayload, "iat" | "exp" | "iss">,
  options: { expiresInSeconds?: number } = {}
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
 */
export async function verifyJWT(token: string): Promise<TokenValidationResult> {
  try {
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

    // Verify signature
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
