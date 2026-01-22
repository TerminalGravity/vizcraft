/**
 * Vizcraft Web UI
 * AI-Native Diagramming for Claude Code
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Tldraw, createTLStore, defaultShapeUtils, toRichText } from "tldraw";
import { jsPDF } from "jspdf";
import "tldraw/tldraw.css";
import "./styles.css";

// Types
interface Diagram {
  id: string;
  name: string;
  project: string;
  spec: DiagramSpec;
  thumbnailUrl?: string;
  updatedAt: string;
}

interface DiagramSpec {
  type: string;
  theme?: string;
  nodes: Array<{ id: string; label: string; type?: string; position?: { x: number; y: number } }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

interface Project {
  name: string;
  diagrams: Diagram[];
}

// API client
const API_URL = "/api";

const api = {
  async listDiagrams(): Promise<{ diagrams: Diagram[]; projects: string[] }> {
    const res = await fetch(`${API_URL}/diagrams`);
    return res.json();
  },

  async getDiagram(id: string): Promise<Diagram> {
    const res = await fetch(`${API_URL}/diagrams/${id}`);
    return res.json();
  },

  async createDiagram(name: string, project: string, spec: DiagramSpec): Promise<Diagram> {
    const res = await fetch(`${API_URL}/diagrams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, project, spec }),
    });
    return res.json();
  },

  async updateDiagram(id: string, spec: DiagramSpec): Promise<Diagram> {
    const res = await fetch(`${API_URL}/diagrams/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec }),
    });
    return res.json();
  },

  async deleteDiagram(id: string): Promise<void> {
    await fetch(`${API_URL}/diagrams/${id}`, { method: "DELETE" });
  },

  async updateThumbnail(id: string, thumbnailDataUrl: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_URL}/diagrams/${id}/thumbnail`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thumbnail: thumbnailDataUrl }),
    });
    return res.json();
  },

  async listAgents(): Promise<{ agents: Agent[] }> {
    const res = await fetch(`${API_URL}/agents`);
    return res.json();
  },

  async runAgent(diagramId: string, agentId: string): Promise<{ success: boolean; error?: string; changes?: string[] }> {
    const res = await fetch(`${API_URL}/diagrams/${diagramId}/run-agent/${agentId}`, {
      method: "POST",
    });
    return res.json();
  },

  async listThemes(): Promise<{ themes: Theme[] }> {
    const res = await fetch(`${API_URL}/themes`);
    return res.json();
  },

  async getThemeCSS(themeId: string): Promise<string> {
    const res = await fetch(`${API_URL}/themes/${themeId}/css`);
    return res.text();
  },

  async applyTheme(diagramId: string, themeId: string): Promise<{ success: boolean; diagram: Diagram }> {
    const res = await fetch(`${API_URL}/diagrams/${diagramId}/apply-theme`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId }),
    });
    return res.json();
  },
};

// Icons
const Icons = {
  Logo: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  Folder: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  ),
  File: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Download: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  ),
  Send: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  ),
  Copy: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  Refresh: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  ),
  Moon: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  ),
  Search: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  ),
  Command: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <path d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z" />
    </svg>
  ),
  Sun: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  Menu: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  Info: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  ChevronLeft: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  ChevronRight: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
};

// Thumbnail generation utility using tldraw v4 API
const generateThumbnail = async (
  editor: any,
  maxWidth = 120,
  maxHeight = 80
): Promise<string | null> => {
  try {
    const shapeIds = editor.getCurrentPageShapeIds();
    if (shapeIds.size === 0) return null;

    // Use tldraw v4's toImage API
    const result = await editor.toImage([...shapeIds], {
      format: 'png',
      background: true,
      padding: 8,
      scale: 0.5,
    });

    if (!result?.blob) return null;

    // Convert blob to data URL and resize
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(result.blob);

      img.onload = () => {
        // Calculate dimensions preserving aspect ratio
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = height * (maxWidth / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = width * (maxHeight / height);
          height = maxHeight;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          ctx.fillStyle = "#1e293b";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const dataUrl = canvas.toDataURL("image/png", 0.8);
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } else {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };

      img.src = url;
    });
  } catch (err) {
    console.error("Thumbnail generation failed:", err);
    return null;
  }
};

// Agent type from API
interface Agent {
  id: string;
  name: string;
  description?: string;
  type: "rule-based" | "preset" | "llm";
}

// Theme type from API
interface Theme {
  id: string;
  name: string;
  description: string;
  mode: "dark" | "light";
}

// Agent icons by type/name
const getAgentIcon = (agent: Agent): string => {
  if (agent.name.toLowerCase().includes("layout")) return "⚡";
  if (agent.name.toLowerCase().includes("theme") || agent.name.toLowerCase().includes("style")) return "🎨";
  if (agent.name.toLowerCase().includes("annotate")) return "📝";
  if (agent.name.toLowerCase().includes("simplify")) return "✂️";
  if (agent.type === "llm") return "🤖";
  if (agent.type === "preset") return "🎨";
  return "⚙️";
};

// Thumbnail component with lazy loading
function DiagramThumbnail({ diagram }: { diagram: Diagram }) {
  const [loaded, setLoaded] = useState(false);

  if (!diagram.thumbnailUrl) {
    return (
      <div className="diagram-thumbnail diagram-thumbnail-placeholder">
        <Icons.File />
      </div>
    );
  }

  return (
    <div className="diagram-thumbnail">
      {!loaded && <div className="diagram-thumbnail-placeholder"><Icons.File /></div>}
      <img
        src={diagram.thumbnailUrl}
        alt={diagram.name}
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </div>
  );
}

// Sidebar component
function Sidebar({
  projects,
  selectedDiagram,
  onSelectDiagram,
  onNewDiagram,
  agents,
  onRunAgent,
  runningAgent,
  isOpen,
  collapsed,
  onToggleCollapse,
  searchQuery,
  onSearchChange,
}: {
  projects: Project[];
  selectedDiagram: string | null;
  onSelectDiagram: (id: string) => void;
  onNewDiagram: () => void;
  agents: Agent[];
  onRunAgent: (agentId: string) => void;
  runningAgent: string | null;
  isOpen?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(["default"]));

  const toggleProject = (name: string) => {
    const next = new Set(expandedProjects);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    setExpandedProjects(next);
  };

  return (
    <aside className={`sidebar ${isOpen ? "open" : ""} ${collapsed ? "collapsed" : ""}`}>
      {/* Collapse toggle button */}
      {onToggleCollapse && (
        <button className="sidebar-collapse-btn" onClick={onToggleCollapse} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <Icons.ChevronRight /> : <Icons.ChevronLeft />}
        </button>
      )}

      {/* Search - hidden when collapsed */}
      {!collapsed && (
        <div className="sidebar-search">
          <div className="sidebar-search-wrapper">
            <Icons.Search />
            <input
              type="text"
              className="sidebar-search-input"
              placeholder="Search diagrams..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="sidebar-section">
        {!collapsed && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <span className="sidebar-title" style={{ marginBottom: 0 }}>Projects</span>
            <button className="btn btn-ghost btn-sm" onClick={onNewDiagram} title="New Diagram">
              <Icons.Plus />
            </button>
          </div>
        )}
        {collapsed && (
          <button className="btn btn-ghost btn-sm collapsed-action" onClick={onNewDiagram} title="New Diagram">
            <Icons.Plus />
          </button>
        )}
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.name}>
              <div
                className={`project-item ${expandedProjects.has(project.name) ? "active" : ""}`}
                onClick={() => toggleProject(project.name)}
                title={collapsed ? project.name : undefined}
              >
                <Icons.Folder />
                {!collapsed && <span>{project.name}</span>}
                {!collapsed && (
                  <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {project.diagrams.length}
                  </span>
                )}
              </div>
              {expandedProjects.has(project.name) && !collapsed && (
                <ul className="diagram-list">
                  {project.diagrams.map((d) => (
                    <li
                      key={d.id}
                      className={`diagram-item ${selectedDiagram === d.id ? "active" : ""}`}
                      onClick={() => onSelectDiagram(d.id)}
                    >
                      <DiagramThumbnail diagram={d} />
                      <span className="diagram-item-name">{d.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="sidebar-section" style={{ flex: 1 }}>
        {!collapsed && <span className="sidebar-title">Agents</span>}
        <div className="agent-list">
          {agents.length === 0 ? (
            !collapsed && (
              <div style={{ color: "var(--text-muted)", fontSize: "0.875rem", padding: "0.5rem" }}>
                No agents loaded
              </div>
            )
          ) : (
            agents.map((agent) => (
              <button
                key={agent.id}
                className={`agent-btn ${runningAgent === agent.id ? "running" : ""} ${collapsed ? "collapsed" : ""}`}
                onClick={() => onRunAgent(agent.id)}
                disabled={!selectedDiagram || runningAgent !== null}
                title={collapsed ? agent.name : (!selectedDiagram ? "Select a diagram first" : `Run ${agent.name}`)}
              >
                <span className="agent-icon">
                  {runningAgent === agent.id ? "⏳" : getAgentIcon(agent)}
                </span>
                {!collapsed && (
                  <span className="agent-info">
                    <span className="agent-name">{agent.name}</span>
                    <span className="agent-desc">{agent.description || agent.type}</span>
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

// Panel component with tabs
function Panel({
  diagram,
  onSendToClaude,
  onCopySpec,
  onExport,
  isOpen,
  activeTab,
  onTabChange,
}: {
  diagram: Diagram | null;
  onSendToClaude: () => void;
  onCopySpec: () => void;
  onExport: (format: string) => void;
  isOpen?: boolean;
  activeTab: "info" | "export" | "structure";
  onTabChange: (tab: "info" | "export" | "structure") => void;
}) {
  if (!diagram) {
    return (
      <aside className={`panel ${isOpen ? "open" : ""}`}>
        <div className="empty-state">
          <p>Select a diagram to see details</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`panel ${isOpen ? "open" : ""}`}>
      {/* Tab bar */}
      <div className="panel-tabs">
        <button
          className={`panel-tab ${activeTab === "info" ? "active" : ""}`}
          onClick={() => onTabChange("info")}
        >
          <Icons.Info /> Info
        </button>
        <button
          className={`panel-tab ${activeTab === "export" ? "active" : ""}`}
          onClick={() => onTabChange("export")}
        >
          <Icons.Download /> Export
        </button>
        <button
          className={`panel-tab ${activeTab === "structure" ? "active" : ""}`}
          onClick={() => onTabChange("structure")}
        >
          <Icons.File /> Structure
        </button>
      </div>

      {/* Tab content */}
      <div className="panel-content">
        {activeTab === "info" && (
          <>
            <div className="panel-section">
              <h3 className="panel-title">Diagram Info</h3>
              <div className="panel-info-grid">
                <div className="panel-info-item">
                  <span className="panel-info-label">Name</span>
                  <span className="panel-info-value">{diagram.name}</span>
                </div>
                <div className="panel-info-item">
                  <span className="panel-info-label">Project</span>
                  <span className="panel-info-value">{diagram.project}</span>
                </div>
                <div className="panel-info-item">
                  <span className="panel-info-label">Type</span>
                  <span className="panel-info-value">{diagram.spec.type}</span>
                </div>
                <div className="panel-info-item">
                  <span className="panel-info-label">Nodes</span>
                  <span className="panel-info-value">{diagram.spec.nodes.length}</span>
                </div>
                <div className="panel-info-item">
                  <span className="panel-info-label">Edges</span>
                  <span className="panel-info-value">{diagram.spec.edges.length}</span>
                </div>
              </div>
            </div>

            <div className="panel-section">
              <h3 className="panel-title">Quick Actions</h3>
              <div className="action-btns">
                <button className="btn btn-primary" onClick={onSendToClaude}>
                  <Icons.Send /> Send to Claude
                </button>
                <button className="btn btn-secondary" onClick={onCopySpec}>
                  <Icons.Copy /> Copy Spec
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === "export" && (
          <div className="panel-section">
            <h3 className="panel-title">Export Options</h3>
            <div className="export-options">
              <button className="export-option" onClick={() => onExport("png")}>
                <div className="export-option-icon">📷</div>
                <div className="export-option-info">
                  <span className="export-option-name">PNG</span>
                  <span className="export-option-desc">Raster image, best for sharing</span>
                </div>
              </button>
              <button className="export-option" onClick={() => onExport("svg")}>
                <div className="export-option-icon">📐</div>
                <div className="export-option-info">
                  <span className="export-option-name">SVG</span>
                  <span className="export-option-desc">Vector, perfect for scaling</span>
                </div>
              </button>
              <button className="export-option" onClick={() => onExport("pdf")}>
                <div className="export-option-icon">📄</div>
                <div className="export-option-info">
                  <span className="export-option-name">PDF</span>
                  <span className="export-option-desc">Print-ready document</span>
                </div>
              </button>
            </div>
            <div className="panel-hint">
              <kbd>⌘E</kbd> Quick export to PNG
            </div>
          </div>
        )}

        {activeTab === "structure" && (
          <div className="panel-section">
            <h3 className="panel-title">Nodes ({diagram.spec.nodes.length})</h3>
            <ul className="structure-list">
              {diagram.spec.nodes.map((n) => (
                <li key={n.id} className="structure-item">
                  <span className="structure-item-type">{n.type || "box"}</span>
                  <span className="structure-item-label">{n.label}</span>
                </li>
              ))}
            </ul>

            <h3 className="panel-title" style={{ marginTop: "1rem" }}>Edges ({diagram.spec.edges.length})</h3>
            <ul className="structure-list">
              {diagram.spec.edges.map((e, i) => (
                <li key={i} className="structure-item">
                  <span className="structure-edge">
                    {e.from} → {e.to}
                    {e.label && <span className="structure-edge-label">"{e.label}"</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}

// Canvas component with tldraw
function Canvas({
  diagram,
  editorRef,
  onThumbnailReady,
}: {
  diagram: Diagram | null;
  editorRef: React.MutableRefObject<any>;
  onThumbnailReady?: (diagramId: string, thumbnail: string) => void;
}) {
  if (!diagram) {
    return (
      <div className="canvas">
        <div className="empty-state">
          <Icons.Logo />
          <h3>No diagram selected</h3>
          <p>Select a diagram from the sidebar or create a new one</p>
        </div>
      </div>
    );
  }

  // Convert spec to tldraw shapes
  const store = createTLStore({ shapeUtils: defaultShapeUtils });

  return (
    <div className="canvas" style={{ height: "100%" }}>
      <Tldraw
        store={store}
        onMount={(editor) => {
          // Store editor reference for export functions
          editorRef.current = editor;

          // Convert diagram spec to tldraw shapes
          const shapes: any[] = [];
          const nodePositions: Record<string, { x: number; y: number }> = {};

          // Create nodes
          diagram.spec.nodes.forEach((node, i) => {
            const x = node.position?.x ?? 100 + (i % 4) * 200;
            const y = node.position?.y ?? 100 + Math.floor(i / 4) * 150;
            nodePositions[node.id] = { x, y };

            shapes.push({
              id: `shape:${node.id}`,
              type: "geo",
              x,
              y,
              props: {
                geo: node.type === "diamond" ? "diamond" : node.type === "circle" ? "ellipse" : "rectangle",
                w: 150,
                h: 80,
                color: "light-blue",
                fill: "solid",
              },
            });

            // Add label as separate text shape
            shapes.push({
              id: `shape:${node.id}-label`,
              type: "text",
              x: x + 10,
              y: y + 30,
              props: {
                richText: toRichText(node.label),
                color: "black",
                size: "m",
                font: "sans",
                autoSize: true,
                scale: 1,
                textAlign: "middle",
                w: 130,
              },
            });
          });

          // Create edges as arrows
          diagram.spec.edges.forEach((edge, i) => {
            const from = nodePositions[edge.from];
            const to = nodePositions[edge.to];
            if (from && to) {
              shapes.push({
                id: `shape:edge-${i}`,
                type: "arrow",
                x: from.x + 75,
                y: from.y + 40,
                props: {
                  start: { x: 0, y: 0 },
                  end: { x: to.x - from.x, y: to.y - from.y },
                },
              });

              // Add edge label as separate text if provided
              if (edge.label) {
                const midX = (from.x + to.x) / 2 + 75;
                const midY = (from.y + to.y) / 2 + 20;
                shapes.push({
                  id: `shape:edge-${i}-label`,
                  type: "text",
                  x: midX,
                  y: midY,
                  props: {
                    richText: toRichText(edge.label),
                    color: "grey",
                    size: "s",
                    font: "sans",
                    autoSize: true,
                    scale: 1,
                    textAlign: "middle",
                    w: 80,
                  },
                });
              }
            }
          });

          // Add shapes to editor
          editor.createShapes(shapes);
          editor.zoomToFit();

          // Generate thumbnail after a short delay (let shapes render)
          if (onThumbnailReady && !diagram.thumbnailUrl) {
            setTimeout(async () => {
              const thumbnail = await generateThumbnail(editor);
              if (thumbnail) {
                onThumbnailReady(diagram.id, thumbnail);
              }
            }, 500);
          }
        }}
      />
    </div>
  );
}

// Main App
function App() {
  const [diagrams, setDiagrams] = useState<Diagram[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Array<{
    id: string;
    type: "success" | "error" | "info";
    message: string;
    action?: { label: string; onClick: () => void };
  }>>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("vizcraft-sidebar-collapsed") === "true";
    }
    return false;
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [panelTab, setPanelTab] = useState<"info" | "export" | "structure">("info");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    // Check localStorage and system preference
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("vizcraft-theme") as "dark" | "light" | null;
      if (saved) return saved;
      if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    }
    return "dark";
  });
  const editorRef = useRef<any>(null);

  const selectedDiagram = diagrams.find((d) => d.id === selectedId) || null;

  // Apply theme to document and inject premium CSS
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vizcraft-theme", theme);

    // Inject premium theme CSS
    const styleId = "vizcraft-premium-theme";
    let styleEl = document.getElementById(styleId) as HTMLStyleElement;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    // Fetch and inject theme CSS
    api.getThemeCSS(theme).then((css) => {
      styleEl.textContent = css;
    }).catch(() => {
      // Fallback if API fails
      console.warn("Failed to load premium theme CSS");
    });
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("vizcraft-sidebar-collapsed", String(next));
      return next;
    });
  };

  // Toast management
  const showToast = useCallback((
    type: "success" | "error" | "info",
    message: string,
    action?: { label: string; onClick: () => void }
  ) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, type, message, action }]);

    // Auto-dismiss after 5s (8s for errors)
    const timeout = type === "error" ? 8000 : 5000;
    setTimeout(() => {
      dismissToast(id);
    }, timeout);

    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Load diagrams and agents on mount
  useEffect(() => {
    loadDiagrams();
    loadAgents();
  }, []);


  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Escape: Close command palette
      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
        setCommandQuery("");
        setCommandSelectedIndex(0);
        return;
      }

      // Cmd/Ctrl + K: Open command palette
      if (isMod && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        setCommandQuery("");
        setCommandSelectedIndex(0);
        return;
      }

      // Command palette navigation
      if (commandPaletteOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCommandSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setCommandSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" && filteredCommands.length > 0) {
          e.preventDefault();
          executeCommand(filteredCommands[commandSelectedIndex]);
          return;
        }
        return;
      }

      // Cmd/Ctrl + S: Save (copy spec)
      if (isMod && e.key === "s") {
        e.preventDefault();
        if (selectedDiagram) {
          handleCopySpec();
        }
      }

      // Cmd/Ctrl + E: Export PNG
      if (isMod && e.key === "e") {
        e.preventDefault();
        if (selectedDiagram) {
          handleExport("png");
        }
      }

      // Cmd/Ctrl + N: New diagram
      if (isMod && e.key === "n") {
        e.preventDefault();
        handleNewDiagram();
      }

      // Cmd/Ctrl + /: Show shortcuts help
      if (isMod && e.key === "/") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        setCommandQuery("?");
      }

      // Cmd/Ctrl + B: Toggle sidebar collapse
      if (isMod && e.key === "b") {
        e.preventDefault();
        toggleSidebarCollapse();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDiagram, commandPaletteOpen, commandSelectedIndex, filteredCommands]);

  // Reset selected index when command query changes
  useEffect(() => {
    setCommandSelectedIndex(0);
  }, [commandQuery]);

  const loadAgents = async () => {
    try {
      const data = await api.listAgents();
      setAgents(data.agents);
    } catch (err) {
      console.error("Failed to load agents:", err);
    }
  };

  const handleRunAgent = async (agentId: string) => {
    if (!selectedId) return;

    setRunningAgent(agentId);
    try {
      const result = await api.runAgent(selectedId, agentId);

      if (result.success) {
        // Reload the diagram to get updated spec
        await loadDiagrams();
        showToast(
          "success",
          `Agent completed: ${result.changes?.join(", ") || "Done"}`,
          { label: "View Changes", onClick: () => setPanelTab("structure") }
        );

        // Regenerate thumbnail after agent runs
        setTimeout(async () => {
          if (editorRef.current && selectedId) {
            const thumbnail = await generateThumbnail(editorRef.current);
            if (thumbnail) {
              handleThumbnailReady(selectedId, thumbnail);
            }
          }
        }, 1000);
      } else {
        showToast("error", result.error || "Agent failed");
      }
    } catch (err) {
      showToast("error", `Agent error: ${err}`);
    } finally {
      setRunningAgent(null);
    }
  };

  const loadDiagrams = async () => {
    try {
      const data = await api.listDiagrams();
      setDiagrams(data.diagrams);

      // Group by project
      const grouped: Record<string, Diagram[]> = {};
      data.diagrams.forEach((d) => {
        if (!grouped[d.project]) grouped[d.project] = [];
        grouped[d.project].push(d);
      });

      // Add empty default project if needed
      if (!grouped["default"]) grouped["default"] = [];

      setProjects(
        Object.entries(grouped).map(([name, diagrams]) => ({ name, diagrams }))
      );
    } catch (err) {
      console.error("Failed to load diagrams:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleThumbnailReady = useCallback(async (diagramId: string, thumbnail: string) => {
    try {
      await api.updateThumbnail(diagramId, thumbnail);
      // Update local state to show thumbnail immediately
      setDiagrams((prev) =>
        prev.map((d) => (d.id === diagramId ? { ...d, thumbnailUrl: thumbnail } : d))
      );
      // Also update projects state
      setProjects((prev) =>
        prev.map((p) => ({
          ...p,
          diagrams: p.diagrams.map((d) =>
            d.id === diagramId ? { ...d, thumbnailUrl: thumbnail } : d
          ),
        }))
      );
    } catch (err) {
      console.error("Failed to save thumbnail:", err);
    }
  }, []);

  const handleNewDiagram = async () => {
    const name = prompt("Diagram name:");
    if (!name) return;

    const spec: DiagramSpec = {
      type: "flowchart",
      theme: "dark",
      nodes: [
        { id: "start", label: "Start", type: "circle" },
        { id: "process", label: "Process", type: "box" },
        { id: "end", label: "End", type: "circle" },
      ],
      edges: [
        { from: "start", to: "process" },
        { from: "process", to: "end" },
      ],
    };

    try {
      const diagram = await api.createDiagram(name, "default", spec);
      await loadDiagrams();
      setSelectedId(diagram.id);
    } catch (err) {
      console.error("Failed to create diagram:", err);
    }
  };

  const handleSendToClaude = () => {
    if (!selectedDiagram) return;

    // Format as context for Claude
    const context = `
# Diagram: ${selectedDiagram.name}
Project: ${selectedDiagram.project}
Type: ${selectedDiagram.spec.type}

## Nodes
${selectedDiagram.spec.nodes.map((n) => `- ${n.label} (${n.type || "box"})`).join("\n")}

## Connections
${selectedDiagram.spec.edges.map((e) => `- ${e.from} → ${e.to}${e.label ? `: ${e.label}` : ""}`).join("\n")}
`.trim();

    navigator.clipboard.writeText(context);
    alert("Diagram context copied to clipboard!\n\nPaste it in Claude Code.");
  };

  const handleCopySpec = () => {
    if (!selectedDiagram) return;
    navigator.clipboard.writeText(JSON.stringify(selectedDiagram.spec, null, 2));
    showToast("success", "Spec copied to clipboard");
  };

  const handleCopyJSON = () => {
    if (!selectedDiagram) return;
    navigator.clipboard.writeText(JSON.stringify(selectedDiagram, null, 2));
    showToast("success", "Full JSON copied to clipboard");
  };

  const handleExport = async (format: string) => {
    if (!selectedDiagram || !editorRef.current) {
      alert("No diagram selected or editor not ready");
      return;
    }

    const editor = editorRef.current;
    setExporting(true);

    try {
      const shapeIds = editor.getCurrentPageShapeIds();
      if (shapeIds.size === 0) {
        alert("No shapes to export");
        setExporting(false);
        return;
      }

      if (format === "svg") {
        // Export as SVG using tldraw v4 API
        const result = await editor.toImage([...shapeIds], {
          format: 'svg',
          background: true,
          padding: 32,
        });

        if (result?.blob) {
          downloadBlob(result.blob, `${selectedDiagram.name}.svg`);
        }
      } else if (format === "png") {
        // Export as PNG using tldraw v4 API
        const result = await editor.toImage([...shapeIds], {
          format: 'png',
          background: true,
          padding: 32,
          scale: 2,
        });

        if (result?.blob) {
          downloadBlob(result.blob, `${selectedDiagram.name}.png`);
        }
      } else if (format === "pdf") {
        // Export as PNG first, then convert to PDF
        const result = await editor.toImage([...shapeIds], {
          format: 'png',
          background: true,
          padding: 32,
          scale: 2,
        });

        if (result?.blob) {
          // Convert blob to data URL for jsPDF
          const reader = new FileReader();
          reader.onload = () => {
            const imgData = reader.result as string;

            // Create PDF with appropriate orientation
            const img = new Image();
            img.onload = () => {
              const isLandscape = img.width > img.height;
              const pdf = new jsPDF({
                orientation: isLandscape ? "landscape" : "portrait",
                unit: "px",
                format: [img.width, img.height],
              });

              pdf.addImage(imgData, "PNG", 0, 0, img.width, img.height);
              pdf.save(`${selectedDiagram.name}.pdf`);
            };
            img.src = imgData;
          };
          reader.readAsDataURL(result.blob);
        }
      }
    } catch (err) {
      console.error("Export failed:", err);
      alert(`Export failed: ${err}`);
    } finally {
      setExporting(false);
    }
  };

  // Helper to download blob as file
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Command palette commands
  const commands = [
    { id: "new-diagram", label: "New Diagram", shortcut: "⌘N", action: handleNewDiagram, category: "Diagrams" },
    { id: "export-png", label: "Export as PNG", shortcut: "⌘E", action: () => selectedDiagram && handleExport("png"), category: "Export" },
    { id: "export-svg", label: "Export as SVG", action: () => selectedDiagram && handleExport("svg"), category: "Export" },
    { id: "export-pdf", label: "Export as PDF", action: () => selectedDiagram && handleExport("pdf"), category: "Export" },
    { id: "copy-spec", label: "Copy Diagram Spec", shortcut: "⌘S", action: handleCopySpec, category: "Clipboard" },
    { id: "copy-json", label: "Copy as JSON", action: handleCopyJSON, category: "Clipboard" },
    { id: "toggle-theme", label: theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode", action: toggleTheme, category: "Settings" },
    { id: "toggle-sidebar", label: sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar", shortcut: "⌘B", action: toggleSidebarCollapse, category: "View" },
    { id: "toggle-panel", label: "Toggle Agent Panel", action: () => setPanelOpen(!panelOpen), category: "View" },
    ...agents.map((agent) => ({
      id: `run-agent-${agent.id}`,
      label: `Run: ${agent.name}`,
      action: () => selectedDiagram && handleRunAgent(agent.id),
      category: "Agents",
    })),
    ...diagrams.map((d) => ({
      id: `open-diagram-${d.id}`,
      label: `Open: ${d.name}`,
      action: () => setSelectedId(d.id),
      category: "Diagrams",
    })),
  ];

  // Filter commands based on query
  const filteredCommands = commandQuery
    ? commands.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(commandQuery.toLowerCase()) ||
          cmd.category.toLowerCase().includes(commandQuery.toLowerCase())
      )
    : commands;

  // Group commands by category
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, typeof commands>);

  // Filter projects by search query
  const filteredProjects = React.useMemo(() => {
    if (!searchQuery) return projects;

    const query = searchQuery.toLowerCase();
    return projects
      .map((project) => ({
        ...project,
        diagrams: project.diagrams.filter(
          (d) =>
            d.name.toLowerCase().includes(query) ||
            d.project.toLowerCase().includes(query)
        ),
      }))
      .filter((project) => project.diagrams.length > 0);
  }, [projects, searchQuery]);

  // Execute command and close palette
  const executeCommand = (cmd: typeof commands[0]) => {
    cmd.action();
    setCommandPaletteOpen(false);
    setCommandQuery("");
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Toast notifications */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span className="toast-icon">
              {toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ"}
            </span>
            <span className="toast-message">{toast.message}</span>
            {toast.action && (
              <button
                className="toast-action"
                onClick={() => {
                  toast.action?.onClick();
                  dismissToast(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button className="toast-dismiss" onClick={() => dismissToast(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Command Palette */}
      {commandPaletteOpen && (
        <div className="command-palette-overlay" onClick={() => setCommandPaletteOpen(false)}>
          <div className="command-palette" onClick={(e) => e.stopPropagation()}>
            <div className="command-palette-input-wrapper">
              <Icons.Search />
              <input
                type="text"
                className="command-palette-input"
                placeholder="Type a command or search..."
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                autoFocus
              />
              <kbd className="command-palette-kbd">ESC</kbd>
            </div>
            <div className="command-palette-results">
              {(() => {
                let absoluteIndex = 0;
                return Object.entries(groupedCommands).map(([category, cmds]) => (
                  <div key={category} className="command-palette-group">
                    <div className="command-palette-group-label">{category}</div>
                    {cmds.map((cmd) => {
                      const currentIndex = absoluteIndex++;
                      return (
                        <button
                          key={cmd.id}
                          className={`command-palette-item ${currentIndex === commandSelectedIndex ? "selected" : ""}`}
                          onClick={() => executeCommand(cmd)}
                          onMouseEnter={() => setCommandSelectedIndex(currentIndex)}
                        >
                          <span className="command-palette-item-label">{cmd.label}</span>
                          {cmd.shortcut && <kbd className="command-palette-item-shortcut">{cmd.shortcut}</kbd>}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()}
              {filteredCommands.length === 0 && (
                <div className="command-palette-empty">No commands found</div>
              )}
            </div>
            <div className="command-palette-footer">
              <span><kbd>↑↓</kbd> Navigate</span>
              <span><kbd>↵</kbd> Select</span>
              <span><kbd>ESC</kbd> Close</span>
            </div>
          </div>
        </div>
      )}

      <header className="header">
        <div className="header-logo">
          <button className="mobile-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar">
            <Icons.Menu />
          </button>
          <Icons.Logo />
          <span>Vizcraft</span>
        </div>
        <div className="header-actions">
          <button className="mobile-toggle" onClick={() => setPanelOpen(!panelOpen)} title="Toggle panel">
            <Icons.Info />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={loadDiagrams} title="Refresh">
            <Icons.Refresh />
          </button>
          <button className="btn btn-ghost btn-icon theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? <Icons.Moon /> : <Icons.Sun />}
          </button>
        </div>
      </header>

      {/* Mobile overlay */}
      {(sidebarOpen || panelOpen) && (
        <div
          className="mobile-overlay visible"
          onClick={() => {
            setSidebarOpen(false);
            setPanelOpen(false);
          }}
        />
      )}

      <main className="main">
        <Sidebar
          projects={filteredProjects}
          selectedDiagram={selectedId}
          onSelectDiagram={(id) => {
            setSelectedId(id);
            setSidebarOpen(false);
          }}
          onNewDiagram={handleNewDiagram}
          agents={agents}
          onRunAgent={handleRunAgent}
          runningAgent={runningAgent}
          isOpen={sidebarOpen}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapse}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        <div className="canvas-container">
          <div className="canvas-header">
            <span className="canvas-title">
              {selectedDiagram ? selectedDiagram.name : "No diagram selected"}
            </span>
            {selectedDiagram && (
              <div className="canvas-actions">
                <button className="btn btn-sm btn-secondary" onClick={handleCopySpec}>
                  <Icons.Copy /> Copy
                </button>
                <button className="btn btn-sm btn-primary" onClick={handleSendToClaude}>
                  <Icons.Send /> Send to Claude
                </button>
              </div>
            )}
          </div>
          <Canvas diagram={selectedDiagram} editorRef={editorRef} onThumbnailReady={handleThumbnailReady} />
        </div>

        <Panel
          diagram={selectedDiagram}
          onSendToClaude={handleSendToClaude}
          onCopySpec={handleCopySpec}
          onExport={handleExport}
          isOpen={panelOpen}
          activeTab={panelTab}
          onTabChange={setPanelTab}
        />
      </main>
    </div>
  );
}

// Mount
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
