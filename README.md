# VIZCRAFT

**AI-Native Diagramming for Claude Code**

> Claude generates JSON specs → Vizcraft renders interactive diagrams → User can edit → Changes sync back to Claude

## The Problem

SVG generation is fragile - one wrong character and it breaks. Claude Code needs a robust, interactive visualization tool that:
- Renders reliably every time
- Supports pan/zoom/edit
- Persists diagrams per project
- Enables bidirectional Claude ↔ User editing

## Comparison Matrix

| Tool | Flowcharts | Freeform | Icons | Animations | Data Viz | Canvas | Export | Collab | Dark Mode | Pro UI | API |
|------|------------|----------|-------|------------|----------|--------|--------|--------|-----------|--------|-----|
| **React Flow** | ✅ Best | ❌ | ⚠️ DIY | ⚠️ DIY | ❌ | ✅ | ⚠️ | ⚠️ DIY | ⚠️ DIY | ⚠️ | ✅ |
| **tldraw** | ✅ Good | ✅ Best | ✅ | ❌ | ❌ | ✅ Best | ✅ | ✅ Built | ✅ | ✅ Best | ✅ |
| **Excalidraw** | ✅ Good | ✅ Best | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ Built | ✅ | ⚠️ Sketchy | ✅ |
| **Rive** | ❌ | ✅ | ✅ | ✅ Best | ⚠️ | ❌ | ✅ | ❌ | ✅ | ✅ | ⚠️ |

