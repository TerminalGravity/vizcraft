/**
 * IP Trust Utilities Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getClientIP, isTrustedProxy, resetTrustedCIDRsCache } from "./ip-trust";

describe("isTrustedProxy", () => {
  beforeEach(() => {
    resetTrustedCIDRsCache();
    delete process.env.TRUSTED_PROXY_CIDRS;
  });

  afterEach(() => {
    resetTrustedCIDRsCache();
    delete process.env.TRUSTED_PROXY_CIDRS;
  });

  it("trusts localhost IPv4", () => {
    expect(isTrustedProxy("127.0.0.1")).toBe(true);
    expect(isTrustedProxy("127.0.0.255")).toBe(true);
    expect(isTrustedProxy("127.255.255.255")).toBe(true);
  });

  it("trusts localhost IPv6", () => {
    expect(isTrustedProxy("::1")).toBe(true);
  });

  it("trusts private networks (10.x.x.x)", () => {
    expect(isTrustedProxy("10.0.0.1")).toBe(true);
    expect(isTrustedProxy("10.255.255.255")).toBe(true);
  });

  it("trusts private networks (172.16.x.x - 172.31.x.x)", () => {
    expect(isTrustedProxy("172.16.0.1")).toBe(true);
    expect(isTrustedProxy("172.17.0.1")).toBe(true); // Docker default
    expect(isTrustedProxy("172.31.255.255")).toBe(true);
    expect(isTrustedProxy("172.32.0.1")).toBe(false); // Outside range
  });

  it("trusts private networks (192.168.x.x)", () => {
    expect(isTrustedProxy("192.168.0.1")).toBe(true);
    expect(isTrustedProxy("192.168.255.255")).toBe(true);
  });

  it("does NOT trust public IPs", () => {
    expect(isTrustedProxy("8.8.8.8")).toBe(false);
    expect(isTrustedProxy("1.1.1.1")).toBe(false);
    expect(isTrustedProxy("203.0.113.1")).toBe(false);
  });

  it("handles undefined and unknown", () => {
    expect(isTrustedProxy(undefined)).toBe(false);
    expect(isTrustedProxy("unknown")).toBe(false);
    expect(isTrustedProxy("")).toBe(false);
  });

  it("handles invalid IP formats", () => {
    expect(isTrustedProxy("not-an-ip")).toBe(false);
    expect(isTrustedProxy("256.256.256.256")).toBe(false);
    expect(isTrustedProxy("1.2.3")).toBe(false);
  });

  it("respects custom TRUSTED_PROXY_CIDRS", () => {
    process.env.TRUSTED_PROXY_CIDRS = "203.0.113.0/24";
    resetTrustedCIDRsCache();

    // Custom range should be trusted
    expect(isTrustedProxy("203.0.113.1")).toBe(true);
    expect(isTrustedProxy("203.0.113.255")).toBe(true);

    // Default ranges should NOT be trusted when custom is specified
    expect(isTrustedProxy("127.0.0.1")).toBe(false);
    expect(isTrustedProxy("192.168.1.1")).toBe(false);
  });
});

describe("getClientIP", () => {
  beforeEach(() => {
    resetTrustedCIDRsCache();
    delete process.env.TRUSTED_PROXY_CIDRS;
  });

  afterEach(() => {
    resetTrustedCIDRsCache();
    delete process.env.TRUSTED_PROXY_CIDRS;
  });

  it("returns X-Forwarded-For from trusted proxy", () => {
    // Direct connection from localhost (trusted)
    const result = getClientIP(
      "127.0.0.1",
      "203.0.113.1, 10.0.0.1",
      undefined
    );
    expect(result).toBe("203.0.113.1");
  });

  it("returns X-Real-IP from trusted proxy when no X-Forwarded-For", () => {
    const result = getClientIP("127.0.0.1", undefined, "203.0.113.1");
    expect(result).toBe("203.0.113.1");
  });

  it("ignores forwarded headers from untrusted sources", () => {
    // Direct connection from public IP (NOT trusted)
    const result = getClientIP(
      "8.8.8.8",
      "spoofed-ip",
      "also-spoofed"
    );
    expect(result).toBe("8.8.8.8");
  });

  it("uses direct IP when no forwarded headers", () => {
    const result = getClientIP("192.168.1.100", undefined, undefined);
    expect(result).toBe("192.168.1.100");
  });

  it("falls back to forwarded headers when no direct IP", () => {
    // This can happen in some proxy configurations
    const result = getClientIP(undefined, "203.0.113.1", undefined);
    expect(result).toBe("203.0.113.1");
  });

  it("returns unknown when no IP info available", () => {
    const result = getClientIP(undefined, undefined, undefined);
    expect(result).toBe("unknown");
  });

  it("handles direct connection from Docker network", () => {
    // Docker default bridge network
    const result = getClientIP(
      "172.17.0.2",
      "real-client-ip",
      undefined
    );
    expect(result).toBe("real-client-ip");
  });

  it("extracts first IP from X-Forwarded-For chain", () => {
    const result = getClientIP(
      "10.0.0.1",
      "client-ip, proxy1, proxy2",
      undefined
    );
    expect(result).toBe("client-ip");
  });

  it("trims whitespace from forwarded IPs", () => {
    const result = getClientIP(
      "127.0.0.1",
      "  203.0.113.1  , 10.0.0.1",
      undefined
    );
    expect(result).toBe("203.0.113.1");
  });

  describe("security: spoofing prevention", () => {
    it("prevents rate limit bypass via header spoofing", () => {
      // Attacker directly connects (public IP) and sets fake X-Forwarded-For
      const spoofedIP1 = getClientIP("8.8.8.8", "fake-ip-1", undefined);
      const spoofedIP2 = getClientIP("8.8.8.8", "fake-ip-2", undefined);

      // Both should return the real direct IP, not the spoofed headers
      expect(spoofedIP1).toBe("8.8.8.8");
      expect(spoofedIP2).toBe("8.8.8.8");
      expect(spoofedIP1).toBe(spoofedIP2);
    });

    it("still allows legitimate forwarding from reverse proxy", () => {
      // Request comes through nginx on localhost
      const clientIP = getClientIP("127.0.0.1", "real-client-203.0.113.1", undefined);
      expect(clientIP).toBe("real-client-203.0.113.1");
    });
  });
});

describe("IPv6 support", () => {
  beforeEach(() => {
    resetTrustedCIDRsCache();
    delete process.env.TRUSTED_PROXY_CIDRS;
  });

  afterEach(() => {
    resetTrustedCIDRsCache();
    delete process.env.TRUSTED_PROXY_CIDRS;
  });

  it("trusts IPv6 loopback", () => {
    expect(isTrustedProxy("::1")).toBe(true);
  });

  it("trusts IPv6 unique local addresses", () => {
    expect(isTrustedProxy("fc00::1")).toBe(true);
    expect(isTrustedProxy("fd00::1")).toBe(true);
  });

  it("trusts IPv6 link-local", () => {
    expect(isTrustedProxy("fe80::1")).toBe(true);
  });

  it("does NOT trust global IPv6", () => {
    expect(isTrustedProxy("2001:db8::1")).toBe(false);
  });

  it("handles abbreviated IPv6", () => {
    // Full form of ::1
    expect(isTrustedProxy("0:0:0:0:0:0:0:1")).toBe(true);
  });
});
