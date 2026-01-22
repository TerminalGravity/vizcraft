/**
 * Health Check Tests
 */

import { describe, it, expect } from "bun:test";
import {
  checkDatabase,
  checkFilesystem,
  checkMemory,
  runHealthChecks,
  livenessCheck,
  readinessCheck,
  type HealthResponse,
} from "./health";

describe("Health Checks", () => {
  describe("checkDatabase", () => {
    it("returns ok status when database is accessible", async () => {
      const result = await checkDatabase();

      expect(result.status).toBe("ok");
      expect(result.latencyMs).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.details).toBeDefined();
      expect(typeof result.details?.diagramCount).toBe("number");
    });

    it("includes latency measurement", async () => {
      const result = await checkDatabase();

      expect(result.latencyMs).toBeDefined();
      expect(result.latencyMs).toBeLessThan(1000); // Should be fast
    });
  });

  describe("checkFilesystem", () => {
    it("returns ok status when filesystem is writable", async () => {
      const result = await checkFilesystem();

      expect(result.status).toBe("ok");
      expect(result.latencyMs).toBeDefined();
    });

    it("cleans up test files", async () => {
      // Run the check
      await checkFilesystem();

      // Check that no health check files are left behind
      const glob = new Bun.Glob(".health-check-*");
      const files: string[] = [];
      for await (const file of glob.scan("./data")) {
        files.push(file);
      }

      expect(files.length).toBe(0);
    });
  });

  describe("checkMemory", () => {
    it("returns memory usage information", () => {
      const result = checkMemory();

      expect(result.details).toBeDefined();
      expect(typeof result.details?.heapUsedMB).toBe("number");
      expect(typeof result.details?.heapTotalMB).toBe("number");
      expect(typeof result.details?.rssMB).toBe("number");
      expect(typeof result.details?.thresholdMB).toBe("number");
    });

    it("returns ok status when under threshold", () => {
      const result = checkMemory();

      // In tests, memory should be well under the default 512MB threshold
      expect(result.status).toBe("ok");
    });
  });

  describe("runHealthChecks", () => {
    it("returns comprehensive health response", async () => {
      const response = await runHealthChecks();

      expect(response.status).toBeDefined();
      expect(["healthy", "degraded", "unhealthy"]).toContain(response.status);
      expect(response.timestamp).toBeDefined();
      expect(response.uptime).toBeGreaterThanOrEqual(0);
      expect(response.version).toBeDefined();
    });

    it("includes all check results", async () => {
      const response = await runHealthChecks();

      expect(response.checks.database).toBeDefined();
      expect(response.checks.filesystem).toBeDefined();
      expect(response.checks.memory).toBeDefined();
    });

    it("returns healthy status when all checks pass", async () => {
      const response = await runHealthChecks();

      // In normal test environment, everything should pass
      expect(response.status).toBe("healthy");
    });
  });

  describe("livenessCheck", () => {
    it("returns ok status with timestamp", () => {
      const result = livenessCheck();

      expect(result.status).toBe("ok");
      expect(result.timestamp).toBeDefined();
      expect(() => new Date(result.timestamp)).not.toThrow();
    });
  });

  describe("readinessCheck", () => {
    it("returns ready true when all systems are operational", async () => {
      const result = await readinessCheck();

      expect(result.ready).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe("Response structure", () => {
    it("has valid ISO timestamp", async () => {
      const response = await runHealthChecks();

      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("tracks uptime in seconds", async () => {
      const response = await runHealthChecks();

      expect(typeof response.uptime).toBe("number");
      expect(response.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});
