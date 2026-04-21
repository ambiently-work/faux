import { describe, expect, test } from "bun:test";
import {
	collapseSpaces,
	compressBlankLines,
	llmOptimized,
	normalizeLineEndings,
	stripAnsi,
	suppressEmptyStderr,
	tabsToSpaces,
	tokenOptimized,
	trimOutput,
	trimTrailingWhitespace,
	truncateChars,
	truncateLines,
} from "../src/transforms.js";
import type { ShellResult } from "../src/types.js";

function res(stdout: string, stderr = "", exitCode = 0): ShellResult {
	return { stdout, stderr, exitCode };
}

describe("stripAnsi", () => {
	test("removes SGR color codes", () => {
		const r = stripAnsi(res("\x1b[31mred\x1b[0m hello"), "cmd");
		expect(r.stdout).toBe("red hello");
	});

	test("removes cursor movement codes", () => {
		const r = stripAnsi(res("foo\x1b[2Jbar\x1b[10;5H"), "cmd");
		expect(r.stdout).toBe("foobar");
	});

	test("strips from stderr too", () => {
		const r = stripAnsi(res("ok", "\x1b[31merror\x1b[0m"), "cmd");
		expect(r.stderr).toBe("error");
	});

	test("leaves plain text untouched", () => {
		const r = stripAnsi(res("plain text"), "cmd");
		expect(r.stdout).toBe("plain text");
	});

	test("preserves exit code", () => {
		const r = stripAnsi(res("\x1b[31mx\x1b[0m", "", 42), "cmd");
		expect(r.exitCode).toBe(42);
	});
});

describe("compressBlankLines", () => {
	test("collapses 3+ newlines into 2", () => {
		const r = compressBlankLines(res("a\n\n\n\nb"), "cmd");
		expect(r.stdout).toBe("a\n\nb");
	});

	test("leaves single blank line alone", () => {
		const r = compressBlankLines(res("a\n\nb"), "cmd");
		expect(r.stdout).toBe("a\n\nb");
	});

	test("leaves no blank lines alone", () => {
		const r = compressBlankLines(res("a\nb"), "cmd");
		expect(r.stdout).toBe("a\nb");
	});
});

describe("trimTrailingWhitespace", () => {
	test("strips trailing spaces from each line", () => {
		const r = trimTrailingWhitespace(res("foo   \nbar\t\nbaz"), "cmd");
		expect(r.stdout).toBe("foo\nbar\nbaz");
	});

	test("preserves leading whitespace", () => {
		const r = trimTrailingWhitespace(res("  foo  \n  bar  "), "cmd");
		expect(r.stdout).toBe("  foo\n  bar");
	});
});

describe("trimOutput", () => {
	test("trims surrounding whitespace and ensures trailing newline", () => {
		const r = trimOutput(res("\n\n  hello  \n\n"), "cmd");
		expect(r.stdout).toBe("hello\n");
	});

	test("returns empty string when only whitespace", () => {
		const r = trimOutput(res("   \n\n  "), "cmd");
		expect(r.stdout).toBe("");
	});
});

describe("truncateLines", () => {
	test("truncates and appends marker when over limit", () => {
		const t = truncateLines(2);
		const r = t(res("a\nb\nc\nd"), "cmd");
		expect(r.stdout).toBe("a\nb\n... (truncated)\n");
	});

	test("leaves output alone when under limit", () => {
		const t = truncateLines(10);
		const r = t(res("a\nb\nc"), "cmd");
		expect(r.stdout).toBe("a\nb\nc");
	});

	test("custom marker", () => {
		const t = truncateLines(1, "[snip]");
		const r = t(res("a\nb\nc"), "cmd");
		expect(r.stdout).toBe("a\n[snip]\n");
	});
});

describe("truncateChars", () => {
	test("truncates and appends marker", () => {
		const t = truncateChars(3);
		const r = t(res("abcdefg"), "cmd");
		expect(r.stdout).toBe("abc...\n");
	});

	test("leaves output alone when under limit", () => {
		const t = truncateChars(100);
		const r = t(res("hi"), "cmd");
		expect(r.stdout).toBe("hi");
	});
});

describe("tabsToSpaces", () => {
	test("default 4-space width", () => {
		const t = tabsToSpaces();
		const r = t(res("a\tb"), "cmd");
		expect(r.stdout).toBe("a    b");
	});

	test("custom width", () => {
		const t = tabsToSpaces(2);
		const r = t(res("a\tb\tc"), "cmd");
		expect(r.stdout).toBe("a  b  c");
	});
});

describe("collapseSpaces", () => {
	test("collapses inline runs of spaces", () => {
		const r = collapseSpaces(res("foo    bar   baz"), "cmd");
		expect(r.stdout).toBe("foo bar baz");
	});

	test("preserves leading whitespace (indent)", () => {
		const r = collapseSpaces(res("    foo    bar"), "cmd");
		expect(r.stdout).toBe("    foo bar");
	});

	test("works per-line", () => {
		const r = collapseSpaces(res("a   b\nc   d"), "cmd");
		expect(r.stdout).toBe("a b\nc d");
	});
});

describe("suppressEmptyStderr", () => {
	test("clears stderr on success", () => {
		const r = suppressEmptyStderr(res("ok", "noise", 0), "cmd");
		expect(r.stderr).toBe("");
	});

	test("preserves stderr on failure", () => {
		const r = suppressEmptyStderr(res("", "real error", 1), "cmd");
		expect(r.stderr).toBe("real error");
	});
});

describe("normalizeLineEndings", () => {
	test("converts \\r\\n to \\n", () => {
		const r = normalizeLineEndings(res("a\r\nb\r\nc"), "cmd");
		expect(r.stdout).toBe("a\nb\nc");
	});

	test("converts lone \\r to \\n", () => {
		const r = normalizeLineEndings(res("a\rb\rc"), "cmd");
		expect(r.stdout).toBe("a\nb\nc");
	});
});

describe("tokenOptimized", () => {
	test("strips ANSI, normalizes endings, compresses blanks, trims trailing ws", () => {
		const input = "\x1b[31mfoo  \x1b[0m\r\n\r\n\r\n\r\nbar\t\r\n";
		const r = tokenOptimized(res(input), "cmd");
		expect(r.stdout).toBe("foo\n\nbar\n");
	});

	test("clears stderr on success", () => {
		const r = tokenOptimized(res("hi", "warning", 0), "cmd");
		expect(r.stderr).toBe("");
	});
});

describe("llmOptimized", () => {
	test("applies tokenOptimized then truncates lines", () => {
		const t = llmOptimized(2, 1000);
		const lines = Array.from({ length: 5 }, (_, i) => `line${i + 1}`).join("\n");
		const r = t(res(lines), "cmd");
		expect(r.stdout).toContain("line1");
		expect(r.stdout).toContain("line2");
		expect(r.stdout).toContain("(truncated)");
		expect(r.stdout).not.toContain("line5");
	});

	test("char limit applies after line limit", () => {
		const t = llmOptimized(100, 5);
		const r = t(res("abcdefghij"), "cmd");
		expect(r.stdout.length).toBeLessThan(20);
		expect(r.stdout).toContain("...");
	});
});
