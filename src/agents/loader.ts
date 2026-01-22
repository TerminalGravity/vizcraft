/**
 * Agent Loader
 * Loads and validates YAML agent configurations from data/agents/
 */

import { parse } from "yaml";
import { z } from "zod";
import { join } from "path";
import type { AgentConfig } from "../types";
import { createLogger } from "../logging";

const log = createLogger("agents");

// Zod schema for agent config validation
const AgentConfigSchema = z.object({
  name: z.string().min(1, "Agent name required"),
  description: z.string().optional(),
  type: z.enum(["rule-based", "preset", "llm"]),
  triggers: z.array(z.string()).optional(),
  actions: z.array(z.string()).optional(),
  styles: z.record(z.string(), z.string()).optional(),
  provider: z.enum(["anthropic", "openai", "ollama"]).optional(),
  prompt: z.string().optional(),
});

// Extended config with file info
export interface LoadedAgent extends AgentConfig {
  id: string;
  filename: string;
  loadedAt: string;
}

// Agent loader state
let loadedAgents: Map<string, LoadedAgent> = new Map();
let lastLoadTime: Date | null = null;

// Get agents directory path
const getAgentsDir = () => {
  const dataDir = process.env.DATA_DIR || "./data";
  return join(dataDir, "agents");
};

// Load a single agent from YAML file
async function loadAgentFile(filepath: string): Promise<LoadedAgent | null> {
  try {
    const file = Bun.file(filepath);
    if (!(await file.exists())) return null;

    const content = await file.text();
    const parsed = parse(content);

    // Validate with Zod
    const validated = AgentConfigSchema.parse(parsed);

    // Generate ID from filename
    const filename = filepath.split("/").pop() || "";
    const id = filename.replace(/\.ya?ml$/i, "");

    return {
      ...validated,
      id,
      filename,
      loadedAt: new Date().toISOString(),
    };
  } catch (err) {
    log.error("Failed to load agent", { filepath, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// Load all agents from the agents directory
export async function loadAgents(forceReload = false): Promise<LoadedAgent[]> {
  // Cache check (reload every 30 seconds unless forced)
  if (!forceReload && lastLoadTime && Date.now() - lastLoadTime.getTime() < 30000) {
    return Array.from(loadedAgents.values());
  }

  const agentsDir = getAgentsDir();
  const agents: LoadedAgent[] = [];

  try {
    // Use Bun's glob to find YAML files
    const glob = new Bun.Glob("*.{yaml,yml}");
    const files = await Array.fromAsync(glob.scan({ cwd: agentsDir, absolute: true }));

    for (const filepath of files) {
      const agent = await loadAgentFile(filepath);
      if (agent) {
        agents.push(agent);
        loadedAgents.set(agent.id, agent);
      }
    }

    lastLoadTime = new Date();
    log.info("Loaded agents", { count: agents.length, dir: agentsDir });
  } catch (err) {
    // Directory might not exist yet
    log.warn("Could not scan agents directory", { dir: agentsDir, error: err instanceof Error ? err.message : String(err) });
  }

  return agents;
}

// Get a specific agent by ID
export async function getAgent(id: string): Promise<LoadedAgent | null> {
  // Try cache first
  if (loadedAgents.has(id)) {
    return loadedAgents.get(id) || null;
  }

  // Try loading from file
  const agentsDir = getAgentsDir();
  const yamlPath = join(agentsDir, `${id}.yaml`);
  const ymlPath = join(agentsDir, `${id}.yml`);

  let agent = await loadAgentFile(yamlPath);
  if (!agent) {
    agent = await loadAgentFile(ymlPath);
  }

  if (agent) {
    loadedAgents.set(id, agent);
  }

  return agent;
}

// List all agent IDs
export async function listAgentIds(): Promise<string[]> {
  const agents = await loadAgents();
  return agents.map((a) => a.id);
}

// Validate agent config (useful for creating new agents)
export function validateAgentConfig(config: unknown): AgentConfig {
  return AgentConfigSchema.parse(config);
}

// Clear the cache (for testing or hot-reload)
export function clearAgentCache(): void {
  loadedAgents.clear();
  lastLoadTime = null;
}

// Export the schema for external use
export { AgentConfigSchema };
