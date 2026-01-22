/**
 * Styling Module Tests
 * Tests for theme application, CSS generation, and inline styles
 */

import { describe, it, expect } from "bun:test";
import {
  themes,
  getTheme,
  listThemes,
  getNodeColor,
  darkTheme,
  lightTheme,
  professionalTheme,
  vibrantTheme,
  minimalTheme,
  oceanTheme,
} from "./themes";
import {
  applyThemeToDiagram,
  generateStyledCSS,
  getNodeInlineStyles,
  getEdgeInlineStyles,
} from "./apply";
import type { DiagramSpec } from "../types";

describe("Theme Registry", () => {
  it("exports all 6 themes", () => {
    expect(Object.keys(themes)).toHaveLength(6);
    expect(themes.dark).toBeDefined();
    expect(themes.light).toBeDefined();
    expect(themes.professional).toBeDefined();
    expect(themes.vibrant).toBeDefined();
    expect(themes.minimal).toBeDefined();
    expect(themes.ocean).toBeDefined();
  });

  it("listThemes returns all themes as array", () => {
    const themeList = listThemes();
    expect(themeList).toHaveLength(6);
    expect(themeList.every((t) => t.id && t.name && t.colors)).toBe(true);
  });

  it("getTheme returns correct theme by ID", () => {
    expect(getTheme("dark")).toBe(darkTheme);
    expect(getTheme("light")).toBe(lightTheme);
    expect(getTheme("professional")).toBe(professionalTheme);
    expect(getTheme("vibrant")).toBe(vibrantTheme);
    expect(getTheme("minimal")).toBe(minimalTheme);
    expect(getTheme("ocean")).toBe(oceanTheme);
  });

  it("getTheme falls back to dark theme for unknown ID", () => {
    expect(getTheme("nonexistent")).toBe(darkTheme);
    expect(getTheme("")).toBe(darkTheme);
  });
});

describe("Theme Structure", () => {
  const allThemes = [darkTheme, lightTheme, professionalTheme, vibrantTheme, minimalTheme, oceanTheme];

  it("all themes have required color properties", () => {
    const requiredColors = [
      "canvas",
      "nodeFill",
      "nodeFillSecondary",
      "nodeStroke",
      "nodeStrokeHighlight",
      "nodeText",
      "edgeStroke",
      "edgeStrokeHighlight",
      "edgeLabel",
      "database",
      "cloud",
      "decision",
      "start",
      "end",
      "accent",
      "accentSecondary",
      "success",
      "warning",
      "error",
      "shadowColor",
      "shadowOpacity",
    ];

    for (const theme of allThemes) {
      for (const prop of requiredColors) {
        expect(theme.colors[prop as keyof typeof theme.colors]).toBeDefined();
      }
    }
  });

  it("all themes have valid mode (dark or light)", () => {
    for (const theme of allThemes) {
      expect(["dark", "light"]).toContain(theme.mode);
    }
  });

  it("all themes have typography settings", () => {
    for (const theme of allThemes) {
      expect(theme.typography.fontFamily).toBeDefined();
      expect(typeof theme.typography.fontWeight).toBe("number");
      expect(typeof theme.typography.labelSize).toBe("number");
    }
  });

  it("all themes have effect settings", () => {
    for (const theme of allThemes) {
      expect(typeof theme.effects.nodeRadius).toBe("number");
      expect(typeof theme.effects.shadowBlur).toBe("number");
      expect(typeof theme.effects.glowIntensity).toBe("number");
      expect(typeof theme.effects.edgeSmoothness).toBe("number");
    }
  });

  it("shadow opacity is between 0 and 1", () => {
    for (const theme of allThemes) {
      expect(theme.colors.shadowOpacity).toBeGreaterThanOrEqual(0);
      expect(theme.colors.shadowOpacity).toBeLessThanOrEqual(1);
    }
  });
});

