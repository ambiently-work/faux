import { describe, expect, test } from "bun:test";
import {
	createTreeSitterCommand,
	type TreeSitterInstance,
	type TreeSitterLanguage,
	type TreeSitterNode,
	type TreeSitterParser,
	type TreeSitterTree,
} from "../src/commands/builtins/tree-sitter.js";
import { Shell } from "../src/shell.js";

// ─── fake tree-sitter ──────────────────────────────────────────────
// A deterministic fake that parses source using simple rules so we can
// test the command surface without loading real grammars.

type FakeLang = { name: string };

function leaf(
	type: string,
	start: [number, number],
	end: [number, number],
	opts: { isError?: boolean; isMissing?: boolean } = {},
): TreeSitterNode {
	return {
		type,
		isError: !!opts.isError,
		isMissing: !!opts.isMissing,
		hasError: !!(opts.isError || opts.isMissing),
		startPosition: { row: start[0], column: start[1] },
		endPosition: { row: end[0], column: end[1] },
		startIndex: 0,
		endIndex: 0,
		children: [],
	};
}

function branch(
	type: string,
	start: [number, number],
	end: [number, number],
	children: TreeSitterNode[],
): TreeSitterNode {
	return {
		type,
		isError: false,
		isMissing: false,
		hasError: children.some((c) => c.hasError || c.isError || c.isMissing),
		startPosition: { row: start[0], column: start[1] },
		endPosition: { row: end[0], column: end[1] },
		startIndex: 0,
		endIndex: 0,
		children,
	};
}

class FakeParser implements TreeSitterParser {
	private lang: FakeLang | null = null;

	setLanguage(lang: TreeSitterLanguage): void {
		this.lang = lang as FakeLang;
	}

	parse(source: string): TreeSitterTree {
		// Rules:
		//   - line containing "!ERROR" → ERROR leaf at that line
		//   - line containing "!MISSING" → MISSING leaf at that line
		//   - otherwise → a "statement" leaf per line
		const lines = source.split("\n");
		const stmts: TreeSitterNode[] = [];
		lines.forEach((line, row) => {
			if (line.includes("!ERROR")) {
				stmts.push(leaf("ERROR", [row, 0], [row, line.length], { isError: true }));
			} else if (line.includes("!MISSING")) {
				stmts.push(
					leaf(";", [row, line.length], [row, line.length], {
						isMissing: true,
					}),
				);
			} else if (line.length > 0) {
				stmts.push(leaf("statement", [row, 0], [row, line.length]));
			}
		});

		const lastRow = lines.length - 1;
		const lastCol = lines[lastRow]?.length ?? 0;
		const root = branch(this.lang?.name ?? "program", [0, 0], [lastRow, lastCol], stmts);
		return { rootNode: root };
	}
}

function fakeInstance(available: Record<string, boolean> = {}): TreeSitterInstance {
	return {
		createParser: () => new FakeParser(),
		getLanguage(name) {
			if (available[name] === false) return null;
			return { name };
		},
	};
}

function createShell(fs: Record<string, string>, extra: TreeSitterInstance = fakeInstance()) {
	return new Shell({
		fs,
		env: { HOME: "/home/user", USER: "test", PWD: "/home/user" },
		cwd: "/home/user",
		commands: [createTreeSitterCommand(extra)],
	});
}

// ─── tests ─────────────────────────────────────────────────────────