**Decision:** tldraw for freeform/explanatory, React Flow for pure architecture diagrams.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         VIZCRAFT MCP                                 │
│            "AI-Native Diagramming for Claude Code"                   │
└──────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  DOCKER COMPOSE STACK                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │   mcp-server    │  │    web-ui       │  │   sqlite        │     │
│  │   (Bun+Hono)    │  │   (Bun+React)   │  │   (bun:sqlite)  │     │
│  │   Port: 8420    │  │   Port: 3420    │  │                 │     │
│  │                 │  │                 │  │                 │     │
│  │  MCP Protocol   │  │  tldraw canvas  │  │  Diagrams       │     │
│  │  SSE endpoint   │  │  Agent panel    │  │  Versions       │     │
│  │  REST API       │  │  Project tree   │  │  Projects       │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│           └────────────────────┴────────────────────┘               │
│                              ↕                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  SHARED VOLUME: /vizcraft/data                               │  │
│  │  - diagrams/*.json (tldraw format)                           │  │
│  │  - exports/*.png, *.svg, *.pdf                               │  │
│  │  - agents/*.yaml (custom agent configs)                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## MCP Tools (What Claude Code Sees)

```typescript
// Create new diagram
mcp__vizcraft__create_diagram(
    name: "exit-fix-architecture",
    project: "sentient-trader",  // Auto-links to cwd
    spec: {
        nodes: [...],
        edges: [...],
        style: "professional-dark"
    }
) → returns { id, url, thumbnail }

// Update existing
mcp__vizcraft__update_diagram(
    id: "abc123",
    changes: [
        { action: "add_node", node: {...} },
        { action: "update_style", theme: "light" }
    ]
)

// Get diagram as context (for Claude to reason about)
mcp__vizcraft__describe_diagram(id: "abc123")
→ returns structured description Claude can understand

// Export
mcp__vizcraft__export(id: "abc123", format: "png", path: "./docs/")

// List project diagrams
mcp__vizcraft__list_diagrams(project: "sentient-trader")
```

## Web UI

```
┌─────────────────────────────────────────────────────────────────┐
│  VIZCRAFT - sentient-trader                    [≡] [🌙] [👤]   │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                  │
│  PROJECTS    │  ┌────────────────────────────────────────────┐ │
│  ─────────   │  │                                            │ │
│  ▼ sentient  │  │     [tldraw infinite canvas]              │ │
│    ├ exit-fix│  │                                            │ │
│    ├ arch    │  │     - Pan/zoom                            │ │
│    └ flow    │  │     - Draw shapes                         │ │
│              │  │     - Connect nodes                       │ │
│  ▶ other-proj│  │     - Add text                            │ │
│              │  │     - Import images                       │ │
│              │  │                                            │ │
│  ─────────   │  └────────────────────────────────────────────┘ │
│  AGENTS      │                                                  │
│  ─────────   │  ┌────────────────────────────────────────────┐ │
│              │  │  AGENT PANEL                               │ │
│  [⚡ Layout] │  │  ─────────────────────────────────────────  │ │
│  [🎨 Style]  │  │  Selected: exit-fix-architecture           │ │
│  [📝 Annotate│  │                                            │ │
│  [✂️ Simplify]│  │  [🔄 Regenerate with Claude]              │ │
│  [🤖 Custom] │  │  [📋 Copy spec to clipboard]               │ │
│              │  │  [💬 Send to Claude Code]  ← MAGIC         │ │
│  ─────────   │  │  [📤 Export PNG] [SVG] [PDF]              │ │
│  [+ New Agent│  │                                            │ │
│              │  └────────────────────────────────────────────┘ │
└──────────────┴──────────────────────────────────────────────────┘
```

## The Magic: "Send to Claude Code" Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Web UI     │     │  MCP Server │     │ Claude Code │
│             │     │             │     │             │
│ User clicks │────▶│ Generates   │────▶│ Receives    │
│ "Send to    │     │ structured  │     │ context via │
│  Claude"    │     │ prompt with │     │ MCP resource│
│             │     │ diagram     │     │             │
│             │     │ context     │     │ "I see your │
│             │     │             │     │  diagram    │
│             │     │             │     │  shows..."  │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Agent System

```yaml
# agents/layout-agent.yaml
name: "Auto Layout"
description: "Arrange nodes for clarity"
type: "rule-based"
triggers:
  - manual
  - on_create
actions:
  - dagre_layout
  - snap_to_grid
  - minimize_crossings

# agents/style-agent.yaml
name: "Professional Theme"
type: "preset"
styles:
  node_fill: "#1e293b"
  node_stroke: "#3b82f6"
  edge_color: "#94a3b8"
  font: "Inter"

# agents/explain-agent.yaml
name: "Add Annotations"
type: "llm"
provider: "anthropic"
prompt: |
  Look at this diagram and add helpful annotations
  explaining each component's purpose.
  Output as tldraw operations.
```

## Database Schema

```sql
-- Diagrams table
CREATE TABLE diagrams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project TEXT NOT NULL,
    spec JSON NOT NULL,
    thumbnail_url TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Versions (git-like history)
CREATE TABLE diagram_versions (
    id TEXT PRIMARY KEY,
    diagram_id TEXT REFERENCES diagrams(id),
    version INTEGER,
    spec JSON NOT NULL,
    message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Agent runs
CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    diagram_id TEXT REFERENCES diagrams(id),
    agent_name TEXT,
    input_version INTEGER,
    output_version INTEGER,
    status TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Key Features

1. **Bidirectional Claude ↔ Diagram**: Claude creates diagrams, user edits, changes go back to Claude
2. **Project-aware**: Auto-links to your git repo, diagrams live with code
3. **Agent marketplace**: Share/import agent configs
4. **Version control**: Git-like history for diagrams
5. **Offline-first**: Works without internet, syncs when available
6. **Multi-model agents**: Use Claude, GPT, or local Ollama for different agents

## Quick Start

```bash
# One command to run
docker compose up -d

# Claude Code auto-discovers via .mcp.json
# Add to your project's .mcp.json:
{
  "mcpServers": {
    "vizcraft": {
      "url": "http://localhost:8420/mcp"
    }
  }
}
```

## Development

```bash
# Install dependencies
bun install

# Run dev server
bun run dev

# Run tests
bun test

# Build for production
bun run build
```

## Tech Stack

- **Runtime:** Bun (fast, TypeScript-native)
- **MCP Server:** Hono + @modelcontextprotocol/sdk
- **Database:** bun:sqlite (built-in, zero deps)
- **Web UI:** Bun.serve() + React + tldraw
- **Packaging:** Docker + Docker Hub

## Roadmap

- [ ] Core MCP server with create/read/update/delete
- [ ] SQLite persistence layer
- [ ] Basic web UI with tldraw
- [ ] Export to PNG/SVG
- [ ] Agent system (rule-based)
- [ ] LLM agents (Anthropic/OpenAI)
- [ ] Docker packaging
- [ ] Claude Code plugin distribution

## License

MIT
