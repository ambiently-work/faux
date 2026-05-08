import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function makeShell(fs?: Record<string, string>) {
	return new Shell({
		user: "u",
		skipStartupFiles: true,
		fs,
	});
}

function statMode(stdout: string): number | undefined {
	const match = /Access:\s*\(0?(\d+)\)/.exec(stdout);
	if (!match?.[1]) return undefined;
	return Number.parseInt(match[1], 8);
}

describe("umask enforcement (#28)", () => {
	test("default umask 0022 yields 0644 files and 0755 dirs", async () => {
		const s = makeShell();
		await s.run("touch f");
		await s.run("mkdir d");
		const f = await s.run("stat f");
		const d = await s.run("stat d");
		expect(statMode(f.stdout)).toBe(0o644);
		expect(statMode(d.stdout)).toBe(0o755);
	});

	test("umask 0077 produces 0600 files and 0700 dirs", async () => {
		const s = makeShell();
		await s.run("umask 077");
		await s.run("touch f");
		await s.run("mkdir d");
		const f = await s.run("stat f");
		const d = await s.run("stat d");
		expect(statMode(f.stdout)).toBe(0o600);
		expect(statMode(d.stdout)).toBe(0o700);
	});

	test("umask 002 produces 0664 files and 0775 dirs", async () => {
		const s = makeShell();
		await s.run("umask 002");
		await s.run("touch f");
		await s.run("mkdir d");
		const f = await s.run("stat f");
		const d = await s.run("stat d");
		expect(statMode(f.stdout)).toBe(0o664);
		expect(statMode(d.stdout)).toBe(0o775);
	});

	test("redirection > file applies umask", async () => {
		const s = makeShell();
		await s.run("umask 077");
		await s.run("echo hi > greet");
		const r = await s.run("stat greet");
		expect(statMode(r.stdout)).toBe(0o600);
	});

	test("existing file mode is preserved on overwrite", async () => {
		const s = makeShell({ "/file": "old\n" });
		await s.run("chmod 777 /file");
		await s.run("umask 077");
		await s.run("echo new > /file");
		const r = await s.run("stat /file");
		expect(statMode(r.stdout)).toBe(0o777);
	});

	test("mkdir -p applies umask to all newly-created components", async () => {
		const s = makeShell();
		await s.run("umask 077");
		await s.run("mkdir -p a/b/c");
		const a = await s.run("stat /a");
		const b = await s.run("stat /a/b");
		const c = await s.run("stat /a/b/c");
		expect(statMode(a.stdout)).toBe(0o700);
		expect(statMode(b.stdout)).toBe(0o700);
		expect(statMode(c.stdout)).toBe(0o700);
	});

	test("umask change does not affect already-created files", async () => {
		const s = makeShell();
		await s.run("touch existing");
		await s.run("umask 077");
		const r = await s.run("stat existing");
		expect(statMode(r.stdout)).toBe(0o644);
	});
});
