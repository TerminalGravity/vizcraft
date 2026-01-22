#!/bin/sh
set -e

case "$1" in
  mcp)
    # Run MCP server (stdio mode for Claude Code CLI)
    # Use with: docker run -i --rm vizcraft mcp
    exec bun run /app/src/server.ts
    ;;
  web)
    # Run Web UI server
    exec bun run /app/src/web-server.ts
    ;;
  both)
    # Run both MCP and Web UI (Web UI in background)
    echo "[vizcraft] Starting Web UI on port ${WEB_PORT:-3420}..."
    bun run /app/src/web-server.ts &
    echo "[vizcraft] Starting MCP server on stdio..."
    exec bun run /app/src/server.ts
    ;;
  *)
    # Custom command
    exec "$@"
    ;;
esac
