/**
 * Styling Application Tests
 */

import { describe, it, expect } from "bun:test";
import {
  applyThemeToDiagram,
  generateStyledCSS,
  getNodeInlineStyles,
  getEdgeInlineStyles,
} from "./apply";
import { getTheme, darkTheme, lightTheme, professionalTheme } from "./themes";
import type { DiagramSpec, DiagramNode, DiagramEdge } from "../types";

// Sample spec for testing
const createSampleSpec = (overrides: Partial<DiagramSpec> = {}): DiagramSpec => ({
  type: "flowchart",
  nodes: [
    { id: "1", label: "Start" },
    { id: "2", label: "Process" },
    { id: "3", label: "End" },
  ],
  edges: [
    { from: "1", to: "2" },
    { from: "2", to: "3" },
  ],
  ...overrides,
});

describe("applyThemeToDiagram", () => {
  it("applies dark theme by default", () => {
    const spec = createSampleSpec();
    const styled = applyThemeToDiagram(spec);

    expect(styled.theme).toBe("dark");
    expect(styled.nodes[0].color).toBe(darkTheme.colors.nodeStroke);
  });

  it("applies specified theme", () => {
    const spec = createSampleSpec();
    const styled = applyThemeToDiagram(spec, "light");

    expect(styled.theme).toBe("light");
    expect(styled.nodes[0].color).toBe(lightTheme.colors.nodeStroke);
  });

  it("respects spec.theme if no themeId provided", () => {
    const spec = createSampleSpec({ theme: "professional" });
    const styled = applyThemeToDiagram(spec);

    expect(styled.theme).toBe("professional");
    expect(styled.nodes[0].color).toBe(professionalTheme.colors.nodeStroke);
  });

  it("preserves existing node colors", () => {
    const spec = createSampleSpec({
      nodes: [
        { id: "1", label: "Custom", color: "#ff0000" },
        { id: "2", label: "Default" },
      ],
    });

    const styled = applyThemeToDiagram(spec);

    // Custom color should be preserved
    expect(styled.nodes[0].color).toBe("#ff0000");
    // Default should get theme color
    expect(styled.nodes[1].color).toBe(darkTheme.colors.nodeStroke);
  });

  it("preserves existing edge colors", () => {
    const spec = createSampleSpec({
      edges: [
        { from: "1", to: "2", color: "#00ff00" },
        { from: "2", to: "3" },
      ],
    });

    const styled = applyThemeToDiagram(spec);

    // Custom color should be preserved
    expect(styled.edges[0].color).toBe("#00ff00");
    // Default should get theme color
    expect(styled.edges[1].color).toBe(darkTheme.colors.edgeStroke);
  });

  it("adds default dimensions to nodes", () => {
    const spec = createSampleSpec({
      nodes: [
        { id: "1", label: "No dimensions" },
        { id: "2", label: "Has dimensions", width: 200, height: 100 },
      ],
    });

    const styled = applyThemeToDiagram(spec);

    // Node without dimensions gets defaults
    expect(styled.nodes[0].width).toBe(160);
    expect(styled.nodes[0].height).toBe(80);
    // Node with dimensions is preserved
    expect(styled.nodes[1].width).toBe(200);
    expect(styled.nodes[1].height).toBe(100);
  });

  it("applies default edge style", () => {
    const spec = createSampleSpec({
      edges: [
        { from: "1", to: "2" },
        { from: "2", to: "3", style: "dashed" },
      ],
    });

    const styled = applyThemeToDiagram(spec);

    // Edge without style gets default
    expect(styled.edges[0].style).toBe("solid");
    // Edge with style is preserved
    expect(styled.edges[1].style).toBe("dashed");
  });

  it("applies correct colors for special node types", () => {
    const spec = createSampleSpec({
      nodes: [
        { id: "1", label: "Database", type: "database" },
        { id: "2", label: "Cloud", type: "cloud" },
        { id: "3", label: "Decision", type: "diamond" },
      ],
    });

    const styled = applyThemeToDiagram(spec);

    // Special node types get special colors
    expect(styled.nodes[0].color).toBe(darkTheme.colors.database);
    expect(styled.nodes[1].color).toBe(darkTheme.colors.cloud);
    expect(styled.nodes[2].color).toBe(darkTheme.colors.decision);
  });

  it("handles empty nodes and edges arrays", () => {
    const spec = createSampleSpec({ nodes: [], edges: [] });
    const styled = applyThemeToDiagram(spec);

    expect(styled.nodes).toHaveLength(0);
    expect(styled.edges).toHaveLength(0);
  });

  it("falls back to dark theme for unknown theme id", () => {
    const spec = createSampleSpec();
    const styled = applyThemeToDiagram(spec, "unknown-theme");

    // Should fall back to dark theme
    expect(styled.theme).toBe("dark");
    expect(styled.nodes[0].color).toBe(darkTheme.colors.nodeStroke);
  });
});