describe("getNodeColor", () => {
  it("returns database color for database/cylinder nodes", () => {
    expect(getNodeColor(darkTheme, "database")).toBe(darkTheme.colors.database);
    expect(getNodeColor(darkTheme, "cylinder")).toBe(darkTheme.colors.database);
  });

  it("returns cloud color for cloud nodes", () => {
    expect(getNodeColor(darkTheme, "cloud")).toBe(darkTheme.colors.cloud);
  });

  it("returns decision color for diamond nodes", () => {
    expect(getNodeColor(darkTheme, "diamond")).toBe(darkTheme.colors.decision);
  });

  it("returns accent color for circle nodes", () => {
    expect(getNodeColor(darkTheme, "circle")).toBe(darkTheme.colors.accent);
  });

  it("returns nodeStroke as default for box and unknown types", () => {
    expect(getNodeColor(darkTheme, "box")).toBe(darkTheme.colors.nodeStroke);
    expect(getNodeColor(darkTheme, "unknown")).toBe(darkTheme.colors.nodeStroke);
    expect(getNodeColor(darkTheme, undefined)).toBe(darkTheme.colors.nodeStroke);
  });

  it("works with all themes", () => {
    for (const theme of listThemes()) {
      expect(getNodeColor(theme, "database")).toBe(theme.colors.database);
      expect(getNodeColor(theme, "cloud")).toBe(theme.colors.cloud);
    }
  });
});

