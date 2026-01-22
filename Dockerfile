# Vizcraft - AI-Native Diagramming for Claude Code
# Multi-service Docker image: MCP server + Web UI

FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build web UI
RUN bun run web:build

# Production image
FROM oven/bun:1.3-slim

WORKDIR /app

# Copy all source files (needed for runtime)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/web ./web
COPY --from=builder /app/data ./data

# Create data directories
RUN mkdir -p /app/data/diagrams /app/data/exports /app/data/agents

# Copy entrypoint script
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Environment
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV WEB_PORT=3420
ENV WEB_URL=http://localhost:3420

# Web UI port
EXPOSE 3420

# Default: run both MCP server info and Web UI
# Override with: docker run vizcraft mcp (for MCP only)
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["web"]
