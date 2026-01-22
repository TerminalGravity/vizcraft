/**
 * Premium Diagram Themes
 * Carefully crafted color palettes for stunning visualizations
 */

export interface ThemeColors {
  // Background
  canvas: string;
  canvasGradientStart?: string;
  canvasGradientEnd?: string;

  // Nodes
  nodeFill: string;
  nodeFillSecondary: string;
  nodeStroke: string;
  nodeStrokeHighlight: string;
  nodeText: string;
  nodeGlow?: string;

  // Edges
  edgeStroke: string;
  edgeStrokeHighlight: string;
  edgeLabel: string;

  // Special nodes
  database: string;
  cloud: string;
  decision: string;
  start: string;
  end: string;

  // Accents
  accent: string;
  accentSecondary: string;
  success: string;
  warning: string;
  error: string;

  // Shadows
  shadowColor: string;
  shadowOpacity: number;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  mode: "dark" | "light";
  colors: ThemeColors;
  typography: {
    fontFamily: string;
    fontWeight: number;
    labelSize: number;
  };
  effects: {
    nodeRadius: number;
    shadowBlur: number;
    glowIntensity: number;
    edgeSmoothness: number;
  };
}

// Premium Dark Theme - Deep blues with vibrant accents
export const darkTheme: Theme = {
  id: "dark",
  name: "Midnight",
  description: "Deep blues with vibrant neon accents",
  mode: "dark",
  colors: {
    canvas: "#0f172a",
    canvasGradientStart: "#0f172a",
    canvasGradientEnd: "#1e293b",

    nodeFill: "#1e293b",
    nodeFillSecondary: "#334155",
    nodeStroke: "#3b82f6",
    nodeStrokeHighlight: "#60a5fa",
    nodeText: "#f1f5f9",
    nodeGlow: "rgba(59, 130, 246, 0.4)",

    edgeStroke: "#64748b",
    edgeStrokeHighlight: "#3b82f6",
    edgeLabel: "#94a3b8",

    database: "#8b5cf6",
    cloud: "#06b6d4",
    decision: "#f59e0b",
    start: "#22c55e",
    end: "#ef4444",

    accent: "#3b82f6",
    accentSecondary: "#8b5cf6",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",

    shadowColor: "#000000",
    shadowOpacity: 0.5,
  },
  typography: {
    fontFamily: "Inter, SF Pro Display, -apple-system, sans-serif",
    fontWeight: 500,
    labelSize: 14,
  },
  effects: {
    nodeRadius: 12,
    shadowBlur: 20,
    glowIntensity: 0.4,
    edgeSmoothness: 0.5,
  },
};

// Premium Light Theme - Clean whites with crisp colors
export const lightTheme: Theme = {
  id: "light",
  name: "Daylight",
  description: "Clean whites with soft shadows",
  mode: "light",
  colors: {
    canvas: "#ffffff",
    canvasGradientStart: "#ffffff",
    canvasGradientEnd: "#f8fafc",

    nodeFill: "#ffffff",
    nodeFillSecondary: "#f1f5f9",
    nodeStroke: "#3b82f6",
    nodeStrokeHighlight: "#2563eb",
    nodeText: "#1e293b",

    edgeStroke: "#94a3b8",
    edgeStrokeHighlight: "#3b82f6",
    edgeLabel: "#64748b",

    database: "#7c3aed",
    cloud: "#0891b2",
    decision: "#d97706",
    start: "#16a34a",
    end: "#dc2626",

    accent: "#3b82f6",
    accentSecondary: "#7c3aed",
    success: "#16a34a",
    warning: "#d97706",
    error: "#dc2626",

    shadowColor: "#64748b",
    shadowOpacity: 0.15,
  },
  typography: {
    fontFamily: "Inter, SF Pro Display, -apple-system, sans-serif",
    fontWeight: 500,
    labelSize: 14,
  },
  effects: {
    nodeRadius: 12,
    shadowBlur: 16,
    glowIntensity: 0.2,
    edgeSmoothness: 0.5,
  },
};

// Professional Theme - Navy/gold corporate feel
export const professionalTheme: Theme = {
  id: "professional",
  name: "Executive",
  description: "Navy and gold corporate aesthetic",
  mode: "dark",
  colors: {
    canvas: "#0a1628",
    canvasGradientStart: "#0a1628",
    canvasGradientEnd: "#162032",

    nodeFill: "#162032",
    nodeFillSecondary: "#1e3a5f",
    nodeStroke: "#c9a227",
    nodeStrokeHighlight: "#e6b932",
    nodeText: "#f0f4f8",
    nodeGlow: "rgba(201, 162, 39, 0.3)",

    edgeStroke: "#4a6fa5",
    edgeStrokeHighlight: "#c9a227",
    edgeLabel: "#8fadd1",

    database: "#5e81ac",
    cloud: "#88c0d0",
    decision: "#c9a227",
    start: "#a3be8c",
    end: "#bf616a",

    accent: "#c9a227",
    accentSecondary: "#5e81ac",
    success: "#a3be8c",
    warning: "#ebcb8b",
    error: "#bf616a",

    shadowColor: "#000000",
    shadowOpacity: 0.6,
  },
  typography: {
    fontFamily: "Inter, SF Pro Display, -apple-system, sans-serif",
    fontWeight: 600,
    labelSize: 14,
  },
  effects: {
    nodeRadius: 8,
    shadowBlur: 24,
    glowIntensity: 0.3,
    edgeSmoothness: 0.4,
  },
};