describe("generateStyledCSS", () => {
  it("generates CSS with theme variables", () => {
    const theme = getTheme("dark");
    const css = generateStyledCSS(theme);

    expect(css).toContain("--vz-canvas-bg:");
    expect(css).toContain("--vz-node-fill:");
    expect(css).toContain("--vz-edge-stroke:");
    expect(css).toContain("--vz-accent:");
  });

  it("includes theme name in comment", () => {
    const theme = getTheme("dark");
    const css = generateStyledCSS(theme);

    expect(css).toContain(theme.name);
  });

  it("generates different CSS for different themes", () => {
    const darkCSS = generateStyledCSS(getTheme("dark"));
    const lightCSS = generateStyledCSS(getTheme("light"));

    // Different canvas backgrounds
    expect(darkCSS).toContain(darkTheme.colors.canvas);
    expect(lightCSS).toContain(lightTheme.colors.canvas);
    expect(darkCSS).not.toBe(lightCSS);
  });

  it("handles missing optional color fields", () => {
    const theme = getTheme("dark");
    const css = generateStyledCSS(theme);

    // Should handle missing optional fields gracefully
    expect(css).toContain("--vz-canvas-gradient-start:");
    expect(css).toContain("--vz-node-glow:");
  });
});

describe("getNodeInlineStyles", () => {
  it("returns correct SVG attributes", () => {
    const theme = getTheme("dark");
    const styles = getNodeInlineStyles(theme);

    expect(styles.fill).toBe(theme.colors.nodeFill);
    expect(styles.stroke).toBe(theme.colors.nodeStroke);
    expect(styles["stroke-width"]).toBe("2");
    expect(styles.rx).toBe(String(theme.effects.nodeRadius));
    expect(styles.ry).toBe(String(theme.effects.nodeRadius));
    expect(styles.filter).toContain("drop-shadow");
  });

  it("uses special color for database node type", () => {
    const theme = getTheme("dark");
    const styles = getNodeInlineStyles(theme, "database");

    expect(styles.stroke).toBe(theme.colors.database);
  });

  it("uses special color for cloud node type", () => {
    const theme = getTheme("dark");
    const styles = getNodeInlineStyles(theme, "cloud");

    expect(styles.stroke).toBe(theme.colors.cloud);
  });

  it("uses default stroke for unknown node type", () => {
    const theme = getTheme("dark");
    const styles = getNodeInlineStyles(theme, "unknown");

    expect(styles.stroke).toBe(theme.colors.nodeStroke);
  });
});

describe("getEdgeInlineStyles", () => {
  it("returns correct SVG attributes", () => {
    const theme = getTheme("dark");
    const styles = getEdgeInlineStyles(theme);

    expect(styles.stroke).toBe(theme.colors.edgeStroke);
    expect(styles["stroke-width"]).toBe("2");
    expect(styles["stroke-linecap"]).toBe("round");
    expect(styles["stroke-linejoin"]).toBe("round");
    expect(styles.fill).toBe("none");
  });

  it("uses theme edge color", () => {
    const darkStyles = getEdgeInlineStyles(getTheme("dark"));
    const lightStyles = getEdgeInlineStyles(getTheme("light"));

    expect(darkStyles.stroke).toBe(darkTheme.colors.edgeStroke);
    expect(lightStyles.stroke).toBe(lightTheme.colors.edgeStroke);
  });
});

describe("theme consistency", () => {
  it("all themes have required color fields", () => {
    const themes = ["dark", "light", "professional"];

    for (const themeId of themes) {
      const theme = getTheme(themeId);

      expect(theme.colors.canvas).toBeDefined();
      expect(theme.colors.nodeFill).toBeDefined();
      expect(theme.colors.nodeStroke).toBeDefined();
      expect(theme.colors.edgeStroke).toBeDefined();
      expect(theme.colors.database).toBeDefined();
      expect(theme.colors.cloud).toBeDefined();
    }
  });

  it("all themes have consistent structure", () => {
    const themes = ["dark", "light", "professional"];

    for (const themeId of themes) {
      const theme = getTheme(themeId);

      expect(theme.id).toBe(themeId);
      expect(theme.name).toBeDefined();
      expect(theme.mode).toMatch(/^(dark|light)$/);
      expect(theme.typography.fontFamily).toBeDefined();
      expect(theme.effects.nodeRadius).toBeGreaterThan(0);
    }
  });
});
