/**
 * JWT Token Tests
 */

import { describe, it, expect } from "bun:test";
import { signJWT, verifyJWT, decodeJWT, isTokenExpiringSoon, MAX_TOKEN_SIZE } from "./jwt";

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

  describe("Security features", () => {
    describe("Token size limit", () => {
      it("exports MAX_TOKEN_SIZE constant", () => {
        expect(MAX_TOKEN_SIZE).toBe(8 * 1024);
      });

      it("rejects tokens exceeding size limit", async () => {
        // Create a token that would exceed the size limit
        const hugeToken = "a".repeat(MAX_TOKEN_SIZE + 1);
        const result = await verifyJWT(hugeToken);

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Token too large");
      });
    });

    describe("Algorithm validation", () => {
      it("rejects tokens with alg: none", async () => {
        // Craft a token with alg: none (algorithm confusion attack)
        const header = { alg: "none", typ: "JWT" };
        const payload = { sub: "attacker", iss: "vizcraft", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
        const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        const payloadB64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        // Use a non-empty fake signature to pass format validation
        const fakeToken = `${headerB64}.${payloadB64}.fakesignature`;

        const result = await verifyJWT(fakeToken);

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Unsupported algorithm");
      });

      it("rejects tokens with wrong algorithm", async () => {
        const header = { alg: "RS256", typ: "JWT" };
        const payload = { sub: "attacker", iss: "vizcraft", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
        const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        const payloadB64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        const fakeToken = `${headerB64}.${payloadB64}.fakesignature`;

        const result = await verifyJWT(fakeToken);

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Unsupported algorithm");
      });

      it("accepts tokens with correct HS256 algorithm", async () => {
        const token = await signJWT({ sub: "user-123" });
        const result = await verifyJWT(token);

        expect(result.valid).toBe(true);
      });
    });

    describe("Not-before (nbf) claim", () => {
      it("supports notBeforeSeconds option in signJWT", async () => {
        const token = await signJWT({ sub: "user-123" }, { notBeforeSeconds: 60 });
        const payload = decodeJWT(token);

        expect(payload).not.toBeNull();
        expect(payload!.nbf).toBeDefined();
        expect(payload!.nbf).toBe(payload!.iat + 60);
      });

      it("does not add nbf claim when notBeforeSeconds is 0 or undefined", async () => {
        const token1 = await signJWT({ sub: "user-123" });
        const token2 = await signJWT({ sub: "user-123" }, { notBeforeSeconds: 0 });

        const payload1 = decodeJWT(token1);
        const payload2 = decodeJWT(token2);

        expect(payload1!.nbf).toBeUndefined();
        expect(payload2!.nbf).toBeUndefined();
      });

      it("rejects tokens used before nbf time", async () => {
        // Create a token that's not valid until 1 hour from now
        const token = await signJWT({ sub: "user-123" }, { notBeforeSeconds: 3600 });
        const result = await verifyJWT(token);

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Token not yet valid");
      });

      it("accepts tokens after nbf time has passed", async () => {
        // Create a token with nbf in the past (already valid)
        const token = await signJWT({ sub: "user-123" }, { notBeforeSeconds: -1 });
        // Since we don't add nbf for <= 0 values, this should pass
        const result = await verifyJWT(token);

        expect(result.valid).toBe(true);
      });
    });
  });
});
