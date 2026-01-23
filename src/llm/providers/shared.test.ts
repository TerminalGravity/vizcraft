/**
 * Tests for shared LLM provider utilities
 */

import { describe, test, expect, mock } from "bun:test";
import {
  delay,
  backoffDelay,
  buildUpdatedSpec,
  buildDiagramContext,
  validateTransformOutput,
  withCircuitBreaker,
  executeWithRetry,
} from "./shared";
import type { DiagramSpec } from "../../types";
import type { DiagramTransformOutput } from "../types";
import { createLogger } from "../../logging";

const log = createLogger("shared-test");

describe("shared LLM utilities", () => {
  describe("delay", () => {
    test("delays for specified duration", async () => {
      const start = Date.now();
      await delay(50);
      const elapsed = Date.now() - start;
      // Allow some tolerance for timing
      expect(elapsed).toBeGreaterThanOrEqual(45);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe("backoffDelay", () => {
    test("increases delay exponentially", async () => {
      // We can't easily test actual delays without timing, so we test the function doesn't throw
      // and returns a promise
      const promise = backoffDelay(0, 10, 100);
      expect(promise).toBeInstanceOf(Promise);
      await promise;
    });

    test("caps at maxMs", async () => {
      const start = Date.now();
      await backoffDelay(10, 10, 50); // Would be 10240ms without cap
      const elapsed = Date.now() - start;
      // Should be around 50ms (max) + up to 20% jitter = ~60ms
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe("buildUpdatedSpec", () => {
    const baseSpec: DiagramSpec = {
      type: "flowchart",
      nodes: [],
      edges: [],
    };

    test("builds spec from output", () => {
      const output: DiagramTransformOutput = {
        nodes: [
          { id: "n1", label: "Node 1", type: "box", color: "#ff0000" },
          { id: "n2", label: "Node 2" },
        ],
        edges: [{ from: "n1", to: "n2", label: "connects", style: "solid" }],
        changes: ["Added nodes"],
      };

      const result = buildUpdatedSpec(baseSpec, output);

      expect(result.type).toBe("flowchart");
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0]).toEqual({
        id: "n1",
        label: "Node 1",
        type: "box",
        color: "#ff0000",
        position: undefined,
        details: undefined,
        width: undefined,
        height: undefined,
      });
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        id: undefined,
        from: "n1",
        to: "n2",
        label: "connects",
        style: "solid",
        color: undefined,
      });
    });

    test("preserves original spec properties", () => {
      const specWithTheme: DiagramSpec = {
        type: "architecture",
        theme: "dark",
        nodes: [{ id: "old", label: "Old" }],
        edges: [],
      };

      const output: DiagramTransformOutput = {
        nodes: [{ id: "new", label: "New" }],
        edges: [],
        changes: ["Replaced"],
      };

      const result = buildUpdatedSpec(specWithTheme, output);

      expect(result.theme).toBe("dark");
      expect(result.type).toBe("architecture");
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe("new");
    });

    test("handles all optional node properties", () => {
      const output: DiagramTransformOutput = {
        nodes: [
          {
            id: "n1",
            label: "Full Node",
            type: "database",
            color: "#00ff00",
            position: { x: 100, y: 200 },
            details: "A database node",
            width: 150,
            height: 75,
          },
        ],
        edges: [],
        changes: ["Added full node"],
      };

      const result = buildUpdatedSpec(baseSpec, output);

      expect(result.nodes[0]).toEqual({
        id: "n1",
        label: "Full Node",
        type: "database",
        color: "#00ff00",
        position: { x: 100, y: 200 },
        details: "A database node",
        width: 150,
        height: 75,
      });
    });

    test("handles all optional edge properties", () => {
      const output: DiagramTransformOutput = {
        nodes: [
          { id: "n1", label: "A" },
          { id: "n2", label: "B" },
        ],
        edges: [
          {
            id: "e1",
            from: "n1",
            to: "n2",
            label: "Full Edge",
            style: "dashed",
            color: "#0000ff",
          },
        ],
        changes: ["Added full edge"],
      };

      const result = buildUpdatedSpec(baseSpec, output);

      expect(result.edges[0]).toEqual({
        id: "e1",
        from: "n1",
        to: "n2",
        label: "Full Edge",
        style: "dashed",
        color: "#0000ff",
      });
    });
  });

  describe("buildDiagramContext", () => {
    const spec: DiagramSpec = {
      type: "flowchart",
      theme: "light",
      nodes: [{ id: "n1", label: "Test" }],
      edges: [],
    };

    test("builds context with spec and prompt", () => {
      const result = buildDiagramContext(spec, "Add a database");

      expect(result).toContain("Current diagram state:");
      expect(result).toContain("```json");
      expect(result).toContain('"type": "flowchart"');
      expect(result).toContain('"theme": "light"');
      expect(result).toContain("Instruction: Add a database");
    });

    test("includes optional context", () => {
      const result = buildDiagramContext(spec, "Add a database", "This is a microservices diagram");

      expect(result).toContain("Context: This is a microservices diagram");
    });

    test("omits context section when not provided", () => {
      const result = buildDiagramContext(spec, "Add a database");

      expect(result).not.toContain("Context:");
    });
  });

  describe("validateTransformOutput", () => {
    test("returns validated output for valid input", () => {
      const valid = {
        nodes: [{ id: "n1", label: "Test" }],
        edges: [],
        changes: ["Added node"],
      };

      const result = validateTransformOutput(valid, log);

      expect("error" in result).toBe(false);
      expect((result as DiagramTransformOutput).nodes).toHaveLength(1);
    });

    test("returns error for invalid input", () => {
      const invalid = {
        nodes: "not an array",
        edges: [],
        changes: [],
      };

      const result = validateTransformOutput(invalid, log);

      expect("error" in result).toBe(true);
      expect((result as { error: string }).error).toContain("Invalid transformation output");
    });

    test("returns error for missing required fields", () => {
      const incomplete = {
        nodes: [],
        // missing edges and changes
      };

      const result = validateTransformOutput(incomplete, log);

      expect("error" in result).toBe(true);
    });
  });

  describe("executeWithRetry", () => {
    test("succeeds on first attempt", async () => {
      const attemptFn = mock(() => Promise.resolve("success"));

      const result = await executeWithRetry(attemptFn, {
        maxRetries: 2,
        log,
      });

      expect(result).toBe("success");
      expect(attemptFn).toHaveBeenCalledTimes(1);
    });

    test("retries on failure", async () => {
      let attempts = 0;
      const attemptFn = mock(() => {
        attempts++;
        if (attempts < 2) {
          return Promise.reject(new Error("Temporary failure"));
        }
        return Promise.resolve("success after retry");
      });

      const result = await executeWithRetry(attemptFn, {
        maxRetries: 2,
        log,
        onRetry: () => Promise.resolve(), // Fast retry for tests
      });

      expect(result).toBe("success after retry");
      expect(attemptFn).toHaveBeenCalledTimes(2);
    });

    test("throws after max retries", async () => {
      const attemptFn = mock(() => Promise.reject(new Error("Persistent failure")));

      await expect(
        executeWithRetry(attemptFn, {
          maxRetries: 2,
          log,
          onRetry: () => Promise.resolve(),
        })
      ).rejects.toThrow("Persistent failure");

      expect(attemptFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    test("uses custom onRetry handler", async () => {
      let retryCount = 0;
      const onRetry = mock(async () => {
        retryCount++;
      });

      const attemptFn = mock(() => Promise.reject(new Error("Fail")));

      try {
        await executeWithRetry(attemptFn, {
          maxRetries: 2,
          log,
          onRetry,
        });
      } catch {
        // Expected to throw
      }

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(retryCount).toBe(2);
    });
  });
});
