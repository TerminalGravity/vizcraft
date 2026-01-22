/**
 * JWT Token Tests
 */

import { describe, it, expect } from "bun:test";
import { signJWT, verifyJWT, decodeJWT, isTokenExpiringSoon } from "./jwt";

describe("JWT", () => {
  describe("signJWT", () => {
    it("creates a valid JWT token", async () => {
      const token = await signJWT({ sub: "user-123", role: "user" });

      expect(token).toBeDefined();
      expect(token.split(".")).toHaveLength(3);
    });

    it("includes standard claims", async () => {
      const token = await signJWT({ sub: "user-123" });
      const payload = decodeJWT(token);

      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe("user-123");
      expect(payload!.iss).toBe("vizcraft");
      expect(payload!.iat).toBeDefined();
      expect(payload!.exp).toBeDefined();
    });

    it("sets custom expiration", async () => {
      const token = await signJWT({ sub: "user-123" }, { expiresInSeconds: 60 });
      const payload = decodeJWT(token);

      expect(payload!.exp - payload!.iat).toBe(60);
    });

    it("preserves custom claims", async () => {
      const token = await signJWT({
        sub: "user-123",
        role: "admin",
        customField: "custom-value",
      });
      const payload = decodeJWT(token);

      expect(payload!.role).toBe("admin");
      expect(payload!.customField).toBe("custom-value");
    });
  });

  describe("verifyJWT", () => {
    it("verifies valid tokens", async () => {
      const token = await signJWT({ sub: "user-123" });
      const result = await verifyJWT(token);

      expect(result.valid).toBe(true);
      expect(result.payload?.sub).toBe("user-123");
    });

    it("rejects tokens with invalid signature", async () => {
      const token = await signJWT({ sub: "user-123" });
      // Tamper with the signature
      const tampered = token.slice(0, -5) + "XXXXX";
      const result = await verifyJWT(tampered);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid signature");
    });

    it("rejects expired tokens", async () => {
      const token = await signJWT({ sub: "user-123" }, { expiresInSeconds: -1 });
      const result = await verifyJWT(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Token expired");
    });

    it("rejects malformed tokens", async () => {
      const result = await verifyJWT("not-a-valid-token");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid token format");
    });

    it("rejects tokens with wrong issuer", async () => {
      // Create a token manually with wrong issuer
      const token = await signJWT({ sub: "user-123" });
      const parts = token.split(".");
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      payload.iss = "wrong-issuer";
      const newPayload = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

      // This won't verify because signature is for original payload
      const result = await verifyJWT(`${parts[0]}.${newPayload}.${parts[2]}`);

      expect(result.valid).toBe(false);
    });
  });

  describe("decodeJWT", () => {
    it("decodes token without verification", async () => {
      const token = await signJWT({ sub: "user-123", role: "admin" });
      const payload = decodeJWT(token);

      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe("user-123");
      expect(payload!.role).toBe("admin");
    });

    it("returns null for invalid tokens", () => {
      expect(decodeJWT("invalid")).toBeNull();
      expect(decodeJWT("")).toBeNull();
      expect(decodeJWT("a.b")).toBeNull();
    });
  });

  describe("isTokenExpiringSoon", () => {
    it("returns true for token expiring within threshold", async () => {
      const token = await signJWT({ sub: "user-123" }, { expiresInSeconds: 60 });
      const payload = decodeJWT(token)!;

      expect(isTokenExpiringSoon(payload, 120)).toBe(true);
    });

    it("returns false for token not expiring soon", async () => {
      const token = await signJWT({ sub: "user-123" }, { expiresInSeconds: 3600 });
      const payload = decodeJWT(token)!;

      expect(isTokenExpiringSoon(payload, 300)).toBe(false);
    });
  });
});
