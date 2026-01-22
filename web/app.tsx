/**
 * Vizcraft Web UI
 * AI-Native Diagramming for Claude Code
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Tldraw, createTLStore, defaultShapeUtils } from "tldraw";
import { jsPDF } from "jspdf";
import "tldraw/tldraw.css";
import "./styles.css";

// Types
interface Diagram {
  id: string;
  name: string;
  project: string;
  spec: DiagramSpec;
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
};

// Agent type from API
interface Agent {
  id: string;
  name: string;
  description?: string;
  type: "rule-based" | "preset" | "llm";
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

// Sidebar component
function Sidebar({
  projects,
  selectedDiagram,
  onSelectDiagram,
  onNewDiagram,
  agents,
  onRunAgent,
  runningAgent,
}: {
  projects: Project[];
  selectedDiagram: string | null;
  onSelectDiagram: (id: string) => void;
  onNewDiagram: () => void;
  agents: Agent[];
  onRunAgent: (agentId: string) => void;
  runningAgent: string | null;
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
    <aside className="sidebar">
      <div className="sidebar-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <span className="sidebar-title" style={{ marginBottom: 0 }}>Projects</span>
          <button className="btn btn-ghost btn-sm" onClick={onNewDiagram} title="New Diagram">
            <Icons.Plus />
          </button>
        </div>
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.name}>
              <div
                className={`project-item ${expandedProjects.has(project.name) ? "active" : ""}`}
                onClick={() => toggleProject(project.name)}
              >
                <Icons.Folder />
                <span>{project.name}</span>
                <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {project.diagrams.length}
                </span>
              </div>
              {expandedProjects.has(project.name) && (
                <ul className="diagram-list">
                  {project.diagrams.map((d) => (
                    <li
                      key={d.id}
                      className={`diagram-item ${selectedDiagram === d.id ? "active" : ""}`}
                      onClick={() => onSelectDiagram(d.id)}
                    >
                      <Icons.File /> {d.name}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="sidebar-section" style={{ flex: 1 }}>
        <span className="sidebar-title">Agents</span>
        <div className="agent-list">
          {agents.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "0.875rem", padding: "0.5rem" }}>
              No agents loaded
            </div>
          ) : (
            agents.map((agent) => (
              <button
                key={agent.id}
                className={`agent-btn ${runningAgent === agent.id ? "running" : ""}`}
                onClick={() => onRunAgent(agent.id)}
                disabled={!selectedDiagram || runningAgent !== null}
                title={!selectedDiagram ? "Select a diagram first" : `Run ${agent.name}`}
              >
                <span className="agent-icon">
                  {runningAgent === agent.id ? "⏳" : getAgentIcon(agent)}
                </span>
                <span className="agent-info">
                  <span className="agent-name">{agent.name}</span>
                  <span className="agent-desc">{agent.description || agent.type}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

// Panel component
function Panel({
  diagram,
  onSendToClaude,
  onCopySpec,
  onExport,
}: {
  diagram: Diagram | null;
  onSendToClaude: () => void;
  onCopySpec: () => void;
  onExport: (format: string) => void;
}) {
  if (!diagram) {
    return (
      <aside className="panel">
        <div className="empty-state">
          <p>Select a diagram to see details</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel">
      <div className="panel-section">
        <h3 className="panel-title">Diagram Info</h3>
        <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
          <p><strong>Name:</strong> {diagram.name}</p>
          <p><strong>Project:</strong> {diagram.project}</p>
          <p><strong>Type:</strong> {diagram.spec.type}</p>
          <p><strong>Nodes:</strong> {diagram.spec.nodes.length}</p>
          <p><strong>Edges:</strong> {diagram.spec.edges.length}</p>
        </div>
      </div>

      <div className="panel-section">
        <h3 className="panel-title">Actions</h3>
        <div className="action-btns">
          <button className="btn btn-primary" onClick={onSendToClaude}>
            <Icons.Send /> Send to Claude
          </button>
          <button className="btn btn-secondary" onClick={onCopySpec}>
            <Icons.Copy /> Copy Spec
          </button>
          <button className="btn btn-secondary" onClick={() => onExport("png")}>
            <Icons.Download /> Export PNG
          </button>
          <button className="btn btn-secondary" onClick={() => onExport("svg")}>
            <Icons.Download /> Export SVG
          </button>
          <button className="btn btn-secondary" onClick={() => onExport("pdf")}>
            <Icons.Download /> Export PDF
          </button>
        </div>
      </div>

      <div className="panel-section">
        <h3 className="panel-title">Nodes</h3>
        <ul style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", listStyle: "none" }}>
          {diagram.spec.nodes.map((n) => (
            <li key={n.id} style={{ padding: "0.25rem 0" }}>
              • {n.label} <span style={{ color: "var(--text-muted)" }}>({n.type || "box"})</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

// Canvas component with tldraw
function Canvas({
  diagram,
  editorRef
}: {
  diagram: Diagram | null;
  editorRef: React.MutableRefObject<any>;
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
                text: node.label,
                color: "light-blue",
                fill: "solid",
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
                  start: { type: "point", x: 0, y: 0 },
                  end: { type: "point", x: to.x - from.x, y: to.y - from.y },
                  text: edge.label || "",
                },
              });
            }
          });

          // Add shapes to editor
          editor.createShapes(shapes);
          editor.zoomToFit();
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
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const editorRef = useRef<any>(null);

  const selectedDiagram = diagrams.find((d) => d.id === selectedId) || null;

  // Load diagrams and agents on mount
  useEffect(() => {
    loadDiagrams();
    loadAgents();
  }, []);

  // Auto-hide notifications
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + S: Save (copy spec)
      if (isMod && e.key === "s") {
        e.preventDefault();
        if (selectedDiagram) {
          handleCopySpec();
          setNotification({ type: "success", message: "Spec copied to clipboard" });
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
        alert(`Keyboard Shortcuts:
⌘/Ctrl + N: New diagram
⌘/Ctrl + S: Copy spec to clipboard
⌘/Ctrl + E: Export as PNG
⌘/Ctrl + /: Show this help`);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDiagram]);

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
        setNotification({
          type: "success",
          message: `Agent completed: ${result.changes?.join(", ") || "Done"}`,
        });
      } else {
        setNotification({
          type: "error",
          message: result.error || "Agent failed",
        });
      }
    } catch (err) {
      setNotification({
        type: "error",
        message: `Agent error: ${err}`,
      });
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
    alert("Diagram spec copied to clipboard!");
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
        // Export as SVG using editor.getSvg()
        const svg = await editor.getSvg([...shapeIds], {
          padding: 32,
          background: true,
        });

        if (svg) {
          const svgString = new XMLSerializer().serializeToString(svg);
          const blob = new Blob([svgString], { type: "image/svg+xml" });
          downloadBlob(blob, `${selectedDiagram.name}.svg`);
        }
      } else if (format === "png") {
        // Export as PNG by converting SVG to canvas
        const svg = await editor.getSvg([...shapeIds], {
          padding: 32,
          background: true,
          scale: 2,
        });

        if (svg) {
          const svgString = new XMLSerializer().serializeToString(svg);
          const blob = await svgToPngBlob(svgString);
          if (blob) {
            downloadBlob(blob, `${selectedDiagram.name}.png`);
          }
        }
      } else if (format === "pdf") {
        // Export as PDF using jsPDF
        const svg = await editor.getSvg([...shapeIds], {
          padding: 32,
          background: true,
          scale: 2,
        });

        if (svg) {
          const svgString = new XMLSerializer().serializeToString(svg);
          const pngBlob = await svgToPngBlob(svgString);

          if (pngBlob) {
            // Convert blob to data URL
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
            reader.readAsDataURL(pngBlob);
          }
        }
      }
    } catch (err) {
      console.error("Export failed:", err);
      alert(`Export failed: ${err}`);
    } finally {
      setExporting(false);
    }
  };

  // Convert SVG string to PNG blob
  const svgToPngBlob = (svgString: string): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          ctx.fillStyle = "#0f172a"; // Dark background
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);

          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            resolve(blob);
          }, "image/png");
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
      {/* Notification toast */}
      {notification && (
        <div className={`toast toast-${notification.type}`}>
          {notification.type === "success" ? "✓" : "✕"} {notification.message}
        </div>
      )}

      <header className="header">
        <div className="header-logo">
          <Icons.Logo />
          <span>Vizcraft</span>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost btn-icon" onClick={loadDiagrams} title="Refresh">
            <Icons.Refresh />
          </button>
          <button className="btn btn-ghost btn-icon" title="Toggle theme">
            <Icons.Moon />
          </button>
        </div>
      </header>

      <main className="main">
        <Sidebar
          projects={projects}
          selectedDiagram={selectedId}
          onSelectDiagram={setSelectedId}
          onNewDiagram={handleNewDiagram}
          agents={agents}
          onRunAgent={handleRunAgent}
          runningAgent={runningAgent}
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
          <Canvas diagram={selectedDiagram} editorRef={editorRef} />
        </div>

        <Panel
          diagram={selectedDiagram}
          onSendToClaude={handleSendToClaude}
          onCopySpec={handleCopySpec}
          onExport={handleExport}
        />
      </main>
    </div>
  );
}

// Mount
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
