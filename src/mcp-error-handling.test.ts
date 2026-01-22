/**
 * MCP Error Handling Tests
 *
 * Tests for the error boundary and structured error response functionality
 */

import { describe, test, expect } from "bun:test";
import { nanoid } from "nanoid";

// Re-create the types and functions for testing (they're internal to server.ts)
interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
}

interface MCPErrorResponse {
  success: false;
  error: string;
  code: string;
  requestId: string;
  timestamp: string;
  suggestion?: string;
}

function createErrorResponse(
  error: string,
  code: string,
  suggestion?: string
): MCPToolResult {
  const response: MCPErrorResponse = {
    success: false,
    error,
    code,
    requestId: nanoid(8),
    timestamp: new Date().toISOString(),
    ...(suggestion && { suggestion }),
  };

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}

function withErrorBoundary<TArgs, TResult extends MCPToolResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>
): (args: TArgs) => Promise<TResult | MCPToolResult> {
  return async (args: TArgs): Promise<TResult | MCPToolResult> => {
    const startTime = Date.now();
    try {
      return await handler(args);
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Provide helpful suggestions based on error type
      let suggestion: string | undefined;
      let code = "TOOL_ERROR";

      if (errorMessage.includes("ECONNREFUSED")) {
        code = "CONNECTION_REFUSED";
        suggestion = "Ensure the web server is running with: bun run web:dev";
      } else if (errorMessage.includes("ENOENT")) {
        code = "FILE_NOT_FOUND";
        suggestion = "Check that the file path exists and is accessible";
      } else if (errorMessage.includes("database")) {
        code = "DATABASE_ERROR";
        suggestion = "Database may be locked or corrupted. Try restarting the server.";
      } else if (errorMessage.includes("timeout")) {
        code = "TIMEOUT";
        suggestion = "Operation took too long. Try with smaller data or check server load.";
      }

      return createErrorResponse(
        `Tool "${toolName}" failed: ${errorMessage}`,
        code,
        suggestion
      );
    }
  };
}

describe("createErrorResponse", () => {
  test("creates structured error response", () => {
    const result = createErrorResponse("Test error", "TEST_CODE");

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text) as MCPErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("Test error");
    expect(parsed.code).toBe("TEST_CODE");
    expect(parsed.requestId).toBeDefined();
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.suggestion).toBeUndefined();
  });

  test("includes suggestion when provided", () => {
    const result = createErrorResponse("Test error", "TEST_CODE", "Try this instead");

    const parsed = JSON.parse(result.content[0].text) as MCPErrorResponse;
    expect(parsed.suggestion).toBe("Try this instead");
  });

  test("generates unique request IDs", () => {
    const result1 = createErrorResponse("Error 1", "CODE1");
    const result2 = createErrorResponse("Error 2", "CODE2");

    const parsed1 = JSON.parse(result1.content[0].text) as MCPErrorResponse;
    const parsed2 = JSON.parse(result2.content[0].text) as MCPErrorResponse;

    expect(parsed1.requestId).not.toBe(parsed2.requestId);
  });

  test("includes valid ISO timestamp", () => {
    const result = createErrorResponse("Test error", "TEST_CODE");
    const parsed = JSON.parse(result.content[0].text) as MCPErrorResponse;

    const date = new Date(parsed.timestamp);
    expect(date.getTime()).not.toBeNaN();
  });
});

describe("withErrorBoundary", () => {
  test("passes through successful results", async () => {
    const successHandler = async (_args: { id: string }): Promise<MCPToolResult> => ({
      content: [{ type: "text", text: JSON.stringify({ success: true, data: "test" }) }],
    });

    const wrapped = withErrorBoundary("test_tool", successHandler);
    const result = await wrapped({ id: "123" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe("test");
  });

  test("catches errors and returns structured response", async () => {
    const failingHandler = async (_args: { id: string }): Promise<MCPToolResult> => {
      throw new Error("Something went wrong");
    };

    const wrapped = withErrorBoundary("test_tool", failingHandler);
    const result = await wrapped({ id: "123" });

    const parsed = JSON.parse(result.content[0].text) as MCPErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("test_tool");
    expect(parsed.error).toContain("Something went wrong");
    expect(parsed.code).toBe("TOOL_ERROR");
  });

  test("classifies ECONNREFUSED errors", async () => {
    const connectionHandler = async (): Promise<MCPToolResult> => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3420");
    };

    const wrapped = withErrorBoundary("fetch_data", connectionHandler);
    const result = await wrapped({});

    const parsed = JSON.parse(result.content[0].text) as MCPErrorResponse;
    expect(parsed.code).toBe("CONNECTION_REFUSED");
    expect(parsed.suggestion).toContain("web server");
  });

  test("classifies ENOENT errors", async () => {
    const fileHandler = async (): Promise<MCPToolResult> => {
      throw new Error("ENOENT: no such file or directory, open '/path/to/file'");
    };

    const wrapped = withErrorBoundary("read_file", fileHandler);
    const result = await wrapped({});

    const parsed = JSON.parse(result.content[0].text) as MCPErrorResponse;
    expect(parsed.code).toBe("FILE_NOT_FOUND");
    expect(parsed.suggestion).toContain("file path");
  });

  test("classifies database errors", async () => {
    const dbHandler = async (): Promise<MCPToolResult> => {
      throw new Error("database is locked");
    };

    const wrapped = withErrorBoundary("query_db", dbHandler);
    const result = await wrapped({});

    const parsed = JSON.parse(result.content[0].text) as MCPErrorResponse;
    expect(parsed.code).toBe("DATABASE_ERROR");
    expect(parsed.suggestion).toContain("Database");
  });

  test("classifies timeout errors", async () => {
    const slowHandler = async (): Promise<MCPToolResult> => {
      throw new Error("Operation timeout after 30000ms");
    };

    const wrapped = withErrorBoundary("slow_operation", slowHandler);
    const result = await wrapped({});

    const parsed = JSON.parse(result.content[0].text) as MCPErrorResponse;
    expect(parsed.code).toBe("TIMEOUT");
    expect(parsed.suggestion).toContain("took too long");
  });

  test("handles non-Error exceptions", async () => {
    const badHandler = async (): Promise<MCPToolResult> => {
      throw "string error";
    };

    const wrapped = withErrorBoundary("test_tool", badHandler);
    const result = await wrapped({});

    const parsed = JSON.parse(result.content[0].text) as MCPErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("string error");
  });

  test("preserves handler arguments", async () => {
    const argsHandler = async (args: { a: number; b: string }): Promise<MCPToolResult> => ({
      content: [{ type: "text", text: JSON.stringify({ a: args.a, b: args.b }) }],
    });

    const wrapped = withErrorBoundary("args_tool", argsHandler);
    const result = await wrapped({ a: 42, b: "hello" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.a).toBe(42);
    expect(parsed.b).toBe("hello");
  });
});

describe("Error Response Format", () => {
  test("error response is valid JSON", () => {
    const result = createErrorResponse("Test", "CODE");
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  test("error response has correct structure for MCP", () => {
    const result = createErrorResponse("Test", "CODE");

    // MCP expects { content: [{ type: string, text: string }] }
    expect(result).toHaveProperty("content");
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty("type");
    expect(result.content[0]).toHaveProperty("text");
  });

  test("error response text is pretty-printed JSON", () => {
    const result = createErrorResponse("Test error", "CODE");
    const text = result.content[0].text;

    // Pretty-printed JSON has newlines
    expect(text).toContain("\n");
    // And indentation
    expect(text).toContain("  ");
  });
});
