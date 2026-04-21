import { beforeAll, describe, expect, test } from "bun:test";
import { getQuickJS, type QuickJSWASMModule } from "quickjs-emscripten";
import { createNodeCommand } from "../src/commands/builtins/node.js";
import { Shell } from "../src/shell.js";

let QuickJS: QuickJSWASMModule;

beforeAll(async () => {
	QuickJS = await getQuickJS();
});

function createShell(fs: Record<string, string> = {}, env: Record<string, string> = {}) {
	return new Shell({
		fs: {
			"/home/u/.keep": "",
			...fs,
		},
		env: { HOME: "/home/u", USER: "test", PWD: "/home/u", ...env },
		cwd: "/home/u",
		commands: [createNodeCommand(QuickJS)],
	});
}

describe("node -e / -p", () => {
	test("-e evaluates code", async () => {
		const shell = createShell();
		const r = await shell.run("node -e \"console.log('hi')\"");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("hi\n");
	});

	test("-p prints expression result", async () => {
		const shell = createShell();
		const r = await shell.run("node -p '1 + 2 * 3'");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("7\n");
	});

	test("console.log accepts multiple args", async () => {
		const shell = createShell();
		const r = await shell.run("node -e \"console.log('a', 1, true)\"");
		expect(r.stdout).toBe("a 1 true\n");
	});

	test("console.warn and console.error write to stderr", async () => {
		const shell = createShell();
		const r = await shell.run("node -e \"console.warn('w'); console.error('e')\"");
		expect(r.stdout).toBe("");
		expect(r.stderr).toContain("w\n");
		expect(r.stderr).toContain("e\n");
	});

	test("syntax error → non-zero exit with diagnostic", async () => {
		const shell = createShell();
		const r = await shell.run("node -e 'this is not js'");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("SyntaxError");
	});

	test("runtime throw → non-zero exit with diagnostic", async () => {
		const shell = createShell();
		const r = await shell.run("node -e \"throw new Error('boom')\"");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("Error: boom");
	});
});

describe("node script file", () => {
	test("runs a .js file from the VFS", async () => {
		const shell = createShell({
			"/home/u/hello.js": "console.log('from file')\n",
		});
		const r = await shell.run("node hello.js");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("from file\n");
	});

	test("receives script args via process.argv", async () => {
		const shell = createShell({
			"/home/u/args.js": "console.log(process.argv.slice(2).join('|'))\n",
		});
		const r = await shell.run("node args.js alpha beta gamma");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("alpha|beta|gamma\n");
	});

	test("missing script emits stderr and exits 1", async () => {
		const shell = createShell();
		const r = await shell.run("node nope.js");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("No such file or directory");
	});

	test("no args shows a hint", async () => {
		const shell = createShell();
		const r = await shell.run("node");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("missing script");
	});
});

describe("process.*", () => {
	test("process.cwd() reflects shell cwd", async () => {
		const shell = createShell();
		const r = await shell.run("node -p 'process.cwd()'");
		expect(r.stdout).toBe("/home/u\n");
	});

	test("process.env exposes shell env", async () => {
		const shell = createShell({}, { MY_VAR: "hello" });
		const r = await shell.run("node -p 'process.env.MY_VAR'");
		expect(r.stdout).toBe("hello\n");
	});

	test("process.exit propagates exit code", async () => {
		const shell = createShell();
		const r = await shell.run("node -e 'process.exit(42)'");
		expect(r.exitCode).toBe(42);
	});

	test("process.exit(0) after work exits cleanly", async () => {
		const shell = createShell();
		const r = await shell.run("node -e \"console.log('done'); process.exit(0)\"");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("done\n");
	});

	test("process.stdout.write / stderr.write", async () => {
		const shell = createShell();
		const r = await shell.run(
			"node -e \"process.stdout.write('out'); process.stderr.write('err')\"",
		);
		expect(r.stdout).toBe("out");
		expect(r.stderr).toBe("err");
	});

	test("process.stdin is piped stdin", async () => {
		const shell = createShell({
			"/home/u/input.txt": "piped content",
		});
		const r = await shell.run(
			'cat input.txt | node -e "process.stdout.write(process.stdin.read())"',
		);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("piped content");
	});
});

