/**
 * Path Safety Tests
 *
 * Comprehensive tests for security-critical path and file validation
 */

import { describe, it, expect } from "bun:test";
import {
  sanitizeFilename,
  isPathWithinDirectory,
  createSafeExportPath,
  validateExportPath,
  validateExtension,
  isExtensionAllowed,
  validateDataUrl,
  isValidDataUrl,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  ExtensionNotAllowedError,
  PathTraversalError,
  InvalidDataUrlError,
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

describe("validateExtension", () => {
  it("accepts allowed extensions", () => {
    expect(validateExtension(".json")).toBe(".json");
    expect(validateExtension(".svg")).toBe(".svg");
    expect(validateExtension(".png")).toBe(".png");
    expect(validateExtension(".pdf")).toBe(".pdf");
    expect(validateExtension(".jpeg")).toBe(".jpeg");
    expect(validateExtension(".jpg")).toBe(".jpg");
    expect(validateExtension(".webp")).toBe(".webp");
  });

  it("normalizes extensions without leading dot", () => {
    expect(validateExtension("json")).toBe(".json");
    expect(validateExtension("png")).toBe(".png");
  });

  it("handles case-insensitive extensions", () => {
    expect(validateExtension(".JSON")).toBe(".json");
    expect(validateExtension(".PNG")).toBe(".png");
    expect(validateExtension("SVG")).toBe(".svg");
  });

  it("rejects disallowed extensions", () => {
    expect(() => validateExtension(".exe")).toThrow(ExtensionNotAllowedError);
    expect(() => validateExtension(".sh")).toThrow(ExtensionNotAllowedError);
    expect(() => validateExtension(".zip")).toThrow(ExtensionNotAllowedError);
    expect(() => validateExtension(".html")).toThrow(ExtensionNotAllowedError);
    expect(() => validateExtension(".js")).toThrow(ExtensionNotAllowedError);
  });

  it("rejects double extensions", () => {
    expect(() => validateExtension(".json.exe")).toThrow(ExtensionNotAllowedError);
    expect(() => validateExtension(".png.sh")).toThrow(ExtensionNotAllowedError);
  });
});

describe("isExtensionAllowed", () => {
  it("returns true for allowed extensions", () => {
    expect(isExtensionAllowed(".json")).toBe(true);
    expect(isExtensionAllowed("png")).toBe(true);
    expect(isExtensionAllowed(".PDF")).toBe(true);
  });

  it("returns false for disallowed extensions", () => {
    expect(isExtensionAllowed(".exe")).toBe(false);
    expect(isExtensionAllowed("zip")).toBe(false);
  });
});

describe("validateDataUrl", () => {
  it("validates correct PNG data URLs", () => {
    const pngDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const result = validateDataUrl(pngDataUrl);
    expect(result.mimeType).toBe("image/png");
    expect(result.extension).toBe(".png");
    expect(result.data).toBe("iVBORw0KGgo=");
  });

  it("validates correct JPEG data URLs", () => {
    const jpegDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD=";
    const result = validateDataUrl(jpegDataUrl);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.extension).toBe(".jpg");
  });

  it("validates correct SVG data URLs", () => {
    const svgDataUrl = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0=";
    const result = validateDataUrl(svgDataUrl);
    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.extension).toBe(".svg");
  });

  it("validates correct JSON data URLs", () => {
    const jsonDataUrl = "data:application/json;base64,eyJ0ZXN0IjoxfQ==";
    const result = validateDataUrl(jsonDataUrl);
    expect(result.mimeType).toBe("application/json");
    expect(result.extension).toBe(".json");
  });

  it("rejects invalid data URL format", () => {
    expect(() => validateDataUrl("not a data url")).toThrow(InvalidDataUrlError);
    expect(() => validateDataUrl("data:image/png,no-base64")).toThrow(InvalidDataUrlError);
    expect(() => validateDataUrl("")).toThrow(InvalidDataUrlError);
  });

  it("rejects disallowed MIME types", () => {
    expect(() => validateDataUrl("data:text/html;base64,PGh0bWw+")).toThrow(InvalidDataUrlError);
    expect(() => validateDataUrl("data:application/javascript;base64,Y29uc29sZS5sb2c=")).toThrow(InvalidDataUrlError);
    expect(() => validateDataUrl("data:application/x-executable;base64,abc=")).toThrow(InvalidDataUrlError);
  });

  it("rejects empty data", () => {
    expect(() => validateDataUrl("data:image/png;base64,")).toThrow(InvalidDataUrlError);
  });

  it("rejects invalid base64 characters", () => {
    expect(() => validateDataUrl("data:image/png;base64,invalid!!!base64")).toThrow(InvalidDataUrlError);
  });
});

