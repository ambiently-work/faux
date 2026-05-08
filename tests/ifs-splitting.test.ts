import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function makeShell() {
	return new Shell({ user: "u", skipStartupFiles: true });
}

describe("IFS field splitting (#12)", () => {
	test("unquoted variable splits on default IFS whitespace", async () => {
		const s = makeShell();
		const r = await s.run("args='a b c'; printf '[%s]\\n' $args");
		expect(r.stdout).toBe("[a]\n[b]\n[c]\n");
	});

	test("custom IFS with colon delimiter", async () => {
		const s = makeShell();
		const r = await s.run("IFS=:; x=a:b:c; for w in $x; do echo $w; done");
		expect(r.stdout).toBe("a\nb\nc\n");
	});

	test("quoted variable preserves whitespace as a single field", async () => {
		const s = makeShell();
		const r = await s.run("x='a  b'; printf '[%s]\\n' \"$x\"");
		expect(r.stdout).toBe("[a  b]\n");
	});

	test('"$@" expands to one field per positional argument', async () => {
		const s = makeShell();
		const r = await s.run("set -- one two three; printf '[%s]\\n' \"$@\"");
		expect(r.stdout).toBe("[one]\n[two]\n[three]\n");
	});

	test("unquoted $@ also splits", async () => {
		const s = makeShell();
		const r = await s.run("set -- one two; printf '[%s]\\n' $@");
		expect(r.stdout).toBe("[one]\n[two]\n");
	});

	test("default IFS folds runs of whitespace", async () => {
		const s = makeShell();
		const r = await s.run("x='  a   b  '; printf '[%s]\\n' $x");
		expect(r.stdout).toBe("[a]\n[b]\n");
	});

	test("non-whitespace IFS chars do not fold (empty fields preserved)", async () => {
		const s = makeShell();
		const r = await s.run("IFS=:; x='a::b'; for w in $x; do echo \"<$w>\"; done");
		expect(r.stdout).toBe("<a>\n<>\n<b>\n");
	});

	test("empty IFS disables splitting", async () => {
		const s = makeShell();
		const r = await s.run("IFS=; x='a b c'; printf '[%s]\\n' $x");
		expect(r.stdout).toBe("[a b c]\n");
	});

	test("literal text glues to splittable expansion", async () => {
		const s = makeShell();
		const r = await s.run("x='b c'; printf '[%s]\\n' a$x");
		expect(r.stdout).toBe("[ab]\n[c]\n");
	});

	test("command substitution splits when unquoted", async () => {
		const s = makeShell();
		const r = await s.run("printf '[%s]\\n' $(echo a b c)");
		expect(r.stdout).toBe("[a]\n[b]\n[c]\n");
	});

	test("command substitution stays one field when quoted", async () => {
		const s = makeShell();
		const r = await s.run("printf '[%s]\\n' \"$(echo a b c)\"");
		expect(r.stdout).toBe("[a b c]\n");
	});

	test("for loop splits unquoted variable on IFS", async () => {
		const s = makeShell();
		const r = await s.run('items="x y z"; for i in $items; do echo $i; done');
		expect(r.stdout).toBe("x\ny\nz\n");
	});

	test("for loop preserves quoted variable as single field", async () => {
		const s = makeShell();
		const r = await s.run('items="x y z"; for i in "$items"; do echo "<$i>"; done');
		expect(r.stdout).toBe("<x y z>\n");
	});

	test("empty unquoted variable yields no fields", async () => {
		const s = makeShell();
		const r = await s.run("x=; printf 'count: %d\\n' $#; printf '[%s]\\n' $x done");
		expect(r.stdout.trim().split("\n").pop()).toBe("[done]");
	});
});
