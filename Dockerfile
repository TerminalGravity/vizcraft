# Vizcraft MCP Server
# AI-Native Diagramming for Claude Code

FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN bun build src/server.ts --outdir dist --target bun

# Production image
FROM oven/bun:1.3-slim

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create data directory
RUN mkdir -p /app/data/diagrams /app/data/exports /app/data/agents

# Environment
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=8420
ENV WEB_URL=http://localhost:3420

# The MCP server uses stdio, not HTTP
# This is for the web UI when we add it
EXPOSE 8420 3420

# Run MCP server
CMD ["bun", "run", "dist/server.js"]
