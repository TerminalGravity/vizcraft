# VIZCRAFT - AI-Native Diagramming for Claude Code

## Project Vision

Vizcraft is an MCP server + Web UI that enables Claude Code to create, update, and manage interactive diagrams. Unlike fragile SVG generation, Vizcraft uses modern canvas libraries (tldraw/React Flow) for robust, interactive visualizations.

**Key Insight:** Claude generates JSON specs → Vizcraft renders interactive diagrams → User can edit → Changes sync back to Claude.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  DOCKER COMPOSE STACK                                               │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │   mcp-server    │  │    web-ui       │  │   sqlite        │     │
│  │   (Bun+Hono)    │  │   (Bun+React)   │  │   (bun:sqlite)  │     │
│  │   Port: 8420    │  │   Port: 3420    │  │                 │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

## MCP Tools

```typescript
// Create new diagram
mcp__vizcraft__create_diagram(
    name: string,
    project?: string,
    spec: DiagramSpec
) → { id, url, thumbnail }

// Update existing diagram
mcp__vizcraft__update_diagram(
    id: string,
    changes: Change[]
)

// Get diagram context for Claude
mcp__vizcraft__describe_diagram(id: string) → DiagramDescription

// Export diagram
mcp__vizcraft__export(id: string, format: "png" | "svg" | "pdf", path?: string)

// List diagrams
mcp__vizcraft__list_diagrams(project?: string) → Diagram[]
```

## Diagram Spec Format

```typescript
interface DiagramSpec {
  type: "flowchart" | "architecture" | "sequence" | "freeform";
  theme?: "dark" | "light" | "professional";
  nodes: Array<{
    id: string;
    label: string;
    type?: "box" | "diamond" | "circle" | "database" | "cloud";
    color?: string;
    position?: { x: number; y: number };
    details?: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
    style?: "solid" | "dashed" | "dotted";
    color?: string;
  }>;
  groups?: Array<{
    id: string;
    label: string;
    nodeIds: string[];
    color?: string;
  }>;
}
```

## Web UI Features

1. **Canvas Editor** - tldraw-powered infinite canvas
2. **Project Browser** - Organize diagrams by project (linked to filesystem)
3. **Agent Panel** - Configurable AI agents for layout/style/annotation
4. **Send to Claude** - Push diagram context back to Claude Code
5. **Export** - PNG, SVG, PDF export

## Agent System

Agents are YAML configs that transform diagrams:

```yaml
# agents/layout-agent.yaml
name: "Auto Layout"
type: "rule-based"
actions:
  - dagre_layout
  - snap_to_grid

# agents/style-agent.yaml
name: "Professional Theme"
type: "preset"
styles:
  node_fill: "#1e293b"
  node_stroke: "#3b82f6"

# agents/explain-agent.yaml
name: "Add Annotations"
type: "llm"
provider: "anthropic"
prompt: "Add helpful annotations to this diagram"
```

## Tech Stack

- **Runtime:** Bun
- **MCP Server:** Hono + @modelcontextprotocol/sdk
- **Database:** bun:sqlite
- **Web UI:** Bun.serve() + React + tldraw
- **Packaging:** Docker

## Bun-Specific Patterns

- Use `Bun.serve()` for HTTP, not express
- Use `bun:sqlite` for database, not better-sqlite3
- Use `Bun.file()` for file ops, not fs
- Bun auto-loads .env, no dotenv needed
- Use `bun test` for testing

## File Structure

```
vizcraft/
├── src/
│   ├── server.ts          # Main MCP server
│   ├── tools/             # MCP tool implementations
│   │   ├── create.ts
│   │   ├── update.ts
│   │   ├── describe.ts
│   │   ├── export.ts
│   │   └── list.ts
│   ├── storage/           # Database layer
│   │   └── db.ts
│   └── types/             # TypeScript types
│       └── index.ts
├── web/
│   ├── index.html         # Web UI entry
│   ├── app.tsx            # React app
│   └── canvas.tsx         # tldraw wrapper
├── data/
│   ├── diagrams/          # Diagram JSON storage
│   ├── exports/           # Exported files
│   └── agents/            # Agent YAML configs
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Commands

```bash
bun run dev          # Start dev server with hot reload
bun run start        # Production start
bun test             # Run tests
docker compose up    # Run full stack
```

## Development Philosophy

- **Build fast, iterate faster** - Get working code first
- **JSON-first** - Diagrams are data, not code
- **Bidirectional** - Claude ↔ User editing flow
- **Project-aware** - Link to filesystem projects automatically
