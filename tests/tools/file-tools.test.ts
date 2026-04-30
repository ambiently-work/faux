import { describe, expect, test } from "bun:test";
import { VirtualFileSystem } from "@ambiently-work/mirage";
import {
	createDefaultTools,
	EditTool,
	GlobTool,
	GrepTool,
	LsTool,
	ReadTool,
	ShellSession,
	type ToolRegistry,
	WriteTool,
} from "../../src/tools/index.js";

function mkFs(files: Record<string, string> = {}): VirtualFileSystem {
	return new VirtualFileSystem({ files });
}

describe("ReadTool", () => {
	test("returns content with 1-indexed line numbers", async () => {
		const fs = mkFs({ "/a.txt": "hello\nworld\n" });
		const tool = new ReadTool({ fs });
		const result = await tool.run({ path: "/a.txt" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.content).toBe("1\thello\n2\tworld\n3\t");
			expect(result.value.totalLines).toBe(2);
			expect(result.value.truncated).toBe(false);
		}
	});

	test("supports offset/limit", async () => {
		const fs = mkFs({ "/a.txt": "a\nb\nc\nd\ne\n" });
		const tool = new ReadTool({ fs });
		const result = await tool.run({ path: "/a.txt", offset: 1, limit: 2 });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.content).toBe("2\tb\n3\tc");
			expect(result.value.truncated).toBe(true);
		}
	});

	test("fails for missing paths", async () => {
		const tool = new ReadTool({ fs: mkFs() });
		const result = await tool.run({ path: "/missing" });
		expect(result.ok).toBe(false);
	});

	test("fails for directories", async () => {
		const fs = mkFs();
		fs.mkdir("/dir");
		const tool = new ReadTool({ fs });
		const result = await tool.run({ path: "/dir" });
		expect(result.ok).toBe(false);
	});

	test("truncates overly long lines", async () => {
		const fs = mkFs({ "/a.txt": "x".repeat(50) });
		const tool = new ReadTool({ fs, maxLineLength: 10 });
		const result = await tool.run({ path: "/a.txt" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.content.endsWith("…")).toBe(true);
	});
});

