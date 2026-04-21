import { beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import Parser from "web-tree-sitter";
import {
	createTreeSitterCommand,
	type TreeSitterInstance,
	type TreeSitterLanguage,
} from "../src/commands/builtins/tree-sitter.js";
import { Shell } from "../src/shell.js";

// Integration tests against a real `web-tree-sitter` runtime plus a handful of
// pre-built grammar WASMs from `tree-sitter-wasms`. Verifies that the interface
// we adapted in `createTreeSitterCommand` lines up with the real API shape,
// and that error/position/hasError reporting flows through end-to-end.

const GRAMMAR_DIR = path.resolve("node_modules/tree-sitter-wasms/out");

function grammarPath(name: string): string {
	return path.join(GRAMMAR_DIR, `tree-sitter-${name}.wasm`);
}

let instance: TreeSitterInstance;

beforeAll(async () => {
	await Parser.init();
	const cache = new Map<string, TreeSitterLanguage>();

	instance = {
		createParser: () => new Parser() as unknown as ReturnType<TreeSitterInstance["createParser"]>,
		async getLanguage(name) {
			if (cache.has(name)) return cache.get(name) ?? null;
			try {
				// @ts-expect-error — Parser.Language exists at runtime on 0.22.x
				const lang = (await Parser.Language.load(grammarPath(name))) as TreeSitterLanguage;
				cache.set(name, lang);
				return lang;
			} catch {
				return null;
			}
		},
	};
});

function createShell(fs: Record<string, string>): Shell {
	return new Shell({
		fs,
		env: { HOME: "/home/u", USER: "test", PWD: "/home/u" },
		cwd: "/home/u",
		commands: [createTreeSitterCommand(instance)],
	});
}

describe("tree-sitter integration (real web-tree-sitter)", () => {
	describe("python", () => {
		test("valid file → exit 0, no diagnostics", async () => {
			const shell = createShell({
				"/home/u/ok.py": "def greet(name):\n    return f'hi {name}'\n",
			});
			const r = await shell.run("tree-sitter check ok.py");
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toBe("");
			expect(r.stderr).toBe("");
		});

		test("syntax error → exit 1 with file:line:col diagnostic", async () => {
			// Broken function signature — unmatched paren.
			const shell = createShell({
				"/home/u/bad.py": "def foo(:\n    pass\n",
			});
			const r = await shell.run("tree-sitter check bad.py");
			expect(r.exitCode).toBe(1);
			// Some diagnostic for bad.py with a line:col anchor in line 1.
			expect(r.stdout).toMatch(/\/home\/u\/bad\.py:1:\d+: (error|missing):/);
		});

		test("parse prints an S-expression rooted at 'module'", async () => {
			const shell = createShell({
				"/home/u/ok.py": "x = 1\n",
			});
			const r = await shell.run("tree-sitter parse ok.py");
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toContain("(module");
			expect(r.stdout).toContain("assignment");
		});
	});

	describe("javascript", () => {
		test("valid file → exit 0", async () => {
			const shell = createShell({
				"/home/u/ok.js": "const x = 1;\nconsole.log(x);\n",
			});
			const r = await shell.run("tree-sitter check ok.js");
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toBe("");
		});

		test("syntax error → exit 1", async () => {
			// Dangling brace / missing close.
			const shell = createShell({
				"/home/u/bad.js": "function f() {\n  return 1;\n",
			});
			const r = await shell.run("tree-sitter check bad.js");
			expect(r.exitCode).toBe(1);
			expect(r.stdout).toContain("/home/u/bad.js:");
		});
	});

	describe("json", () => {
		test("valid object → exit 0", async () => {
			const shell = createShell({
				"/home/u/ok.json": '{"a": 1, "b": [true, null]}\n',
			});
			const r = await shell.run("tree-sitter check ok.json");
			expect(r.exitCode).toBe(0);
		});

		test("trailing comma → exit 1", async () => {
			const shell = createShell({
				"/home/u/bad.json": '{"a": 1,}\n',
			});
			const r = await shell.run("tree-sitter check bad.json");
			expect(r.exitCode).toBe(1);
			expect(r.stdout).toContain("/home/u/bad.json:");
		});
	});

	describe("directory walk across languages", () => {
		test("reports issues from mixed-language tree and ignores unmapped files", async () => {
			const shell = createShell({
				"/home/u/src/a.py": "print('ok')\n",
				"/home/u/src/b.js": "const x = 1;\n",
				"/home/u/src/broken.py": "def foo(:\n",
				"/home/u/src/broken.json": '{"a": 1,}\n',
				"/home/u/src/README": "not code\n",
				"/home/u/src/notes.txt": "also not code\n",
			});
			const r = await shell.run("tree-sitter check --quiet src");
			expect(r.exitCode).toBe(1);
			expect(r.stdout).toContain("/home/u/src/broken.py");
			expect(r.stdout).toContain("/home/u/src/broken.json");
			expect(r.stdout).not.toContain("/home/u/src/a.py");
			expect(r.stdout).not.toContain("/home/u/src/b.js");
			expect(r.stdout).not.toContain("README");
			expect(r.stdout).not.toContain("notes.txt");
		});
	});

	describe("grammar fallback", () => {
		test("missing grammar produces a clear diagnostic, non-zero exit", async () => {
			// `.hs` → haskell — grammar not in tree-sitter-wasms.
			const shell = createShell({
				"/home/u/x.hs": 'main = putStrLn "hi"\n',
			});
			const r = await shell.run("tree-sitter check x.hs");
			expect(r.exitCode).toBe(1);
			expect(r.stderr).toContain("grammar unavailable for 'haskell'");
		});
	});
});