describe("applyThemeToDiagram", () => {
  const testSpec: DiagramSpec = {
    type: "flowchart",
    nodes: [
      { id: "a", label: "Start" },
      { id: "b", label: "Process", type: "box" },
      { id: "c", label: "Database", type: "database" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  };

  it("applies default dark theme when no theme specified", () => {
    const result = applyThemeToDiagram(testSpec);
    expect(result.theme).toBe("dark");
  });

  it("applies specified theme by ID", () => {
    const result = applyThemeToDiagram(testSpec, "light");
    expect(result.theme).toBe("light");
  });

  it("uses spec.theme if no themeId provided", () => {
    const specWithTheme: DiagramSpec = { ...testSpec, theme: "professional" };
    const result = applyThemeToDiagram(specWithTheme);
    expect(result.theme).toBe("professional");
  });

  it("themeId parameter overrides spec.theme", () => {
    const specWithTheme: DiagramSpec = { ...testSpec, theme: "professional" };
    const result = applyThemeToDiagram(specWithTheme, "vibrant");
    expect(result.theme).toBe("vibrant");
  });

  it("adds colors to unstyled nodes", () => {
    const result = applyThemeToDiagram(testSpec, "dark");

    // All nodes should have colors
    for (const node of result.nodes) {
      expect(node.color).toBeDefined();
    }

    // Database node should have database color
    const dbNode = result.nodes.find((n) => n.id === "c");
    expect(dbNode?.color).toBe(darkTheme.colors.database);
  });

  it("preserves existing node colors", () => {
    const specWithColor: DiagramSpec = {
      ...testSpec,
      nodes: [{ id: "custom", label: "Custom", color: "#ff0000" }],
    };
    const result = applyThemeToDiagram(specWithColor);
    expect(result.nodes[0].color).toBe("#ff0000");
  });

  it("adds default dimensions to nodes without them", () => {
    const result = applyThemeToDiagram(testSpec);

    for (const node of result.nodes) {
      expect(node.width).toBe(160);
      expect(node.height).toBe(80);
    }
  });

  it("preserves existing node dimensions", () => {
    const specWithDimensions: DiagramSpec = {
      ...testSpec,
      nodes: [{ id: "sized", label: "Sized", width: 200, height: 100 }],
    };
    const result = applyThemeToDiagram(specWithDimensions);
    expect(result.nodes[0].width).toBe(200);
    expect(result.nodes[0].height).toBe(100);
  });

  it("adds colors to unstyled edges", () => {
    const result = applyThemeToDiagram(testSpec, "dark");

    for (const edge of result.edges) {
      expect(edge.color).toBe(darkTheme.colors.edgeStroke);
      expect(edge.style).toBe("solid");
    }
  });

  it("preserves existing edge colors", () => {
    const specWithEdgeColor: DiagramSpec = {
      ...testSpec,
      edges: [{ from: "a", to: "b", color: "#00ff00" }],
    };
    const result = applyThemeToDiagram(specWithEdgeColor);
    expect(result.edges[0].color).toBe("#00ff00");
  });

  it("preserves existing edge style", () => {
    const specWithEdgeStyle: DiagramSpec = {
      ...testSpec,
      edges: [{ from: "a", to: "b", style: "dashed" }],
    };
    const result = applyThemeToDiagram(specWithEdgeStyle);
    expect(result.edges[0].style).toBe("dashed");
  });

  it("handles empty diagram", () => {
    const emptySpec: DiagramSpec = {
      type: "flowchart",
      nodes: [],
      edges: [],
    };
    const result = applyThemeToDiagram(emptySpec);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.theme).toBe("dark");
  });
});

describe("generateStyledCSS", () => {
  it("generates CSS with theme name comment", () => {
    const css = generateStyledCSS(darkTheme);
    expect(css).toContain("/* Vizcraft Premium Styling - Midnight */");
  });

  it("generates CSS variables for all theme colors", () => {
    const css = generateStyledCSS(darkTheme);

    expect(css).toContain(`--vz-canvas-bg: ${darkTheme.colors.canvas}`);
    expect(css).toContain(`--vz-node-fill: ${darkTheme.colors.nodeFill}`);
    expect(css).toContain(`--vz-node-stroke: ${darkTheme.colors.nodeStroke}`);
    expect(css).toContain(`--vz-node-text: ${darkTheme.colors.nodeText}`);
    expect(css).toContain(`--vz-edge-stroke: ${darkTheme.colors.edgeStroke}`);
    expect(css).toContain(`--vz-accent: ${darkTheme.colors.accent}`);
  });

  it("generates CSS variables for typography", () => {
    const css = generateStyledCSS(darkTheme);

    expect(css).toContain(`--vz-font-family: ${darkTheme.typography.fontFamily}`);
    expect(css).toContain(`--vz-font-weight: ${darkTheme.typography.fontWeight}`);
  });

  it("generates CSS variables for effects", () => {
    const css = generateStyledCSS(darkTheme);

    expect(css).toContain(`--vz-node-radius: ${darkTheme.effects.nodeRadius}px`);
    expect(css).toContain(`--vz-shadow-blur: ${darkTheme.effects.shadowBlur}px`);
    expect(css).toContain(`--vz-glow-intensity: ${darkTheme.effects.glowIntensity}`);
  });

  it("includes tldraw-specific selectors", () => {
    const css = generateStyledCSS(darkTheme);

    expect(css).toContain(".tl-background");
    expect(css).toContain(".tl-shape");
    expect(css).toContain(".tl-selection__fg");
    expect(css).toContain(".tl-grid");
  });

  it("handles themes without optional gradient colors", () => {
    // Create a theme without gradient colors
    const themeWithoutGradient = {
      ...darkTheme,
      colors: {
        ...darkTheme.colors,
        canvasGradientStart: undefined,
        canvasGradientEnd: undefined,
      },
    };
    // Should fall back to canvas color
    const css = generateStyledCSS(themeWithoutGradient as any);
    expect(css).toContain(`--vz-canvas-gradient-start: ${darkTheme.colors.canvas}`);
    expect(css).toContain(`--vz-canvas-gradient-end: ${darkTheme.colors.canvas}`);
  });

  it("handles themes without nodeGlow", () => {
    const themeWithoutGlow = {
      ...lightTheme, // light theme might not have glow
      colors: {
        ...lightTheme.colors,
        nodeGlow: undefined,
      },
    };
    const css = generateStyledCSS(themeWithoutGlow as any);
    expect(css).toContain("--vz-node-glow: transparent");
  });

  it("generates different CSS for different themes", () => {
    const darkCss = generateStyledCSS(darkTheme);
    const lightCss = generateStyledCSS(lightTheme);

    // Should have different canvas colors
    expect(darkCss).toContain(`--vz-canvas-bg: ${darkTheme.colors.canvas}`);
    expect(lightCss).toContain(`--vz-canvas-bg: ${lightTheme.colors.canvas}`);
    expect(darkTheme.colors.canvas).not.toBe(lightTheme.colors.canvas);
  });
});

describe("getNodeInlineStyles", () => {
  it("returns object with SVG-compatible style properties", () => {
    const styles = getNodeInlineStyles(darkTheme);

    expect(styles.fill).toBe(darkTheme.colors.nodeFill);
    expect(styles.stroke).toBeDefined();
    expect(styles["stroke-width"]).toBe("2");
    expect(styles.rx).toBe(String(darkTheme.effects.nodeRadius));
    expect(styles.ry).toBe(String(darkTheme.effects.nodeRadius));
    expect(styles.filter).toContain("drop-shadow");
  });

  it("uses nodeStroke color for default node type", () => {
    const styles = getNodeInlineStyles(darkTheme);
    expect(styles.stroke).toBe(darkTheme.colors.nodeStroke);
  });

  it("uses database color for database node type", () => {
    const styles = getNodeInlineStyles(darkTheme, "database");
    expect(styles.stroke).toBe(darkTheme.colors.database);
  });

  it("uses cloud color for cloud node type", () => {
    const styles = getNodeInlineStyles(darkTheme, "cloud");
    expect(styles.stroke).toBe(darkTheme.colors.cloud);
  });

  it("uses decision color for diamond node type", () => {
    const styles = getNodeInlineStyles(darkTheme, "diamond");
    expect(styles.stroke).toBe(darkTheme.colors.decision);
  });

  it("includes shadow effect with theme settings", () => {
    const styles = getNodeInlineStyles(darkTheme);
    expect(styles.filter).toContain(String(darkTheme.effects.shadowBlur));
    expect(styles.filter).toContain(darkTheme.colors.shadowColor);
  });
});

describe("getEdgeInlineStyles", () => {
  it("returns object with SVG-compatible style properties", () => {
    const styles = getEdgeInlineStyles(darkTheme);

    expect(styles.stroke).toBe(darkTheme.colors.edgeStroke);
    expect(styles["stroke-width"]).toBe("2");
    expect(styles["stroke-linecap"]).toBe("round");
    expect(styles["stroke-linejoin"]).toBe("round");
    expect(styles.fill).toBe("none");
  });

  it("uses theme edge color", () => {
    const darkStyles = getEdgeInlineStyles(darkTheme);
    const lightStyles = getEdgeInlineStyles(lightTheme);

    expect(darkStyles.stroke).toBe(darkTheme.colors.edgeStroke);
    expect(lightStyles.stroke).toBe(lightTheme.colors.edgeStroke);
    expect(darkStyles.stroke).not.toBe(lightStyles.stroke);
  });
});

describe("Theme Color Consistency", () => {
  it("dark themes have dark canvas colors", () => {
    const darkModeThemes = listThemes().filter((t) => t.mode === "dark");

    for (const theme of darkModeThemes) {
      // Dark canvas colors should start with low hex values or be named dark
      const canvas = theme.colors.canvas.toLowerCase();
      // Check if it's a dark color (first char after # is 0-4 typically)
      const firstHex = parseInt(canvas.slice(1, 2), 16);
      expect(firstHex).toBeLessThan(5); // First hex digit should be low for dark colors
    }
  });

  it("light themes have light canvas colors", () => {
    const lightModeThemes = listThemes().filter((t) => t.mode === "light");

    for (const theme of lightModeThemes) {
      const canvas = theme.colors.canvas.toLowerCase();
      const firstHex = parseInt(canvas.slice(1, 2), 16);
      expect(firstHex).toBeGreaterThan(10); // First hex digit should be high for light colors
    }
  });
});
