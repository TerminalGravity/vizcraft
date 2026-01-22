# VIZCRAFT

**AI-Native Diagramming for Claude Code**

> Claude generates JSON specs → Vizcraft renders interactive diagrams → User can edit → Changes sync back to Claude

## Features

- **MCP Server** - 6 tools for Claude Code integration (create, update, describe, list, delete, export)
- **Interactive Canvas** - tldraw-powered infinite canvas with pan/zoom/edit
- **AI Agents** - Rule-based (dagre layout), preset (themes), LLM-powered agents
- **Export** - PNG, SVG, PDF export
- **Version History** - Git-like versioning for diagrams
- **Dark/Light Theme** - System-preference aware
- **Mobile Responsive** - Works on tablet/mobile screens

## Quick Start

### Option 1: Run with Bun (Development)

```bash
# Clone and install
git clone https://github.com/TerminalGravity/vizcraft.git
cd vizcraft
bun install

# Start MCP server (stdio) + Web UI
bun run dev      # MCP server
bun run web:dev  # Web UI on http://localhost:3420
```

### Option 2: Docker Compose (Production)

```bash
docker compose up -d
```

### Configure Claude Code

Add to your project's `.mcp.json` or `~/.claude.json`:

```json
{
  "mcpServers": {
    "vizcraft": {
      "command": "bun",
      "args": ["run", "/path/to/vizcraft/src/server.ts"]
    }
  }
}
```

## MCP Tools

```typescript
// Create new diagram
mcp__vizcraft__create_diagram({
  name: "Architecture",
  project: "my-project",
  spec: {
    type: "flowchart",
    nodes: [
      { id: "a", label: "Start", type: "circle" },
      { id: "b", label: "Process", type: "box" },
      { id: "c", label: "End", type: "circle" }
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" }
    ]
  }
})

// Update diagram
mcp__vizcraft__update_diagram({ id: "abc123", spec: {...} })

// Get diagram description for Claude
mcp__vizcraft__describe_diagram({ id: "abc123" })

// Export diagram
mcp__vizcraft__export_diagram({ id: "abc123", format: "svg" })

// List diagrams
mcp__vizcraft__list_diagrams({ project: "my-project" })

// Delete diagram
mcp__vizcraft__delete_diagram({ id: "abc123" })
```

## Diagram Spec Format

```typescript
interface DiagramSpec {
  type: "flowchart" | "architecture" | "sequence" | "freeform";
  theme?: "dark" | "light" | "professional";
  nodes: Array<{
    id: string;
    label: string;
    type?: "box" | "diamond" | "circle" | "database" | "cloud" | "cylinder";
    color?: string;
    position?: { x: number; y: number };
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
    style?: "solid" | "dashed" | "dotted";
    color?: string;
  }>;
}
```

## Agent System

Agents are YAML configs in `data/agents/` that transform diagrams:

```yaml
# Auto Layout (rule-based)
name: "Auto Layout"
type: "rule-based"
actions:
  - dagre_layout
  - snap_to_grid

# Theme Preset
name: "Professional Theme"
type: "preset"
styles:
  node_fill: "#1e293b"
  node_stroke: "#3b82f6"
  edge_color: "#64748b"

# LLM Agent (requires API key)
name: "Annotate"
type: "llm"
provider: "anthropic"
prompt: "Add helpful annotations to this diagram"
```

Run agents via API:
```bash
POST /api/diagrams/:id/run-agent/:agentId
```

## Web UI

- **Sidebar**: Project browser + Agent panel
- **Canvas**: tldraw infinite canvas
- **Panel**: Diagram info + Export buttons

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd/Ctrl + N` | New diagram |
| `Cmd/Ctrl + S` | Copy spec |
| `Cmd/Ctrl + E` | Export PNG |
| `Cmd/Ctrl + /` | Show help |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/diagrams` | List diagrams |
| GET | `/api/diagrams/:id` | Get diagram |
| POST | `/api/diagrams` | Create diagram |
| PUT | `/api/diagrams/:id` | Update diagram |
| DELETE | `/api/diagrams/:id` | Delete diagram |
| GET | `/api/diagrams/:id/versions` | Get version history |
| GET | `/api/diagrams/:id/export/svg` | Export as SVG |
| GET | `/api/agents` | List agents |
| GET | `/api/agents/:id` | Get agent |
| POST | `/api/diagrams/:id/run-agent/:agentId` | Run agent |

## Tech Stack

- **Runtime:** Bun
- **MCP Server:** Hono + @modelcontextprotocol/sdk
- **Database:** bun:sqlite
- **Web UI:** React + tldraw
- **Export:** jsPDF for PDF
- **Layout:** @dagrejs/dagre for auto-layout

## Development

```bash
# Install
bun install

# Run tests
bun test

# Build web UI
bun run web:build

# Build for production
bun run build
```

## Project Structure

```
vizcraft/
├── src/
│   ├── server.ts          # MCP server
│   ├── web-server.ts      # Hono REST API
│   ├── storage/db.ts      # SQLite layer
│   ├── agents/
│   │   ├── loader.ts      # YAML agent loader
│   │   └── runner.ts      # Agent executor
│   └── types/index.ts     # TypeScript types
├── web/
│   ├── app.tsx            # React app
│   ├── index.html         # Entry
│   └── styles.css         # Styling
├── data/
│   ├── diagrams/          # Diagram storage
│   ├── exports/           # Exported files
│   └── agents/            # Agent YAMLs
└── package.json
```

## Completed Features

- [x] MCP server with 6 tools
- [x] SQLite persistence with versioning
- [x] Web UI with tldraw canvas
- [x] Export to PNG/SVG/PDF
- [x] Agent system (rule-based, preset, LLM)
- [x] Dagre auto-layout
- [x] Theme presets
- [x] Keyboard shortcuts
- [x] Dark/light theme toggle
- [x] Mobile responsive
- [x] Toast notifications
- [x] Integration tests

## License

MIT

---

Built with [Claude Code](https://claude.com/claude-code)
