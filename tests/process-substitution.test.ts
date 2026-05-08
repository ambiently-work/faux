import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function makeShell() {
	return new Shell({ user: "u", skipStartupFiles: true });
}

describe("process substitution (#11)", () => {
	test("cat <(echo hello) prints hello", async () => {
		const s = makeShell();
		const r = await s.run("cat <(echo hello)");
		expect(r.stdout).toBe("hello\n");
	});

	test("cat with two psubs concatenates outputs in order", async () => {
		const s = makeShell();
		const r = await s.run("cat <(printf 'A\\n') <(printf 'B\\n')");
		expect(r.stdout).toBe("A\nB\n");
	});

	test("diff <(...) <(...) reports differences", async () => {
		const s = makeShell();
		const r = await s.run("diff <(printf 'a\\nb\\n') <(printf 'a\\nc\\n')");
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("-b");
		expect(r.stdout).toContain("+c");
	});

	test("psub temp files are cleaned up after the command", async () => {
		const s = makeShell();
		await s.run("cat <(echo hi) > /dev/null");
		const r = await s.run("ls /tmp 2>/dev/null");
		expect(r.stdout).not.toContain("fauxps");
	});

	test("psub path is absolute", async () => {
		const s = makeShell();
		const r = await s.run("echo <(echo x)");
		expect(r.stdout.trim()).toMatch(/^\/tmp\/fauxps\./);
	});

	test("nested command substitution inside psub body", async () => {
		const s = makeShell();
		const r = await s.run("cat <(echo $(echo nested))");
		expect(r.stdout.trim()).toBe("nested");
	});

	test("psub works with builtins reading the path", async () => {
		const s = makeShell();
		const r = await s.run("wc -l <(printf 'one\\ntwo\\nthree\\n')");
		expect(r.stdout.trim().startsWith("3 ")).toBe(true);
	});
});
