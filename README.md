# VIZCRAFT

**AI-Native Diagramming for Claude Code**

> Claude generates JSON specs → Vizcraft renders interactive diagrams → User can edit → Changes sync back to Claude

## Features

- **MCP Server** - 6 tools for Claude Code integration (create, update, describe, list, delete, export)
- **Interactive Canvas** - tldraw-powered infinite canvas with pan/zoom/edit
- **AI Agents** - Rule-based (dagre layout), preset (themes), LLM-powered agents
- **Export** - PNG, SVG, PDF export
- **Version History** - Git-like versioning for diagrams
- **Thumbnails** - Visual previews in the sidebar
- **Dark/Light Theme** - System-preference aware
- **Mobile Responsive** - Works on tablet/mobile screens

## Installation for Claude Code CLI

### Option 1: Docker (Recommended)

The easiest way to run Vizcraft with Claude Code CLI.

**Step 1: Build the Docker image**

```bash
git clone https://github.com/TerminalGravity/vizcraft.git
cd vizcraft
docker build -t vizcraft .
```

**Step 2: Start the Web UI**

```bash
# Run the Web UI (for viewing/editing diagrams)
docker compose up -d

# Or manually:
docker run -d --name vizcraft-web -p 3420:3420 -v vizcraft-data:/app/data vizcraft web
```

The Web UI will be available at **http://localhost:3420**

**Step 3: Configure Claude Code CLI**

Add to your `~/.claude.json` (global) or project's `.mcp.json`:

```json
{
  "mcpServers": {
    "vizcraft": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "vizcraft-data:/app/data", "vizcraft", "mcp"]
    }
  }
}
```

> **Important**: The `-i` flag is required for MCP's stdio communication. The `-v vizcraft-data:/app/data` ensures diagrams persist and are shared between the MCP server and Web UI.

**Step 4: Restart Claude Code**

```bash
# If using Claude Code CLI, restart your session
# The vizcraft tools should now be available
```

### Option 2: Bun (Development)

Run directly with Bun for development or if you prefer not to use Docker.

**Step 1: Install and run**

```bash
git clone https://github.com/TerminalGravity/vizcraft.git
cd vizcraft
bun install

# Terminal 1: Web UI
bun run web:dev

# Terminal 2: (Optional) MCP server for testing
bun run dev
```

**Step 2: Configure Claude Code CLI**

Add to your `~/.claude.json` or project's `.mcp.json`:

```json
{
  "mcpServers": {
    "vizcraft": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/vizcraft/src/server.ts"],
      "env": {
        "WEB_URL": "http://localhost:3420"
      }
    }
  }
}
```

> **Note**: Use the absolute path to `server.ts`. The `WEB_URL` tells the MCP server where the Web UI is running.

### Option 3: npx (Coming Soon)

```bash
# Future: Install globally via npm
npx vizcraft
```

## Verifying Installation

After configuring Claude Code, you can verify the installation:

```
You: List my vizcraft diagrams

Claude: I'll check your diagrams using the vizcraft MCP server.
[Uses mcp__vizcraft__list_diagrams tool]
```

If you see the tool being called, the installation is successful.

## MCP Tools

Once installed, Claude Code has access to these tools:

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

## Example Usage

Ask Claude to create diagrams naturally:

```
You: Create an architecture diagram showing a web app with React frontend,
     Node.js API, and PostgreSQL database

Claude: I'll create that architecture diagram for you.
[Uses mcp__vizcraft__create_diagram]
Done! View your diagram at http://localhost:3420/diagram/abc123
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

Run agents via the Web UI sidebar or API:
```bash
POST /api/diagrams/:id/run-agent/:agentId
```

## Web UI

- **Sidebar**: Project browser with thumbnails + Agent panel
- **Canvas**: tldraw infinite canvas with pan/zoom/edit
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
| PUT | `/api/diagrams/:id/thumbnail` | Update thumbnail |
| DELETE | `/api/diagrams/:id` | Delete diagram |
| GET | `/api/diagrams/:id/versions` | Get version history |
| GET | `/api/diagrams/:id/export/svg` | Export as SVG |
| GET | `/api/agents` | List agents |
| GET | `/api/agents/:id` | Get agent |
| POST | `/api/diagrams/:id/run-agent/:agentId` | Run agent |

## Docker Commands Reference

```bash
# Build the image
docker build -t vizcraft .

# Run Web UI (with docker-compose)
docker compose up -d

# Run Web UI (manual)
docker run -d --name vizcraft-web -p 3420:3420 -v vizcraft-data:/app/data vizcraft web

# Run MCP server (for Claude Code CLI - configured in .mcp.json)
docker run -i --rm -v vizcraft-data:/app/data vizcraft mcp

# View logs
docker logs vizcraft-web

# Stop
docker compose down

# Remove data volume (caution: deletes all diagrams)
docker volume rm vizcraft-data
```

## Tech Stack

- **Runtime:** Bun
- **MCP Server:** @modelcontextprotocol/sdk (stdio transport)
- **Database:** bun:sqlite
- **Web UI:** React 19 + tldraw 4.3
- **API:** Hono
- **Export:** jsPDF for PDF
- **Layout:** @dagrejs/dagre for auto-layout

## Development

```bash
# Install
bun install

# Run tests
bun test

# Run Web UI (dev mode with hot reload)
bun run web:dev

# Run MCP server (dev mode)
bun run dev

# Build web UI
bun run web:build

# Build for production
bun run build
```

## Project Structure

```
vizcraft/
├── src/
│   ├── server.ts          # MCP server (stdio)
│   ├── web-server.ts      # Hono REST API + static files
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
│   ├── diagrams/          # Diagram storage (SQLite)
│   ├── exports/           # Exported files
│   └── agents/            # Agent YAML configs
├── Dockerfile             # Multi-service Docker image
├── docker-compose.yml     # Web UI service
├── docker-entrypoint.sh   # Entrypoint script
└── package.json
```

## Troubleshooting

### MCP server not connecting

1. Ensure Docker is running
2. Verify the volume name matches: `vizcraft-data`
3. Check Claude Code config path is correct
4. Restart Claude Code CLI after config changes

### Diagrams not showing in Web UI

1. Ensure both MCP server and Web UI use the same volume
2. Check the volume exists: `docker volume ls | grep vizcraft`
3. Verify Web UI is running: `curl http://localhost:3420/api/health`

### Docker build fails

1. Ensure you have Docker 20.10+ installed
2. Try: `docker build --no-cache -t vizcraft .`

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
- [x] Diagram thumbnails
- [x] Docker support
- [x] Integration tests

## License

MIT

---

Built with [Claude Code](https://claude.ai/code)