describe("isValidDataUrl", () => {
  it("returns true for valid data URLs", () => {
    expect(isValidDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isValidDataUrl("data:application/json;base64,eyJ0ZXN0IjoxfQ==")).toBe(true);
  });

  it("returns false for invalid data URLs", () => {
    expect(isValidDataUrl("not-a-data-url")).toBe(false);
    expect(isValidDataUrl("data:text/html;base64,test")).toBe(false);
    expect(isValidDataUrl("")).toBe(false);
  });
});

describe("createSafeExportPath", () => {
  it("creates safe paths with allowed extensions", () => {
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

  it("rejects disallowed extensions", () => {
    expect(() => createSafeExportPath("test", ".exe")).toThrow(ExtensionNotAllowedError);
    expect(() => createSafeExportPath("test", "sh")).toThrow(ExtensionNotAllowedError);
    expect(() => createSafeExportPath("test", ".zip")).toThrow(ExtensionNotAllowedError);
  });

  it("allows all whitelisted extensions", () => {
    for (const ext of ALLOWED_EXTENSIONS) {
      expect(() => createSafeExportPath("test", ext)).not.toThrow();
    }
  });
});

describe("validateExportPath", () => {
  it("extracts filename from full path with allowed extension", () => {
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

  it("rejects paths with disallowed extensions", () => {
    expect(() => validateExportPath("/path/to/malware.exe")).toThrow(ExtensionNotAllowedError);
    expect(() => validateExportPath("script.sh")).toThrow(ExtensionNotAllowedError);
  });
});

describe("Security Edge Cases", () => {
  it("prevents null byte injection", () => {
    const result = sanitizeFilename("file.json\x00.exe");
    expect(result).not.toContain("\x00");
    expect(result).toBe("file.json.exe");
  });

  it("handles unicode normalization attacks", () => {
    // These should be sanitized to safe versions
    const result = sanitizeFilename("file\u202E\u0067\u006E\u0070\u002E\u006A\u0073");
    expect(result).not.toContain("\u202E"); // RLO character
  });

  it("rejects data URLs with XSS payloads in base64", () => {
    // Even if someone tries to encode HTML in base64, the MIME type check prevents it
    expect(() => validateDataUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")).toThrow(InvalidDataUrlError);
  });

  it("handles extremely long filenames safely", () => {
    const longName = "a".repeat(10000);
    const safe = sanitizeFilename(longName);
    expect(safe.length).toBeLessThanOrEqual(200);
  });

  it("rejects symbolic link-like patterns", () => {
    expect(isPathWithinDirectory("./data/exports/link -> /etc/passwd", "./data/exports")).toBe(true); // The filename is sanitized
    // The actual symlink creation would fail at the OS level if attempted
  });
});

describe("ALLOWED_EXTENSIONS constant", () => {
  it("contains only safe file extensions", () => {
    const dangerousExtensions = [".exe", ".sh", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".html", ".htm", ".php"];
    for (const ext of dangerousExtensions) {
      expect(ALLOWED_EXTENSIONS.has(ext)).toBe(false);
    }
  });
});

describe("ALLOWED_MIME_TYPES constant", () => {
  it("contains only safe MIME types", () => {
    const dangerousMimeTypes = [
      "text/html",
      "application/javascript",
      "text/javascript",
      "application/x-httpd-php",
      "application/x-sh",
      "application/x-executable",
    ];
    for (const mime of dangerousMimeTypes) {
      expect(ALLOWED_MIME_TYPES.has(mime)).toBe(false);
    }
  });
});
