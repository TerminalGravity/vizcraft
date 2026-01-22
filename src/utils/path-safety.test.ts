/**
 * Path Safety Tests
 */

import { describe, it, expect } from "bun:test";
import {
  sanitizeFilename,
  isPathWithinDirectory,
  createSafeExportPath,
  validateExportPath,
} from "./path-safety";

describe("sanitizeFilename", () => {
  it("removes path traversal patterns", () => {
    expect(sanitizeFilename("../../../etc/passwd")).toBe("etc_passwd");
    expect(sanitizeFilename("..")).toBe("untitled");
    expect(sanitizeFilename("../../")).toBe("untitled");
  });

  it("removes path separators", () => {
    expect(sanitizeFilename("path/to/file")).toBe("path_to_file");
    expect(sanitizeFilename("path\\to\\file")).toBe("path_to_file");
  });

  it("removes dangerous characters", () => {
    expect(sanitizeFilename('file<>:"|?*name')).toBe("file_name");
    expect(sanitizeFilename("file\x00name")).toBe("filename");
  });

  it("preserves safe characters", () => {
    expect(sanitizeFilename("my-diagram_v2.0")).toBe("my-diagram_v2.0");
    expect(sanitizeFilename("test-diagram")).toBe("test-diagram");
  });

  it("handles empty or whitespace", () => {
    expect(sanitizeFilename("")).toBe("untitled");
    expect(sanitizeFilename("   ")).toBe("untitled");
    expect(sanitizeFilename("___")).toBe("untitled");
  });

  it("truncates long filenames", () => {
    const longName = "a".repeat(300);
    expect(sanitizeFilename(longName).length).toBeLessThanOrEqual(200);
  });

  it("collapses multiple underscores", () => {
    expect(sanitizeFilename("file___name")).toBe("file_name");
    expect(sanitizeFilename("a//b\\\\c")).toBe("a_b_c");
  });
});

describe("isPathWithinDirectory", () => {
  it("returns true for paths within directory", () => {
    expect(isPathWithinDirectory("./data/exports/file.json", "./data/exports")).toBe(true);
    expect(isPathWithinDirectory("./data/exports/subdir/file.json", "./data/exports")).toBe(true);
  });

  it("returns false for paths outside directory", () => {
    expect(isPathWithinDirectory("./data/file.json", "./data/exports")).toBe(false);
    expect(isPathWithinDirectory("/etc/passwd", "./data/exports")).toBe(false);
    expect(isPathWithinDirectory("../file.json", "./data/exports")).toBe(false);
  });

  it("returns false for traversal attempts", () => {
    expect(isPathWithinDirectory("./data/exports/../secrets/file.json", "./data/exports")).toBe(false);
    expect(isPathWithinDirectory("./data/exports/../../etc/passwd", "./data/exports")).toBe(false);
  });
});

describe("createSafeExportPath", () => {
  it("creates safe paths", () => {
    const path = createSafeExportPath("my-diagram", "json");
    expect(path).toBe("data/exports/my-diagram.json");
  });

  it("handles extension with or without dot", () => {
    expect(createSafeExportPath("test", ".json")).toBe("data/exports/test.json");
    expect(createSafeExportPath("test", "json")).toBe("data/exports/test.json");
  });

  it("sanitizes dangerous names", () => {
    const path = createSafeExportPath("../../../etc/passwd", "json");
    expect(path).toBe("data/exports/etc_passwd.json");
    expect(path).not.toContain("..");
  });

  it("uses custom base directory", () => {
    const path = createSafeExportPath("test", "json", "./custom/dir");
    expect(path).toBe("custom/dir/test.json");
  });
});

describe("validateExportPath", () => {
  it("extracts filename from full path", () => {
    const result = validateExportPath("/some/user/path/myfile.json");
    expect(result).toBe("data/exports/myfile.json");
  });

  it("handles paths without extension", () => {
    const result = validateExportPath("filename");
    expect(result).toBe("data/exports/filename");
  });

  it("prevents path traversal", () => {
    const result = validateExportPath("../../../etc/passwd.json");
    expect(result).toBe("data/exports/passwd.json");
    expect(result).not.toContain("..");
  });
});
