import { describe, expect, test } from "bun:test";
import { HookRegistry } from "../src/hooks.js";
import { Shell } from "../src/shell.js";
import { stripAnsi, trimOutput } from "../src/transforms.js";

describe("HookRegistry (direct)", () => {
	test("runBefore returns command unchanged with no hooks", async () => {
		const reg = new HookRegistry();
		const r = await reg.runBefore("echo hi", "/");
		expect(r.blocked).toBe(false);
		expect(r.command).toBe("echo hi");
	});

	test("before hook can rewrite command", async () => {
		const reg = new HookRegistry();
		reg.before(() => "echo rewritten");
		const r = await reg.runBefore("echo original", "/");
		expect(r.command).toBe("echo rewritten");
	});

	test("before hook can block by returning false", async () => {
		const reg = new HookRegistry();
		reg.before(() => false);
		const r = await reg.runBefore("rm -rf /", "/");
		expect(r.blocked).toBe(true);
	});

	test("before hooks run in order; second sees first's rewrite", async () => {
		const reg = new HookRegistry();
		reg.before((cmd) => `${cmd} | one`);
		reg.before((cmd) => `${cmd} | two`);
		const r = await reg.runBefore("base", "/");
		expect(r.command).toBe("base | one | two");
	});

	test("before hook can be async", async () => {
		const reg = new HookRegistry();
		reg.before(async (cmd) => `async-${cmd}`);
		const r = await reg.runBefore("x", "/");
		expect(r.command).toBe("async-x");
	});

	test("undefined return leaves command unchanged", async () => {
		const reg = new HookRegistry();
		reg.before(() => undefined);
		const r = await reg.runBefore("untouched", "/");
		expect(r.command).toBe("untouched");
	});

	test("before hook unsubscribe removes it", async () => {
		const reg = new HookRegistry();
		const unsub = reg.before(() => "rewritten");
		unsub();
		const r = await reg.runBefore("orig", "/");
		expect(r.command).toBe("orig");
	});

	test("after hooks run in order", async () => {
		const reg = new HookRegistry();
		const seen: string[] = [];
		reg.after(() => {
			seen.push("a");
		});
		reg.after(() => {
			seen.push("b");
		});
		await reg.runAfter({
			command: "x",
			result: { stdout: "", stderr: "", exitCode: 0 },
			durationMs: 1,
			startedAt: 0,
			cwd: "/",
		});
		expect(seen).toEqual(["a", "b"]);
	});

	test("error hooks fire only via runError", async () => {
		const reg = new HookRegistry();
		let count = 0;
		reg.onError(() => {
			count++;
		});
		await reg.runError({
			command: "fail",
			result: { stdout: "", stderr: "boom", exitCode: 1 },
			durationMs: 0,
			startedAt: 0,
			cwd: "/",
		});
		expect(count).toBe(1);
	});

	test("transform applies in order", () => {
		const reg = new HookRegistry();
		reg.transform((r) => ({ ...r, stdout: `${r.stdout}-1` }));
		reg.transform((r) => ({ ...r, stdout: `${r.stdout}-2` }));
		const out = reg.applyTransforms({ stdout: "x", stderr: "", exitCode: 0 }, "cmd");
		expect(out.stdout).toBe("x-1-2");
	});

	test("clear removes all hooks", async () => {
		const reg = new HookRegistry();
		reg.before(() => "rewritten");
		reg.after(() => {});
		reg.transform((r) => ({ ...r, stdout: "x" }));
		reg.clear();
		const r = await reg.runBefore("orig", "/");
		expect(r.command).toBe("orig");
		const out = reg.applyTransforms({ stdout: "y", stderr: "", exitCode: 0 }, "cmd");
		expect(out.stdout).toBe("y");
	});
});

describe("Shell hooks integration", () => {
	test("before hook receives command and cwd", async () => {
		const shell = new Shell();
		let seenCmd = "";
		let seenCwd = "";
		shell.before((cmd, cwd) => {
			seenCmd = cmd;
			seenCwd = cwd;
		});
		await shell.run("echo hi");
		expect(seenCmd).toBe("echo hi");
		expect(seenCwd).toBe("/");
	});

	test("before hook blocking returns exit code 130 with explanation", async () => {
		const shell = new Shell();
		shell.before(() => false);
		const r = await shell.run("anything");
		expect(r.exitCode).toBe(130);
		expect(r.stderr).toContain("blocked");
	});

	test("before hook rewrite changes which command runs", async () => {
		const shell = new Shell();
		shell.before(() => "echo rewritten");
		const r = await shell.run("echo original");
		expect(r.stdout.trim()).toBe("rewritten");
	});

	test("after hook fires once with execution record", async () => {
		const shell = new Shell();
		let calls = 0;
		let lastDuration = -1;
		let lastCwd = "";
		shell.after((exec) => {
			calls++;
			lastDuration = exec.durationMs;
			lastCwd = exec.cwd;
		});
		await shell.run("echo hi");
		expect(calls).toBe(1);
		expect(lastDuration).toBeGreaterThanOrEqual(0);
		expect(lastCwd).toBe("/");
	});

	test("after hook fires for failed commands too", async () => {
		const shell = new Shell();
		let calls = 0;
		shell.after(() => {
			calls++;
		});
		await shell.run("nonexistent_command_xyz");
		expect(calls).toBe(1);
	});

	test("onError hook fires only on non-zero exit", async () => {
		const shell = new Shell();
		let errors = 0;
		shell.onError(() => {
			errors++;
		});
		await shell.run("true");
		expect(errors).toBe(0);
		await shell.run("false");
		expect(errors).toBe(1);
		await shell.run("nonexistent_xyz");
		expect(errors).toBe(2);
	});

	test("transform mutates output before return", async () => {
		const shell = new Shell();
		shell.transform(stripAnsi);
		const r = await shell.run("echo $'\\x1b[31mred\\x1b[0m'");
		expect(r.stdout).not.toContain("\x1b");
	});

	test("multiple transforms compose", async () => {
		const shell = new Shell();
		shell.transform(trimOutput);
		shell.transform((r) => ({ ...r, stdout: r.stdout.toUpperCase() }));
		const r = await shell.run("echo '   hello   '");
		expect(r.stdout).toBe("HELLO\n");
	});

	test("hook unsubscribe stops further calls", async () => {
		const shell = new Shell();
		let calls = 0;
		const unsub = shell.after(() => {
			calls++;
		});
		await shell.run("true");
		expect(calls).toBe(1);
		unsub();
		await shell.run("true");
		expect(calls).toBe(1);
	});

	test("clearHooks removes everything", async () => {
		const shell = new Shell();
		shell.before(() => false);
		shell.transform((r) => ({ ...r, stdout: "X" }));
		shell.clearHooks();
		const r = await shell.run("echo ok");
		expect(r.stdout.trim()).toBe("ok");
	});

	test("empty command short-circuits without invoking hooks", async () => {
		const shell = new Shell();
		let beforeCalls = 0;
		let afterCalls = 0;
		shell.before(() => {
			beforeCalls++;
		});
		shell.after(() => {
			afterCalls++;
		});
		const r = await shell.run("   ");
		expect(r.exitCode).toBe(0);
		expect(beforeCalls).toBe(0);
		expect(afterCalls).toBe(0);
	});
});
