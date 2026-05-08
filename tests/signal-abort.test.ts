import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function makeShell() {
	return new Shell({ user: "u", skipStartupFiles: true });
}

describe("signal delivery (#31)", () => {
	test("aborting cancels a long sleep with exit 130", async () => {
		const s = makeShell();
		const ctrl = new AbortController();
		const start = performance.now();
		setTimeout(() => ctrl.abort(), 20);
		const r = await s.run("sleep 100", { signal: ctrl.signal });
		const elapsed = performance.now() - start;
		expect(r.exitCode).toBe(130);
		expect(elapsed).toBeLessThan(500);
	});

	test("aborting interrupts an infinite while loop", async () => {
		const s = makeShell();
		const ctrl = new AbortController();
		setTimeout(() => ctrl.abort(), 20);
		const start = performance.now();
		const r = await s.run("while :; do :; done", { signal: ctrl.signal });
		const elapsed = performance.now() - start;
		expect(r.exitCode).toBe(130);
		expect(elapsed).toBeLessThan(1000);
	});

	test("aborting interrupts an infinite until loop", async () => {
		const s = makeShell();
		const ctrl = new AbortController();
		setTimeout(() => ctrl.abort(), 20);
		const r = await s.run("until false; do :; done", { signal: ctrl.signal });
		expect(r.exitCode).toBe(130);
	});

	test("aborting interrupts a for loop", async () => {
		const s = makeShell();
		const ctrl = new AbortController();
		setTimeout(() => ctrl.abort(), 20);
		const r = await s.run("for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; done", {
			signal: ctrl.signal,
		});
		expect(r.exitCode).toBe(130);
	});

	test("INT trap fires once before unwinding", async () => {
		const s = makeShell();
		const ctrl = new AbortController();
		setTimeout(() => ctrl.abort(), 20);
		const r = await s.run("trap 'echo got-int' INT; sleep 100", { signal: ctrl.signal });
		expect(r.stdout).toContain("got-int");
		expect(r.exitCode).toBe(130);
	});

	test("aborted-from-the-start signal exits 130 immediately", async () => {
		const s = makeShell();
		const ctrl = new AbortController();
		ctrl.abort();
		const r = await s.run("echo hi", { signal: ctrl.signal });
		expect(r.exitCode).toBe(130);
		expect(r.stdout).toBe("");
	});

	test("running again after a prior abort is unaffected", async () => {
		const s = makeShell();
		const ctrl = new AbortController();
		setTimeout(() => ctrl.abort(), 20);
		const first = await s.run("sleep 100", { signal: ctrl.signal });
		expect(first.exitCode).toBe(130);

		const second = await s.run("echo ok");
		expect(second.exitCode).toBe(0);
		expect(second.stdout.trim()).toBe("ok");
	});

	test("yes bails out promptly when aborted", async () => {
		const s = makeShell();
		const ctrl = new AbortController();
		ctrl.abort();
		const r = await s.run("yes", { signal: ctrl.signal });
		expect(r.exitCode).toBe(130);
	});

	test("commands without a signal still run normally", async () => {
		const s = makeShell();
		const r = await s.run("echo hello");
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toBe("hello");
	});
});