describe("WriteTool", () => {
	test("creates a new file and reports bytesWritten", async () => {
		const fs = mkFs();
		const tool = new WriteTool({ fs });
		const result = await tool.run({ path: "/a/b/c.txt", content: "hi" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.created).toBe(true);
			expect(result.value.bytesWritten).toBe(2);
		}
		expect(fs.readFile("/a/b/c.txt")).toBe("hi");
	});

	test("overwrites existing files", async () => {
		const fs = mkFs({ "/a.txt": "old" });
		const tool = new WriteTool({ fs });
		const result = await tool.run({ path: "/a.txt", content: "new" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.created).toBe(false);
		expect(fs.readFile("/a.txt")).toBe("new");
	});

	test("refuses to overwrite a directory", async () => {
		const fs = mkFs();
		fs.mkdir("/dir");
		const tool = new WriteTool({ fs });
		const result = await tool.run({ path: "/dir", content: "x" });
		expect(result.ok).toBe(false);
	});
});

describe("EditTool", () => {
	test("replaces a single occurrence", async () => {
		const fs = mkFs({ "/a.txt": "hello world" });
		const tool = new EditTool({ fs });
		const result = await tool.run({
			path: "/a.txt",
			old_string: "world",
			new_string: "there",
		});
		expect(result.ok).toBe(true);
		expect(fs.readFile("/a.txt")).toBe("hello there");
	});

	test("rejects non-unique matches without replace_all", async () => {
		const fs = mkFs({ "/a.txt": "x x x" });
		const tool = new EditTool({ fs });
		const result = await tool.run({
			path: "/a.txt",
			old_string: "x",
			new_string: "y",
		});
		expect(result.ok).toBe(false);
	});

	test("replace_all substitutes every occurrence", async () => {
		const fs = mkFs({ "/a.txt": "x x x" });
		const tool = new EditTool({ fs });
		const result = await tool.run({
			path: "/a.txt",
			old_string: "x",
			new_string: "y",
			replace_all: true,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.replacements).toBe(3);
		expect(fs.readFile("/a.txt")).toBe("y y y");
	});

	test("rejects identical old/new strings", async () => {
		const fs = mkFs({ "/a.txt": "x" });
		const tool = new EditTool({ fs });
		const result = await tool.run({
			path: "/a.txt",
			old_string: "x",
			new_string: "x",
		});
		expect(result.ok).toBe(false);
	});

	test("fails when old_string is absent", async () => {
		const fs = mkFs({ "/a.txt": "hello" });
		const tool = new EditTool({ fs });
		const result = await tool.run({
			path: "/a.txt",
			old_string: "missing",
			new_string: "x",
		});
		expect(result.ok).toBe(false);
	});
});

describe("GlobTool", () => {
	test("matches files by pattern", async () => {
		const fs = mkFs({
			"/src/a.ts": "1",
			"/src/b.ts": "2",
			"/src/c.js": "3",
		});
		const tool = new GlobTool({ fs });
		const result = await tool.run({ pattern: "/src/*.ts" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.matches.sort()).toEqual(["/src/a.ts", "/src/b.ts"]);
	});

	test("respects limit", async () => {
		const fs = mkFs({ "/a.txt": "a", "/b.txt": "b", "/c.txt": "c" });
		const tool = new GlobTool({ fs });
		const result = await tool.run({ pattern: "/*.txt", limit: 2 });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.matches.length).toBe(2);
	});
});

describe("GrepTool", () => {
	test("returns files_with_matches by default", async () => {
		const fs = mkFs({ "/a.txt": "hello", "/b.txt": "world" });
		const tool = new GrepTool({ fs });
		const result = await tool.run({ pattern: "hello" });
		expect(result.ok).toBe(true);
		if (result.ok && result.value.output_mode === "files_with_matches") {
			expect(result.value.matches).toEqual(["/a.txt"]);
		}
	});

	test("content mode returns lines with line numbers", async () => {
		const fs = mkFs({ "/a.txt": "one\nhello\nthree\n" });
		const tool = new GrepTool({ fs });
		const result = await tool.run({ pattern: "hello", output_mode: "content" });
		expect(result.ok).toBe(true);
		if (result.ok && result.value.output_mode === "content") {
			expect(result.value.matches).toEqual([{ path: "/a.txt", line: 2, text: "hello" }]);
		}
	});

	test("count mode totals matches per file", async () => {
		const fs = mkFs({ "/a.txt": "hi\nhi\n", "/b.txt": "hi\n" });
		const tool = new GrepTool({ fs });
		const result = await tool.run({ pattern: "hi", output_mode: "count" });
		expect(result.ok).toBe(true);
		if (result.ok && result.value.output_mode === "count") {
			expect(result.value.total).toBe(3);
		}
	});

	test("case_insensitive flag works", async () => {
		const fs = mkFs({ "/a.txt": "HELLO" });
		const tool = new GrepTool({ fs });
		const result = await tool.run({ pattern: "hello", case_insensitive: true });
		expect(result.ok).toBe(true);
		if (result.ok && result.value.output_mode === "files_with_matches") {
			expect(result.value.matches).toEqual(["/a.txt"]);
		}
	});

	test("invalid regex returns invalid_input", async () => {
		const fs = mkFs({ "/a.txt": "hi" });
		const tool = new GrepTool({ fs });
		const result = await tool.run({ pattern: "[" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("invalid_input");
	});
});

describe("LsTool", () => {
	test("lists directory entries", async () => {
		const fs = mkFs({ "/a/x.txt": "1", "/a/y.txt": "2" });
		const tool = new LsTool({ fs });
		const result = await tool.run({ path: "/a" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.entries.map((e) => e.name)).toEqual(["x.txt", "y.txt"]);
			expect(result.value.entries[0]?.kind).toBe("file");
		}
	});

	test("rejects non-directories", async () => {
		const fs = mkFs({ "/a.txt": "x" });
		const tool = new LsTool({ fs });
		const result = await tool.run({ path: "/a.txt" });
		expect(result.ok).toBe(false);
	});
});

describe("createDefaultTools", () => {
	test("wires up all tools against a shared fs", async () => {
		const fs = mkFs({ "/hello.txt": "hi" });
		const session = new ShellSession();
		const registry: ToolRegistry = createDefaultTools({ fs, session });
		const ids = registry
			.list()
			.map((t) => t.id)
			.sort();
		expect(ids).toEqual(["edit", "glob", "grep", "ls", "read", "shell", "write"]);

		const read = await registry.run({
			tool: "read",
			inputs: { path: "/hello.txt" },
		});
		expect(read.ok).toBe(true);
	});
});
