/**
 * Security Headers Middleware
 *
 * Adds comprehensive security headers to protect against common vulnerabilities:
 * - XSS attacks (Content-Security-Policy)
 * - Clickjacking (X-Frame-Options)
 * - MIME sniffing (X-Content-Type-Options)
 * - Information leakage (Referrer-Policy)
 * - Unnecessary features (Permissions-Policy)
 */

import type { Context, Next } from "hono";

export interface SecurityHeadersConfig {
  /** Enable Content-Security-Policy header */
  enableCSP: boolean;
  /** Enable HSTS header (only in production) */
  enableHSTS: boolean;
  /** Additional CSP directives to merge with defaults */
  customCSP?: Partial<CSPDirectives>;
  /** Allow specific domains in frame-ancestors */
  frameAncestors?: string[];
  /** Whether this is a production environment */
  isProduction: boolean;
}

export interface CSPDirectives {
  "default-src": string[];
  "script-src": string[];
  "style-src": string[];
  "img-src": string[];
  "connect-src": string[];
  "font-src": string[];
  "object-src": string[];
  "frame-src": string[];
  "frame-ancestors": string[];
  "base-uri": string[];
  "form-action": string[];
  "worker-src": string[];
}

const DEFAULT_CSP: CSPDirectives = {
  // Default fallback for all directives
  "default-src": ["'self'"],
  // Scripts: self + inline needed for tldraw dynamic components
  // Note: removed unsafe-eval (XSS escalation vector). Production tldraw works without it.
  "script-src": ["'self'", "'unsafe-inline'"],
  // Styles: self + inline needed for tldraw dynamic styles
  "style-src": ["'self'", "'unsafe-inline'"],
  // Images: self + data URLs (for thumbnails) + blobs (for canvas)
  "img-src": ["'self'", "data:", "blob:"],
  // Connections: self + WebSocket for collaboration
  "connect-src": ["'self'", "ws:", "wss:"],
  // Fonts: self
  "font-src": ["'self'"],
  // No plugins (Flash, etc.)
  "object-src": ["'none'"],
  // Frames: self only
  "frame-src": ["'self'"],
  // Who can embed this page
  "frame-ancestors": ["'self'"],
  // Base URI restriction
  "base-uri": ["'self'"],
  // Form submissions
  "form-action": ["'self'"],
  // Web workers
  "worker-src": ["'self'", "blob:"],
};

/**
 * Build CSP header value from directives
 */
function buildCSP(directives: CSPDirectives): string {
  return Object.entries(directives)
    .filter(([, values]) => values.length > 0)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

/**
 * Merge custom CSP directives with defaults
 */
function mergeCSP(
  defaults: CSPDirectives,
  custom?: Partial<CSPDirectives>
): CSPDirectives {
  if (!custom) return defaults;

  const merged = { ...defaults };
  for (const [key, values] of Object.entries(custom)) {
    if (values && values.length > 0) {
      merged[key as keyof CSPDirectives] = values;
    }
  }
  return merged;
}

/**
 * Default security headers configuration
 */
export const DEFAULT_CONFIG: SecurityHeadersConfig = {
  enableCSP: true,
  enableHSTS: true,
  isProduction: process.env.NODE_ENV === "production",
};

/**
 * Get all security headers as an object
 */
export function getSecurityHeaders(
  config: SecurityHeadersConfig = DEFAULT_CONFIG
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Content-Security-Policy
  if (config.enableCSP) {
    const cspDirectives = mergeCSP(DEFAULT_CSP, config.customCSP);
    if (config.frameAncestors) {
      cspDirectives["frame-ancestors"] = config.frameAncestors;
    }
    headers["Content-Security-Policy"] = buildCSP(cspDirectives);
  }

  // X-Content-Type-Options: Prevent MIME sniffing
  headers["X-Content-Type-Options"] = "nosniff";

  // X-Frame-Options: Prevent clickjacking (legacy, CSP frame-ancestors is preferred)
  headers["X-Frame-Options"] = "SAMEORIGIN";

  // X-XSS-Protection: Enable browser XSS filter (legacy but still useful)
  headers["X-XSS-Protection"] = "1; mode=block";

  // Referrer-Policy: Control referrer information
  headers["Referrer-Policy"] = "strict-origin-when-cross-origin";

  // Permissions-Policy: Disable unnecessary browser features
  headers["Permissions-Policy"] = [
    "accelerometer=()",
    "camera=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "microphone=()",
    "payment=()",
    "usb=()",
  ].join(", ");

  // X-DNS-Prefetch-Control: Control DNS prefetching
  headers["X-DNS-Prefetch-Control"] = "off";

  // X-Download-Options: Prevent IE from opening downloads
  headers["X-Download-Options"] = "noopen";

  // X-Permitted-Cross-Domain-Policies: Restrict Flash/Acrobat
  headers["X-Permitted-Cross-Domain-Policies"] = "none";

  // HSTS: Only in production with HTTPS
  if (config.enableHSTS && config.isProduction) {
    // 1 year max-age, include subdomains
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }

  return headers;
}

/**
 * Security headers middleware for Hono
 */
export function securityHeaders(
  config: Partial<SecurityHeadersConfig> = {}
): (c: Context, next: Next) => Promise<void | Response> {
  const fullConfig: SecurityHeadersConfig = { ...DEFAULT_CONFIG, ...config };

  return async (c: Context, next: Next) => {
    const headers = getSecurityHeaders(fullConfig);

    // Apply headers to response
    for (const [name, value] of Object.entries(headers)) {
      c.header(name, value);
    }

    await next();
  };
}

/**
 * Get security headers for API responses (more permissive CORS)
 * This applies a subset of headers suitable for API endpoints
 */
export function getAPISecurityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  };
}

/**
 * API security headers middleware
 */
export function apiSecurityHeaders(): (
  c: Context,
  next: Next
) => Promise<void | Response> {
  return async (c: Context, next: Next) => {
    const headers = getAPISecurityHeaders();

    for (const [name, value] of Object.entries(headers)) {
      c.header(name, value);
    }

    await next();
  };
}
