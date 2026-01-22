/**
 * Vizcraft MCP Server
 *
 * AI-Native Diagramming for Claude Code
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { storage } from "./storage/db";
import type { DiagramSpec, DiagramChange } from "./types";

const PORT = parseInt(process.env.PORT || "8420");
const WEB_URL = process.env.WEB_URL || `http://localhost:3420`;

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

// Tool: create_diagram
server.tool(
  "create_diagram",
  "Create a new interactive diagram. Returns URL to view/edit in browser.",
  {
    name: z.string().describe("Name for the diagram"),
    project: z.string().optional().describe("Project name (defaults to 'default')"),
    spec: DiagramSpecSchema.describe("Diagram specification with nodes and edges"),
  },
  async ({ name, project, spec }) => {
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
  }
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
  async ({ id, spec, message }) => {
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
  }
);

// Tool: describe_diagram
server.tool(
  "describe_diagram",
  "Get a structured description of a diagram for Claude to understand",
  {
    id: z.string().describe("Diagram ID"),
  },
  async ({ id }) => {
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
  }
);

// Tool: list_diagrams
server.tool(
  "list_diagrams",
  "List all diagrams, optionally filtered by project",
  {
    project: z.string().optional().describe("Filter by project name"),
  },
  async ({ project }) => {
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
  }
);

// Tool: delete_diagram
server.tool(
  "delete_diagram",
  "Delete a diagram",
  {
    id: z.string().describe("Diagram ID to delete"),
  },
  async ({ id }) => {
    const deleted = storage.deleteDiagram(id);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: deleted, message: deleted ? "Diagram deleted" : "Diagram not found" }),
        },
      ],
    };
  }
);

// Tool: export_diagram
server.tool(
  "export_diagram",
  "Export diagram to file (json format for now, png/svg coming soon)",
  {
    id: z.string().describe("Diagram ID"),
    format: z.enum(["json", "png", "svg"]).default("json").describe("Export format"),
    path: z.string().optional().describe("Output path (defaults to ./data/exports/)"),
  },
  async ({ id, format, path }) => {
    const diagram = storage.getDiagram(id);
    if (!diagram) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Diagram not found" }) }],
      };
    }

    if (format !== "json") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: false, error: `${format} export not yet implemented. Use json for now.` }),
          },
        ],
      };
    }

    const exportPath = path || `./data/exports/${diagram.name}-${id}.json`;
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
