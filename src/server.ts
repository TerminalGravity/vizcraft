/**
 * Vizcraft MCP Server
 *
 * AI-Native Diagramming for Claude Code
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { nanoid } from "nanoid";
import { protectedStorage as storage } from "./storage/protected-storage";
import type { DiagramSpec, DiagramChange } from "./types";
import { sanitizeFilename, createSafeExportPath, validateExportPath } from "./utils/path-safety";

const PORT = parseInt(process.env.PORT || "8420");
const WEB_URL = process.env.WEB_URL || `http://localhost:3420`;

// ==================== Error Handling ====================

/**
 * MCP Tool Result type
 */
interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
}

/**
 * Structured error response for MCP tools
 */
interface MCPErrorResponse {
  success: false;
  error: string;
  code: string;
  requestId: string;
  timestamp: string;
  suggestion?: string;
}

/**
 * Create a structured error response
 */
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

/**
 * Wrap a tool handler with error boundary
 * Catches all exceptions and returns structured error responses
 */
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

      console.error(`[mcp] Tool "${toolName}" failed after ${duration}ms:`, err);

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

// Create MCP server
const server = new McpServer({
  name: "vizcraft",
  version: "0.1.0",
});

// Schema definitions
const DiagramNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["box", "diamond", "circle", "database", "cloud", "cylinder"]).optional(),
  color: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  details: z.string().optional(),
});

const DiagramEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  style: z.enum(["solid", "dashed", "dotted"]).optional(),
  color: z.string().optional(),
});

const DiagramSpecSchema = z.object({
  type: z.enum(["flowchart", "architecture", "sequence", "freeform"]),
  theme: z.enum(["dark", "light", "professional"]).optional(),
  title: z.string().optional(),
  nodes: z.array(DiagramNodeSchema),
  edges: z.array(DiagramEdgeSchema),
});

// ==================== Health Check Tool ====================

