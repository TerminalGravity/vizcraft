/**
 * IP Trust Utilities
 *
 * Validates whether to trust X-Forwarded-For and X-Real-IP headers
 * based on whether the direct connection comes from a trusted proxy.
 *
 * Security: Without this validation, any client can spoof their IP
 * to bypass rate limiting.
 */

import { createLogger } from "../logging";

const log = createLogger("ip-trust");

/**
 * Parse CIDR notation into base IP and prefix length
 */
function parseCIDR(cidr: string): { ip: bigint; prefixLen: number; isIPv6: boolean } | null {
  const parts = cidr.split("/");
  const ipStr = parts[0];
  const prefixLen = parts[1] ? parseInt(parts[1], 10) : null;

  if (!ipStr) return null;

  const isIPv6 = ipStr.includes(":");

  try {
    const ip = parseIP(ipStr);
    if (ip === null) return null;

    // Default prefix length if not specified
    const defaultPrefix = isIPv6 ? 128 : 32;
    const actualPrefix = prefixLen ?? defaultPrefix;

    // Validate prefix length
    const maxPrefix = isIPv6 ? 128 : 32;
    if (actualPrefix < 0 || actualPrefix > maxPrefix) return null;

    return { ip, prefixLen: actualPrefix, isIPv6 };
  } catch {
    return null;
  }
}

/**
 * Parse an IP address string to a bigint for comparison
 * Handles both IPv4 and IPv6
 */
function parseIP(ip: string): bigint | null {
  // Handle IPv4
  if (ip.includes(".") && !ip.includes(":")) {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;

    let result = 0n;
    for (const part of parts) {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255) return null;
      result = (result << 8n) | BigInt(num);
    }
    return result;
  }

  // Handle IPv6
  if (ip.includes(":")) {
    // Expand :: notation
    let expanded = ip;

    // Handle IPv4-mapped IPv6 (::ffff:192.168.1.1)
    const v4MappedMatch = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4MappedMatch) {
      const v4Part = parseIP(v4MappedMatch[1]);
      if (v4Part === null) return null;
      return 0xffff00000000n | v4Part;
    }

    // Count existing colons to determine how many zeros to insert
    const doubleColonIndex = expanded.indexOf("::");
    if (doubleColonIndex !== -1) {
      const before = expanded.substring(0, doubleColonIndex).split(":").filter(Boolean);
      const after = expanded.substring(doubleColonIndex + 2).split(":").filter(Boolean);
      const missing = 8 - before.length - after.length;
      const zeros = Array(missing).fill("0");
      expanded = [...before, ...zeros, ...after].join(":");
    }

    const parts = expanded.split(":");
    if (parts.length !== 8) return null;

    let result = 0n;
    for (const part of parts) {
      const num = parseInt(part, 16);
      if (isNaN(num) || num < 0 || num > 0xffff) return null;
      result = (result << 16n) | BigInt(num);
    }
    return result;
  }

  return null;
}

/**
 * Check if an IP is within a CIDR range
 */
function ipInCIDR(ip: bigint, cidr: { ip: bigint; prefixLen: number; isIPv6: boolean }): boolean {
  const bits = cidr.isIPv6 ? 128n : 32n;
  const mask = ((1n << bits) - 1n) ^ ((1n << (bits - BigInt(cidr.prefixLen))) - 1n);
  return (ip & mask) === (cidr.ip & mask);
}

/**
 * Default trusted proxy CIDR ranges (private networks + loopback)
 */
const DEFAULT_TRUSTED_CIDRS = [
  "127.0.0.0/8",      // IPv4 loopback
  "10.0.0.0/8",       // Private class A
  "172.16.0.0/12",    // Private class B (includes Docker default 172.17.0.0/16)
  "192.168.0.0/16",   // Private class C
  "::1/128",          // IPv6 loopback
  "fc00::/7",         // IPv6 unique local addresses
  "fe80::/10",        // IPv6 link-local
];

/**
 * Parsed trusted CIDR ranges (cached on first use)
 */
let parsedTrustedCIDRs: ReturnType<typeof parseCIDR>[] | null = null;

/**
 * Initialize trusted CIDRs from environment or defaults
 */
function getTrustedCIDRs(): NonNullable<ReturnType<typeof parseCIDR>>[] {
  if (parsedTrustedCIDRs !== null) {
    return parsedTrustedCIDRs.filter((c): c is NonNullable<typeof c> => c !== null);
  }

  const envCIDRs = process.env.TRUSTED_PROXY_CIDRS;
  const cidrStrings = envCIDRs
    ? envCIDRs.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_TRUSTED_CIDRS;

  parsedTrustedCIDRs = cidrStrings.map((cidr) => {
    const parsed = parseCIDR(cidr);
    if (!parsed) {
      log.warn("Invalid CIDR in TRUSTED_PROXY_CIDRS, skipping", { cidr });
    }
    return parsed;
  });

  const valid = parsedTrustedCIDRs.filter((c): c is NonNullable<typeof c> => c !== null);
  log.info("Initialized trusted proxy CIDRs", {
    count: valid.length,
    source: envCIDRs ? "environment" : "defaults",
  });

  return valid;
}

/**
 * Check if a direct connection IP is from a trusted proxy
 */
export function isTrustedProxy(directIP: string | undefined): boolean {
  if (!directIP || directIP === "unknown") {
    return false;
  }

  const parsed = parseIP(directIP);
  if (parsed === null) {
    return false;
  }

  const cidrs = getTrustedCIDRs();
  return cidrs.some((cidr) => ipInCIDR(parsed, cidr));
}

/**
 * Get the real client IP, only trusting forwarded headers from trusted proxies
 *
 * @param directIP - The IP from the direct socket connection
 * @param forwardedFor - X-Forwarded-For header value
 * @param realIP - X-Real-IP header value
 * @returns The client IP to use for rate limiting
 */
export function getClientIP(
  directIP: string | undefined,
  forwardedFor: string | undefined,
  realIP: string | undefined
): string {
  // If we don't have a direct IP, we can't validate trust
  if (!directIP || directIP === "unknown") {
    // In this case, we have to use the headers but log a warning
    const headerIP = forwardedFor?.split(",")[0]?.trim() || realIP;
    if (headerIP) {
      log.debug("Using forwarded IP without trust validation (no direct IP available)", {
        forwardedFor: forwardedFor?.slice(0, 50),
        realIP,
      });
      return headerIP;
    }
    return "unknown";
  }

  // Check if the direct connection is from a trusted proxy
  if (isTrustedProxy(directIP)) {
    // Trust the forwarded headers
    const clientIP = forwardedFor?.split(",")[0]?.trim() || realIP || directIP;
    return clientIP;
  }

  // Direct connection is NOT from a trusted proxy
  // Do not trust X-Forwarded-For or X-Real-IP headers
  // Use the direct connection IP
  return directIP;
}

/**
 * Reset cached CIDRs (for testing)
 */
export function resetTrustedCIDRsCache(): void {
  parsedTrustedCIDRs = null;
}
