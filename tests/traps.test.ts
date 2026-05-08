import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function makeShell() {
	return new Shell({ user: "u", skipStartupFiles: true });
}

describe("trap dispatch (#9)", () => {
	test("EXIT trap fires when shell exits", async () => {
		const s = makeShell();
		const r = await s.run("trap 'echo bye' EXIT; exit 0");
		expect(r.stdout).toContain("bye");
		expect(r.exitCode).toBe(0);
	});

	test("EXIT trap preserves exit code", async () => {
		const s = makeShell();
		const r = await s.run("trap 'echo bye' EXIT; exit 7");
		expect(r.stdout).toContain("bye");
		expect(r.exitCode).toBe(7);
	});

	test("ERR trap fires on non-zero exit from a command", async () => {
		const s = makeShell();
		const r = await s.run("trap 'echo oops' ERR; false");
		expect(r.stdout).toContain("oops");
	});

	test("ERR trap does not fire on zero exit", async () => {
		const s = makeShell();
		const r = await s.run("trap 'echo oops' ERR; true");
		expect(r.stdout).not.toContain("oops");
	});

	test("ERR trap does not fire inside an `if` condition", async () => {
		const s = makeShell();
		const r = await s.run("trap 'echo oops' ERR; if false; then echo no; fi; echo done");
		expect(r.stdout).not.toContain("oops");
		expect(r.stdout.trim()).toBe("done");
	});

	test("DEBUG trap fires before each simple command", async () => {
		const s = makeShell();
		const r = await s.run("trap 'echo dbg' DEBUG; echo hi");
		const lines = r.stdout.trim().split("\n");
		// We expect dbg before echo hi; the order is dbg dbg (for echo) hi
		expect(r.stdout).toContain("dbg");
		expect(r.stdout).toContain("hi");
		expect(lines.length).toBeGreaterThanOrEqual(2);
	});

	test("RETURN trap fires when a function returns", async () => {
		const s = makeShell();
		const r = await s.run("f() { trap 'echo ret' RETURN; :; }; f");
		expect(r.stdout).toContain("ret");
	});

	test("trap - EXIT clears the EXIT handler", async () => {
		const s = makeShell();
		const r = await s.run("trap 'echo bye' EXIT; trap - EXIT; exit 0");
		expect(r.stdout).not.toContain("bye");
		expect(r.exitCode).toBe(0);
	});

	test("trap '' EXIT (empty command) clears the handler", async () => {
		const s = makeShell();
		const r = await s.run("trap 'echo bye' EXIT; trap '' EXIT; exit 0");
		expect(r.stdout).not.toContain("bye");
	});

	test("traps don't recursively self-fire", async () => {
		const s = makeShell();
		// DEBUG handler runs commands; we'd loop forever if recursive dispatch wasn't suppressed.
		const r = await s.run("trap 'echo dbg' DEBUG; echo hi");
		// Should terminate. Count occurrences of "dbg" — should be small.
		const occurrences = r.stdout.split("dbg").length - 1;
		expect(occurrences).toBeLessThan(10);
	});

	test("multiple traps coexist", async () => {
		const s = makeShell();
		const r = await s.run("trap 'echo bye' EXIT; trap 'echo bad' ERR; false; exit 1");
		expect(r.stdout).toContain("bad");
		expect(r.stdout).toContain("bye");
	});

	test("trap output goes to stdout/stderr like a normal command", async () => {
		const s = makeShell();
		const r = await s.run("trap 'echo to-err >&2' EXIT; exit 0");
		expect(r.stderr).toContain("to-err");
	});
});