// Tool: health_check
server.tool(
  "health_check",
  "Check MCP server health and connectivity",
  {},
  async () => {
    const startTime = Date.now();
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    // Check database
    try {
      const dbStart = Date.now();
      const stats = storage.getStats();
      checks.database = {
        status: "ok",
        latencyMs: Date.now() - dbStart,
      };
    } catch (err) {
      checks.database = {
        status: "error",
        error: err instanceof Error ? err.message : "Database check failed",
      };
    }

    // Check web server connectivity
    try {
      const webStart = Date.now();
      const response = await fetch(`${WEB_URL}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      checks.webServer = {
        status: response.ok ? "ok" : "degraded",
        latencyMs: Date.now() - webStart,
      };
    } catch (err) {
      checks.webServer = {
        status: "unreachable",
        error: err instanceof Error ? err.message : "Web server not reachable",
      };
    }

    // Determine overall status
    const hasError = Object.values(checks).some((c) => c.status === "error");
    const hasDegraded = Object.values(checks).some((c) =>
      c.status === "degraded" || c.status === "unreachable"
    );

    const status = hasError ? "unhealthy" : hasDegraded ? "degraded" : "healthy";

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              status,
              timestamp: new Date().toISOString(),
              totalLatencyMs: Date.now() - startTime,
              checks,
              server: {
                name: "vizcraft",
                version: "0.1.0",
                webUrl: WEB_URL,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ==================== Diagram Tools ====================

// Tool: create_diagram
server.tool(
  "create_diagram",
  "Create a new interactive diagram. Returns URL to view/edit in browser.",
  {
    name: z.string().describe("Name for the diagram"),
    project: z.string().optional().describe("Project name (defaults to 'default')"),
    spec: DiagramSpecSchema.describe("Diagram specification with nodes and edges"),
  },
  withErrorBoundary("create_diagram", async ({ name, project, spec }) => {
    const diagram = storage.createDiagram(name, project || "default", spec as DiagramSpec);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              id: diagram.id,
              name: diagram.name,
              url: `${WEB_URL}/diagram/${diagram.id}`,
              nodeCount: spec.nodes.length,
              edgeCount: spec.edges.length,
              message: `Diagram "${name}" created. Open ${WEB_URL}/diagram/${diagram.id} to view/edit.`,
            },
            null,
            2
          ),
        },
      ],
    };
  })
);

// Tool: update_diagram
server.tool(
  "update_diagram",
  "Update an existing diagram with new spec or changes",
  {
    id: z.string().describe("Diagram ID"),
    spec: DiagramSpecSchema.optional().describe("Complete new spec (replaces existing)"),
    message: z.string().optional().describe("Version message"),
  },
  withErrorBoundary("update_diagram", async ({ id, spec, message }) => {
    const existing = storage.getDiagram(id);
    if (!existing) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Diagram not found" }) }],
      };
    }

    const newSpec = spec || existing.spec;
    const updated = storage.updateDiagram(id, newSpec as DiagramSpec, message);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              id: updated?.id,
              url: `${WEB_URL}/diagram/${id}`,
              message: `Diagram updated. View at ${WEB_URL}/diagram/${id}`,
            },
            null,
            2
          ),
        },
      ],
    };
  })
);

// Tool: describe_diagram
server.tool(
  "describe_diagram",
  "Get a structured description of a diagram for Claude to understand",
  {
    id: z.string().describe("Diagram ID"),
  },
  withErrorBoundary("describe_diagram", async ({ id }) => {
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Diagram not found" }) }],
      };
    }

    const { spec } = diagram;
    const nodeLabels = spec.nodes.map((n) => n.label).join(", ");
    const edgeDescriptions = spec.edges
      .map((e) => {
        const fromNode = spec.nodes.find((n) => n.id === e.from);
        const toNode = spec.nodes.find((n) => n.id === e.to);
        return `${fromNode?.label || e.from} → ${toNode?.label || e.to}${e.label ? ` (${e.label})` : ""}`;
      })
      .join("; ");

    const description = {
      id: diagram.id,
      name: diagram.name,
      project: diagram.project,
      type: spec.type,
      theme: spec.theme || "dark",
      summary: `A ${spec.type} diagram with ${spec.nodes.length} nodes and ${spec.edges.length} edges`,
      nodeCount: spec.nodes.length,
      edgeCount: spec.edges.length,
      nodes: spec.nodes.map((n) => ({ id: n.id, label: n.label, type: n.type })),
      edges: spec.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
      nodeLabels,
      connections: edgeDescriptions,
      url: `${WEB_URL}/diagram/${id}`,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(description, null, 2) }],
    };
  })
);

// Tool: list_diagrams
server.tool(
  "list_diagrams",
  "List all diagrams, optionally filtered by project",
  {
    project: z.string().optional().describe("Filter by project name"),
  },
  withErrorBoundary("list_diagrams", async ({ project }) => {
    const diagrams = storage.listDiagrams(project);

    const list = diagrams.map((d) => ({
      id: d.id,
      name: d.name,
      project: d.project,
      nodeCount: d.spec.nodes.length,
      edgeCount: d.spec.edges.length,
      updatedAt: d.updatedAt,
      url: `${WEB_URL}/diagram/${d.id}`,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              count: list.length,
              diagrams: list,
              projects: storage.listProjects(),
            },
            null,
            2
          ),
        },
      ],
    };
  })
);

// Tool: delete_diagram
server.tool(
  "delete_diagram",
  "Delete a diagram",
  {
    id: z.string().describe("Diagram ID to delete"),
  },
  withErrorBoundary("delete_diagram", async ({ id }) => {
    const deleted = await storage.deleteDiagram(id);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: deleted, message: deleted ? "Diagram deleted" : "Diagram not found" }),
        },
      ],
    };
  })
);

// Tool: export_diagram
server.tool(
  "export_diagram",
  "Export diagram to file (json, svg, or png format)",
  {
    id: z.string().describe("Diagram ID"),
    format: z.enum(["json", "png", "svg", "pdf"]).default("json").describe("Export format"),
    path: z.string().optional().describe("Output path (defaults to ./data/exports/)"),
  },
  withErrorBoundary("export_diagram", async ({ id, format, path }) => {
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Diagram not found" }) }],
      };
    }

    // Create safe export path - sanitize diagram name and validate path
    const safeName = sanitizeFilename(`${diagram.name}-${id}`);
    let exportPath: string;

    try {
      if (path) {
        // User provided a path - validate and sanitize it
        exportPath = validateExportPath(path, "./data/exports");
        // Override extension based on format
        exportPath = exportPath.replace(/\.[^.]+$/, "") + `.${format}`;
      } else {
        // Use default path with sanitized name
        exportPath = createSafeExportPath(safeName, format, "./data/exports");
      }
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Invalid export path" }) }],
      };
    }

    if (format === "json") {
      await Bun.write(exportPath, JSON.stringify(diagram.spec, null, 2));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              path: exportPath,
              format,
              size: JSON.stringify(diagram.spec).length,
            }),
          },
        ],
      };
    }

    if (format === "svg") {
      // Fetch SVG from web server
      try {
        const response = await fetch(`${WEB_URL}/api/diagrams/${id}/export/svg`);
        if (!response.ok) throw new Error("Failed to generate SVG");

        const svgContent = await response.text();
        await Bun.write(exportPath, svgContent);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                path: exportPath,
                format,
                size: svgContent.length,
                message: `SVG exported to ${exportPath}`,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "SVG export requires web server running. Start with: bun run web:dev",
                webUrl: `${WEB_URL}/diagram/${id}`,
              }),
            },
          ],
        };
      }
    }

    if (format === "png") {
      // PNG requires browser rendering
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              message: "PNG export requires browser rendering",
              instructions: [
                `1. Open ${WEB_URL}/diagram/${id}`,
                "2. Click 'Export PNG' button in the panel",
                "Or use SVG format for server-side export",
              ],
              webUrl: `${WEB_URL}/diagram/${id}`,
              svgAlternative: `Use format: 'svg' for server-side export`,
            }),
          },
        ],
      };
    }

    if (format === "pdf") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              message: "PDF export requires browser rendering (uses jsPDF)",
              instructions: [
                `1. Open ${WEB_URL}/diagram/${id}`,
                "2. Click 'Export PDF' button in the panel",
              ],
              webUrl: `${WEB_URL}/diagram/${id}`,
              svgAlternative: "Use format: 'svg' for server-side export",
            }),
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: `Unknown format: ${format}` }) }],
    };
  })
);

// Resource: diagram context for "Send to Claude"
server.resource(
  "diagram",
  "vizcraft://diagram/{id}",
  async (uri) => {
    const id = uri.pathname.split("/").pop();
    if (!id) {
      return { contents: [{ uri: uri.href, text: "Invalid diagram URI" }] };
    }

    const diagram = storage.getDiagram(id);
    if (!diagram) {
      return { contents: [{ uri: uri.href, text: "Diagram not found" }] };
    }

    const context = `
# Diagram: ${diagram.name}
Project: ${diagram.project}
Type: ${diagram.spec.type}

## Nodes (${diagram.spec.nodes.length})
${diagram.spec.nodes.map((n) => `- ${n.label} (${n.type || "box"})`).join("\n")}

## Connections (${diagram.spec.edges.length})
${diagram.spec.edges
  .map((e) => {
    const from = diagram.spec.nodes.find((n) => n.id === e.from)?.label || e.from;
    const to = diagram.spec.nodes.find((n) => n.id === e.to)?.label || e.to;
    return `- ${from} → ${to}${e.label ? `: ${e.label}` : ""}`;
  })
  .join("\n")}

View/Edit: ${WEB_URL}/diagram/${id}
`;

    return {
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: context }],
    };
  }
);

// Start server
async function main() {
  console.error(`[vizcraft] Starting MCP server...`);
  console.error(`[vizcraft] Data directory: ${process.env.DATA_DIR || "./data"}`);
  console.error(`[vizcraft] Web URL: ${WEB_URL}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[vizcraft] MCP server running on stdio`);
}

main().catch((err) => {
  console.error("[vizcraft] Fatal error:", err);
  process.exit(1);
});