// Vibrant Theme - Bold colors, high contrast
export const vibrantTheme: Theme = {
  id: "vibrant",
  name: "Neon",
  description: "Bold neon colors with high contrast",
  mode: "dark",
  colors: {
    canvas: "#0d0d0d",
    canvasGradientStart: "#0d0d0d",
    canvasGradientEnd: "#1a1a2e",

    nodeFill: "#16213e",
    nodeFillSecondary: "#1f3460",
    nodeStroke: "#e94560",
    nodeStrokeHighlight: "#ff6b6b",
    nodeText: "#ffffff",
    nodeGlow: "rgba(233, 69, 96, 0.5)",

    edgeStroke: "#0f3460",
    edgeStrokeHighlight: "#e94560",
    edgeLabel: "#94a3b8",

    database: "#9b59b6",
    cloud: "#00d9ff",
    decision: "#f39c12",
    start: "#2ecc71",
    end: "#e74c3c",

    accent: "#e94560",
    accentSecondary: "#00d9ff",
    success: "#2ecc71",
    warning: "#f39c12",
    error: "#e74c3c",

    shadowColor: "#e94560",
    shadowOpacity: 0.3,
  },
  typography: {
    fontFamily: "Inter, SF Pro Display, -apple-system, sans-serif",
    fontWeight: 700,
    labelSize: 14,
  },
  effects: {
    nodeRadius: 16,
    shadowBlur: 30,
    glowIntensity: 0.6,
    edgeSmoothness: 0.6,
  },
};

// Minimal Theme - Grayscale with accent
export const minimalTheme: Theme = {
  id: "minimal",
  name: "Minimal",
  description: "Clean grayscale with subtle accent",
  mode: "light",
  colors: {
    canvas: "#fafafa",
    canvasGradientStart: "#fafafa",
    canvasGradientEnd: "#f5f5f5",

    nodeFill: "#ffffff",
    nodeFillSecondary: "#f5f5f5",
    nodeStroke: "#404040",
    nodeStrokeHighlight: "#171717",
    nodeText: "#171717",

    edgeStroke: "#a3a3a3",
    edgeStrokeHighlight: "#404040",
    edgeLabel: "#737373",

    database: "#525252",
    cloud: "#737373",
    decision: "#404040",
    start: "#22c55e",
    end: "#171717",

    accent: "#171717",
    accentSecondary: "#525252",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",

    shadowColor: "#000000",
    shadowOpacity: 0.08,
  },
  typography: {
    fontFamily: "Inter, SF Pro Display, -apple-system, sans-serif",
    fontWeight: 400,
    labelSize: 13,
  },
  effects: {
    nodeRadius: 4,
    shadowBlur: 8,
    glowIntensity: 0,
    edgeSmoothness: 0.3,
  },
};

// Ocean Theme - Deep sea colors
export const oceanTheme: Theme = {
  id: "ocean",
  name: "Ocean Depths",
  description: "Deep sea blues and teals",
  mode: "dark",
  colors: {
    canvas: "#0a192f",
    canvasGradientStart: "#0a192f",
    canvasGradientEnd: "#112240",

    nodeFill: "#112240",
    nodeFillSecondary: "#1d3557",
    nodeStroke: "#64ffda",
    nodeStrokeHighlight: "#7efff5",
    nodeText: "#ccd6f6",
    nodeGlow: "rgba(100, 255, 218, 0.3)",

    edgeStroke: "#495670",
    edgeStrokeHighlight: "#64ffda",
    edgeLabel: "#8892b0",

    database: "#bd93f9",
    cloud: "#8be9fd",
    decision: "#ffb86c",
    start: "#50fa7b",
    end: "#ff5555",

    accent: "#64ffda",
    accentSecondary: "#bd93f9",
    success: "#50fa7b",
    warning: "#ffb86c",
    error: "#ff5555",

    shadowColor: "#000000",
    shadowOpacity: 0.5,
  },
  typography: {
    fontFamily: "JetBrains Mono, Fira Code, monospace",
    fontWeight: 500,
    labelSize: 13,
  },
  effects: {
    nodeRadius: 10,
    shadowBlur: 20,
    glowIntensity: 0.35,
    edgeSmoothness: 0.5,
  },
};

// Theme registry
export const themes: Record<string, Theme> = {
  dark: darkTheme,
  light: lightTheme,
  professional: professionalTheme,
  vibrant: vibrantTheme,
  minimal: minimalTheme,
  ocean: oceanTheme,
};

export function getTheme(id: string): Theme {
  return themes[id] || darkTheme;
}

export function listThemes(): Theme[] {
  return Object.values(themes);
}

// Get color for node type
export function getNodeColor(theme: Theme, nodeType?: string): string {
  switch (nodeType) {
    case "database":
    case "cylinder":
      return theme.colors.database;
    case "cloud":
      return theme.colors.cloud;
    case "diamond":
      return theme.colors.decision;
    case "circle":
      return theme.colors.accent;
    default:
      return theme.colors.nodeStroke;
  }
}