describe("tree-sitter check", () => {
	test("clean file exits 0 with no output", async () => {
		const shell = createShell({
			"/home/user/a.py": "import os\nprint('hi')\n",
		});
		const r = await shell.run("tree-sitter check a.py");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("");
		expect(r.stderr).toBe("");
	});

	test("reports ERROR nodes with file:line:col: prefix", async () => {
		const shell = createShell({
			"/home/user/a.py": "ok\n!ERROR bad\nok\n",
		});
		const r = await shell.run("tree-sitter check a.py");
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("/home/user/a.py:2:1: error: unexpected ERROR");
	});

	test("reports MISSING nodes", async () => {
		const shell = createShell({
			"/home/user/a.py": "ok\n!MISSING\n",
		});
		const r = await shell.run("tree-sitter check a.py");
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("missing:");
		expect(r.stdout).toContain("missing ;");
	});

	test("--quiet mode prints only filenames with errors", async () => {
		const shell = createShell({
			"/home/user/good.py": "ok\n",
			"/home/user/bad.py": "!ERROR\n",
		});
		const r = await shell.run("tree-sitter check --quiet good.py bad.py");
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toBe("/home/user/bad.py\n");
	});

	test("walks directories and filters by extension", async () => {
		const shell = createShell({
			"/home/user/src/a.py": "!ERROR\n",
			"/home/user/src/b.txt": "!ERROR\n", // no mapping → skipped
			"/home/user/src/nested/c.py": "ok\n",
		});
		const r = await shell.run("tree-sitter check src");
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("/home/user/src/a.py");
		expect(r.stdout).not.toContain("b.txt");
		expect(r.stdout).not.toContain("c.py");
	});

	test("skips files with unmapped extensions", async () => {
		const shell = createShell({
			"/home/user/a.unknown": "!ERROR\n",
		});
		const r = await shell.run("tree-sitter check a.unknown");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("");
	});

	test("--lang overrides extension detection", async () => {
		const shell = createShell({
			"/home/user/a.unknown": "!ERROR\n",
		});
		const r = await shell.run("tree-sitter check --lang python a.unknown");
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("error: unexpected ERROR");
	});

	test("reports when grammar is unavailable", async () => {
		const shell = createShell({ "/home/user/a.py": "ok\n" }, fakeInstance({ python: false }));
		const r = await shell.run("tree-sitter check a.py");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("grammar unavailable for 'python'");
	});

	test("missing file emits stderr but keeps going", async () => {
		const shell = createShell({
			"/home/user/good.py": "ok\n",
		});
		const r = await shell.run("tree-sitter check nope.py good.py");
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toContain("nope.py: No such file or directory");
	});
});

describe("tree-sitter parse", () => {
	test("prints S-expression and returns 0 for clean files", async () => {
		const shell = createShell({
			"/home/user/a.py": "x\ny\n",
		});
		const r = await shell.run("tree-sitter parse a.py");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("(python");
		expect(r.stdout).toContain("(statement");
	});

	test("marks ERROR nodes in the tree and returns 1", async () => {
		const shell = createShell({
			"/home/user/a.py": "!ERROR\n",
		});
		const r = await shell.run("tree-sitter parse a.py");
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("ERROR");
	});

	test("missing file emits stderr and returns 1", async () => {
		const shell = createShell({});
		const r = await shell.run("tree-sitter parse nope.py");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("No such file or directory");
	});

	test("unknown extension requires --lang", async () => {
		const shell = createShell({
			"/home/user/a.unknown": "ok\n",
		});
		const r = await shell.run("tree-sitter parse a.unknown");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("unknown language");
	});
});

describe("tree-sitter languages", () => {
	test("lists mappings", async () => {
		const shell = createShell({});
		const r = await shell.run("tree-sitter languages");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain(".py");
		expect(r.stdout).toContain("python");
		expect(r.stdout).toContain(".rs");
		expect(r.stdout).toContain("rust");
	});
});

describe("tree-sitter options", () => {
	test("extensions override adds a new mapping", async () => {
		const shell = new Shell({
			fs: { "/home/user/a.custom": "!ERROR\n" },
			env: { HOME: "/home/user", USER: "test", PWD: "/home/user" },
			cwd: "/home/user",
			commands: [
				createTreeSitterCommand(fakeInstance(), {
					extensions: { ".custom": "python" },
				}),
			],
		});
		const r = await shell.run("tree-sitter check a.custom");
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("error: unexpected ERROR");
	});

	test("extensions override with null removes a default mapping", async () => {
		const shell = new Shell({
			fs: { "/home/user/a.py": "!ERROR\n" },
			env: { HOME: "/home/user", USER: "test", PWD: "/home/user" },
			cwd: "/home/user",
			commands: [
				createTreeSitterCommand(fakeInstance(), {
					extensions: { ".py": null },
				}),
			],
		});
		const r = await shell.run("tree-sitter check a.py");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("");
	});
});
