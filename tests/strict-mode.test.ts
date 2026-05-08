import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function makeShell() {
	return new Shell({ user: "u", skipStartupFiles: true });
}

describe("set -e (errexit)", () => {
	test("aborts after a failing simple command", async () => {
		const shell = makeShell();
		const r = await shell.run("set -e; false; echo after");
		expect(r.stdout).not.toContain("after");
		expect(r.exitCode).toBe(1);
	});

	test("does not fire on if/elif condition", async () => {
		const shell = makeShell();
		const r = await shell.run("set -e; if false; then echo no; fi; echo ok");
		expect(r.stdout.trim()).toBe("ok");
		expect(r.exitCode).toBe(0);
	});

	test("does not fire on while/until condition", async () => {
		const shell = makeShell();
		const r = await shell.run("set -e; while false; do echo no; done; echo ok");
		expect(r.stdout.trim()).toBe("ok");
		expect(r.exitCode).toBe(0);
	});

	test("does not fire on left of && when it fails", async () => {
		const shell = makeShell();
		const r = await shell.run("set -e; false || true; echo ok");
		expect(r.stdout.trim()).toBe("ok");
		expect(r.exitCode).toBe(0);
	});

	test("does not fire on left of || when it fails", async () => {
		const shell = makeShell();
		const r = await shell.run("set -e; false || true; echo ok");
		expect(r.stdout.trim()).toBe("ok");
	});

	test("DOES fire on right of && when it fails", async () => {
		const shell = makeShell();
		const r = await shell.run("set -e; true && false; echo after");
		expect(r.stdout).not.toContain("after");
		expect(r.exitCode).toBe(1);
	});

	test("does not fire on negated pipeline", async () => {
		const shell = makeShell();
		const r = await shell.run("set -e; ! false; echo ok");
		expect(r.stdout.trim()).toBe("ok");
		expect(r.exitCode).toBe(0);
	});

	test("does fire after a top-level pipeline fails", async () => {
		const shell = makeShell();
		const r = await shell.run("set -e; false | false; echo after");
		expect(r.stdout).not.toContain("after");
		expect(r.exitCode).toBe(1);
	});

	test("disabled by default", async () => {
		const shell = makeShell();
		const r = await shell.run("false; echo after");
		expect(r.stdout.trim()).toBe("after");
		expect(r.exitCode).toBe(0);
	});

	test("set +e disables errexit", async () => {
		const shell = makeShell();
		const r = await shell.run("set -e; set +e; false; echo after");
		expect(r.stdout.trim()).toBe("after");
	});
});

describe("set -u (nounset)", () => {
	test("errors on bare unset variable", async () => {
		const shell = makeShell();
		const r = await shell.run("set -u; echo $NOPE");
		expect(r.stderr).toContain("NOPE: unbound variable");
		expect(r.exitCode).toBe(1);
	});

	test("does not error on default-value operator", async () => {
		const shell = makeShell();
		const r = await shell.run('set -u; echo "${NOPE:-fallback}"');
		expect(r.stdout.trim()).toBe("fallback");
		expect(r.exitCode).toBe(0);
	});

	test("does not error when variable is set to empty", async () => {
		const shell = makeShell();
		const r = await shell.run('set -u; FOO=""; echo "<$FOO>"');
		expect(r.stdout.trim()).toBe("<>");
	});

	test("does not error on special variables", async () => {
		const shell = makeShell();
		const r = await shell.run("set -u; echo $?");
		expect(r.stdout.trim()).toBe("0");
		expect(r.stderr).toBe("");
	});

	test("set +u disables nounset", async () => {
		const shell = makeShell();
		const r = await shell.run('set -u; set +u; echo "<$NOPE>"');
		expect(r.stdout.trim()).toBe("<>");
	});

	test("disabled by default", async () => {
		const shell = makeShell();
		const r = await shell.run('echo "<$NOPE>"');
		expect(r.stdout.trim()).toBe("<>");
		expect(r.exitCode).toBe(0);
	});

	test("${var:-default} on unset var with -u still works", async () => {
		const shell = makeShell();
		const r = await shell.run('set -u; echo "${UNSET:-here}"');
		expect(r.stdout.trim()).toBe("here");
	});

	test("${#var} on unset var errors with -u", async () => {
		const shell = makeShell();
		const r = await shell.run('set -u; echo "${#UNSET}"');
		expect(r.stderr).toContain("UNSET: unbound variable");
		expect(r.exitCode).toBe(1);
	});
});

describe("set -o pipefail", () => {
	test("returns rightmost non-zero exit code", async () => {
		const shell = makeShell();
		const r = await shell.run("set -o pipefail; false | true");
		expect(r.exitCode).toBe(1);
	});

	test("ignores intermediate failures when pipefail off", async () => {
		const shell = makeShell();
		const r = await shell.run("false | true");
		expect(r.exitCode).toBe(0);
	});

	test("rightmost non-zero wins over leftward failures", async () => {
		const shell = makeShell();
		const r = await shell.run("set -o pipefail; false | false");
		expect(r.exitCode).toBe(1);
	});

	test("zero pipeline exit when all stages succeed", async () => {
		const shell = makeShell();
		const r = await shell.run("set -o pipefail; true | true | true");
		expect(r.exitCode).toBe(0);
	});

	test("set +o pipefail disables", async () => {
		const shell = makeShell();
		const r = await shell.run("set -o pipefail; set +o pipefail; false | true");
		expect(r.exitCode).toBe(0);
	});
});

describe("set -euo pipefail combined", () => {
	test("all three together", async () => {
		const shell = makeShell();
		const r = await shell.run("set -euo pipefail; true | true; echo ok");
		expect(r.stdout.trim()).toBe("ok");
	});

	test("pipefail + errexit aborts on intermediate failure", async () => {
		const shell = makeShell();
		const r = await shell.run("set -euo pipefail; false | true; echo after");
		expect(r.stdout).not.toContain("after");
		expect(r.exitCode).toBe(1);
	});
});