describe("require('fs')", () => {
	test("readFileSync", async () => {
		const shell = createShell({
			"/home/u/data.txt": "contents\n",
		});
		const r = await shell.run(
			"node -e \"const fs = require('fs'); process.stdout.write(fs.readFileSync('data.txt'))\"",
		);
		expect(r.stdout).toBe("contents\n");
	});

	test("writeFileSync + readback", async () => {
		const shell = createShell();
		const r = await shell.run(
			"node -e \"const fs = require('fs'); fs.writeFileSync('out.txt', 'hi'); process.stdout.write(fs.readFileSync('out.txt'))\"",
		);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("hi");
	});

	test("existsSync + readdirSync", async () => {
		const shell = createShell({
			"/home/u/dir/a.txt": "",
			"/home/u/dir/b.txt": "",
		});
		const r = await shell.run(
			"node -e \"const fs = require('fs'); console.log(fs.existsSync('dir')); console.log(fs.readdirSync('dir').sort().join(','))\"",
		);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("true\na.txt,b.txt\n");
	});

	test("readFileSync on missing path throws ENOENT", async () => {
		const shell = createShell();
		const r = await shell.run(
			"node -e \"try { require('fs').readFileSync('nope') } catch (e) { console.log('caught:', e.message) }\"",
		);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("caught:");
		expect(r.stdout).toContain("ENOENT");
	});

	test("node: prefix works", async () => {
		const shell = createShell({ "/home/u/x.txt": "ok" });
		const r = await shell.run(
			"node -e \"const fs = require('node:fs'); process.stdout.write(fs.readFileSync('x.txt'))\"",
		);
		expect(r.stdout).toBe("ok");
	});
});

describe("require('path')", () => {
	test("join / basename / dirname / extname", async () => {
		const shell = createShell();
		const r = await shell.run(
			"node -e \"const p = require('path'); console.log(p.join('a','b','c.txt')); console.log(p.basename('/x/y/z.txt')); console.log(p.dirname('/x/y/z.txt')); console.log(p.extname('/x/y/z.txt'))\"",
		);
		expect(r.stdout).toBe("a/b/c.txt\nz.txt\n/x/y\n.txt\n");
	});

	test("resolve uses cwd", async () => {
		const shell = createShell();
		const r = await shell.run("node -p \"require('path').resolve('a','b')\"");
		expect(r.stdout).toBe("/home/u/a/b\n");
	});

	test("isAbsolute", async () => {
		const shell = createShell();
		const r = await shell.run(
			"node -e \"const p = require('path'); console.log(p.isAbsolute('/a')); console.log(p.isAbsolute('a'))\"",
		);
		expect(r.stdout).toBe("true\nfalse\n");
	});
});

describe("sandboxing", () => {
	test("no access to host fs via bare globals", async () => {
		const shell = createShell();
		const r = await shell.run(
			"node -e \"console.log(typeof require('fs').readFile, typeof require('child_process'))\"",
		);
		// readFile (async) not implemented; child_process module not registered.
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("Cannot find module 'child_process'");
	});

	test("unknown module throws", async () => {
		const shell = createShell();
		const r = await shell.run(
			"node -e \"try { require('net') } catch (e) { console.log(e.message) }\"",
		);
		expect(r.stdout).toContain("Cannot find module 'net'");
	});

	test("timeout halts runaway loops", async () => {
		const shell = new Shell({
			fs: { "/home/u/.keep": "" },
			env: { HOME: "/home/u", USER: "test", PWD: "/home/u" },
			cwd: "/home/u",
			commands: [createNodeCommand(QuickJS, { timeoutMs: 200 })],
		});
		const r = await shell.run("node -e 'while (true) {}'");
		expect(r.exitCode).toBe(1);
		expect(r.stderr.length).toBeGreaterThan(0);
	}, 10_000);
});

describe("promises / microtasks", () => {
	test("Promise.resolve + then runs", async () => {
		const shell = createShell();
		const r = await shell.run("node -e \"Promise.resolve(42).then(v => console.log('got', v))\"");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("got 42\n");
	});

	test("async IIFE runs its body", async () => {
		const shell = createShell();
		const r = await shell.run(
			"node -e \"(async () => { console.log('a'); await Promise.resolve(); console.log('b') })()\"",
		);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("a\nb\n");
	});
});
