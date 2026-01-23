/**
 * Regex Utilities Tests
 */

import { describe, test, expect } from "bun:test";
import { escapeRegex, createPrefixPattern, createExactPattern, escapeLikeWildcards } from "./regex";

describe("escapeRegex", () => {
  test("returns empty string for empty input", () => {
    expect(escapeRegex("")).toBe("");
  });

  test("returns alphanumeric strings unchanged", () => {
    expect(escapeRegex("abc123")).toBe("abc123");
    expect(escapeRegex("TestString")).toBe("TestString");
  });

  test("escapes dots", () => {
    expect(escapeRegex("file.txt")).toBe("file\\.txt");
    expect(escapeRegex("a.b.c")).toBe("a\\.b\\.c");
  });

  test("escapes asterisks", () => {
    expect(escapeRegex("test*")).toBe("test\\*");
    expect(escapeRegex("*wildcard*")).toBe("\\*wildcard\\*");
  });

  test("escapes plus signs", () => {
    expect(escapeRegex("a+b")).toBe("a\\+b");
    expect(escapeRegex("test+")).toBe("test\\+");
  });

  test("escapes question marks", () => {
    expect(escapeRegex("maybe?")).toBe("maybe\\?");
    expect(escapeRegex("a?b?c")).toBe("a\\?b\\?c");
  });

  test("escapes caret and dollar", () => {
    expect(escapeRegex("^start")).toBe("\\^start");
    expect(escapeRegex("end$")).toBe("end\\$");
    expect(escapeRegex("^both$")).toBe("\\^both\\$");
  });

  test("escapes curly braces", () => {
    expect(escapeRegex("{n}")).toBe("\\{n\\}");
    expect(escapeRegex("a{1,3}")).toBe("a\\{1,3\\}");
  });

  test("escapes parentheses", () => {
    expect(escapeRegex("(group)")).toBe("\\(group\\)");
    expect(escapeRegex("a(b)c")).toBe("a\\(b\\)c");
  });

  test("escapes pipes", () => {
    expect(escapeRegex("a|b")).toBe("a\\|b");
    expect(escapeRegex("this|that|other")).toBe("this\\|that\\|other");
  });

  test("escapes square brackets", () => {
    expect(escapeRegex("[abc]")).toBe("\\[abc\\]");
    expect(escapeRegex("arr[0]")).toBe("arr\\[0\\]");
  });

  test("escapes backslashes", () => {
    expect(escapeRegex("a\\b")).toBe("a\\\\b");
    expect(escapeRegex("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  test("handles multiple special characters", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe(
      "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\"
    );
  });

  test("handles mixed content", () => {
    expect(escapeRegex("test.value[0]+1")).toBe("test\\.value\\[0\\]\\+1");
    expect(escapeRegex("$100.00")).toBe("\\$100\\.00");
    expect(escapeRegex("file (copy).txt")).toBe("file \\(copy\\)\\.txt");
  });

  test("handles unicode characters", () => {
    expect(escapeRegex("test\u00e9")).toBe("test\u00e9");
    expect(escapeRegex("\u4e2d\u6587")).toBe("\u4e2d\u6587");
  });

  test("handles nanoid-style IDs unchanged", () => {
    expect(escapeRegex("V1StGXR8_Z5j")).toBe("V1StGXR8_Z5j");
    expect(escapeRegex("abc-123_DEF")).toBe("abc-123_DEF");
  });

  test("escaped string works correctly in RegExp", () => {
    const dangerousInput = "test.*value+more";
    const escaped = escapeRegex(dangerousInput);
    const pattern = new RegExp(`^${escaped}$`);

    // Should match the literal string
    expect(pattern.test("test.*value+more")).toBe(true);

    // Should NOT match patterns that would match if unescaped
    expect(pattern.test("testXXXvalueeeemore")).toBe(false);
    expect(pattern.test("test.value+more")).toBe(false);
  });
});

describe("createPrefixPattern", () => {
  test("matches literal prefix", () => {
    const pattern = createPrefixPattern("svg:abc123:");
    expect(pattern.test("svg:abc123:data")).toBe(true);
    expect(pattern.test("svg:abc123:")).toBe(true);
    expect(pattern.test("svg:xyz:data")).toBe(false);
  });

  test("escapes special characters in prefix", () => {
    const pattern = createPrefixPattern("test.value:");
    expect(pattern.test("test.value:data")).toBe(true);
    expect(pattern.test("testXvalue:data")).toBe(false);
  });

  test("handles flags", () => {
    const pattern = createPrefixPattern("PREFIX:", "i");
    expect(pattern.test("prefix:data")).toBe(true);
    expect(pattern.test("PREFIX:data")).toBe(true);
  });
});

describe("createExactPattern", () => {
  test("matches exact string only", () => {
    const pattern = createExactPattern("test");
    expect(pattern.test("test")).toBe(true);
    expect(pattern.test("testing")).toBe(false);
    expect(pattern.test("atest")).toBe(false);
  });

  test("escapes special characters", () => {
    const pattern = createExactPattern("file.txt");
    expect(pattern.test("file.txt")).toBe(true);
    expect(pattern.test("fileXtxt")).toBe(false);
  });

  test("handles flags", () => {
    const pattern = createExactPattern("Test", "i");
    expect(pattern.test("test")).toBe(true);
    expect(pattern.test("TEST")).toBe(true);
    expect(pattern.test("Test")).toBe(true);
  });
});

describe("escapeLikeWildcards", () => {
  test("returns empty string for empty input", () => {
    expect(escapeLikeWildcards("")).toBe("");
  });

  test("returns alphanumeric strings unchanged", () => {
    expect(escapeLikeWildcards("abc123")).toBe("abc123");
    expect(escapeLikeWildcards("TestString")).toBe("TestString");
  });

  test("escapes percent signs", () => {
    expect(escapeLikeWildcards("100%")).toBe("100\\%");
    expect(escapeLikeWildcards("%value%")).toBe("\\%value\\%");
    expect(escapeLikeWildcards("a%b%c")).toBe("a\\%b\\%c");
  });

  test("escapes underscores", () => {
    expect(escapeLikeWildcards("test_value")).toBe("test\\_value");
    expect(escapeLikeWildcards("_prefix")).toBe("\\_prefix");
    expect(escapeLikeWildcards("a_b_c")).toBe("a\\_b\\_c");
  });

  test("escapes backslashes", () => {
    expect(escapeLikeWildcards("path\\file")).toBe("path\\\\file");
    expect(escapeLikeWildcards("\\")).toBe("\\\\");
  });

  test("handles mixed wildcards", () => {
    expect(escapeLikeWildcards("%_mix_%")).toBe("\\%\\_mix\\_\\%");
    expect(escapeLikeWildcards("100%_done")).toBe("100\\%\\_done");
  });

  test("handles backslash followed by wildcard", () => {
    expect(escapeLikeWildcards("\\%")).toBe("\\\\\\%");
    expect(escapeLikeWildcards("\\_")).toBe("\\\\\\_");
  });

  test("preserves other special characters", () => {
    expect(escapeLikeWildcards("test.value")).toBe("test.value");
    expect(escapeLikeWildcards("a*b")).toBe("a*b");
    expect(escapeLikeWildcards("$100")).toBe("$100");
  });

  test("handles unicode characters", () => {
    expect(escapeLikeWildcards("test\u00e9%")).toBe("test\u00e9\\%");
    expect(escapeLikeWildcards("\u4e2d_\u6587")).toBe("\u4e2d\\_\u6587");
  });
});
