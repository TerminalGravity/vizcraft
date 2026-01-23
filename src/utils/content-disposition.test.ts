import { describe, test, expect } from "bun:test";
import { getContentDisposition } from "./content-disposition";

describe("getContentDisposition", () => {
  test("handles ASCII-only names", () => {
    const result = getContentDisposition("MyDiagram", ".svg");
    expect(result).toBe('attachment; filename="MyDiagram.svg"');
  });

  test("handles names with spaces", () => {
    const result = getContentDisposition("My Diagram", ".svg");
    expect(result).toContain('filename="My_Diagram.svg"');
    expect(result).toContain("filename*=UTF-8''My%20Diagram.svg");
  });

  test("handles Unicode names", () => {
    const result = getContentDisposition("日本語", ".png");
    expect(result).toContain('filename="___.png"');
    expect(result).toContain("filename*=UTF-8''");
    // Should contain percent-encoded Japanese
    expect(result).toContain("%E6%97%A5");
  });

  test("handles mixed ASCII and Unicode", () => {
    const result = getContentDisposition("Diagram_日本語_Test", ".svg");
    // 3 Japanese characters → 3 underscores: Diagram_ + ___ + _Test
    expect(result).toContain('filename="Diagram_____Test.svg"');
    expect(result).toContain("filename*=UTF-8''");
  });

  test("preserves hyphens and underscores", () => {
    const result = getContentDisposition("my-diagram_v2", ".svg");
    expect(result).toBe('attachment; filename="my-diagram_v2.svg"');
  });

  test("handles special characters", () => {
    const result = getContentDisposition("test<>file", ".svg");
    expect(result).toContain('filename="test__file.svg"');
    expect(result).toContain("filename*=UTF-8''test%3C%3Efile.svg");
  });

  test("handles quotes in name", () => {
    const result = getContentDisposition('test"file', ".svg");
    expect(result).toContain('filename="test_file.svg"');
    expect(result).toContain("filename*=UTF-8''test%22file.svg");
  });

  test("handles apostrophes in name", () => {
    const result = getContentDisposition("John's Diagram", ".svg");
    expect(result).toContain('filename="John_s_Diagram.svg"');
    expect(result).toContain("filename*=UTF-8''John%27s%20Diagram.svg");
  });

  test("handles various extensions", () => {
    expect(getContentDisposition("test", ".png")).toContain(".png");
    expect(getContentDisposition("test", ".pdf")).toContain(".pdf");
    expect(getContentDisposition("test", ".json")).toContain(".json");
  });

  test("handles empty name", () => {
    const result = getContentDisposition("", ".svg");
    expect(result).toBe('attachment; filename=".svg"');
  });

  test("handles emoji in name", () => {
    const result = getContentDisposition("Diagram 🎨", ".svg");
    // Space + emoji (surrogate pair = 2 code units) → 3 underscores
    expect(result).toContain('filename="Diagram___.svg"');
    expect(result).toContain("filename*=UTF-8''");
  });
});
