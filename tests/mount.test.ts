import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function makeShell() {
	return new Shell({ user: "u", skipStartupFiles: true });
}

describe("mount/umount builtins (#25)", () => {
	test("tmpfs mount holds writes that disappear on umount", async () => {
		const s = makeShell();
		const r1 = await s.run("mount -t tmpfs none /work");
		expect(r1.exitCode).toBe(0);
		expect(r1.stderr).toBe("");

		const r2 = await s.run("echo hi > /work/x && cat /work/x");
		expect(r2.exitCode).toBe(0);
		expect(r2.stdout.trim()).toBe("hi");

		const r3 = await s.run("umount /work");
		expect(r3.exitCode).toBe(0);

		const r4 = await s.run("ls /work");
		// /work is now an empty directory in the underlying VFS — the file
		// only existed on the unmounted tmpfs.
		expect(r4.exitCode).toBe(0);
		expect(r4.stdout.trim()).toBe("");
	});

	test("`mount` with no args lists active mounts", async () => {
		const s = makeShell();
		await s.run("mount -t tmpfs none /work");
		const r = await s.run("mount");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("none on /work type tmpfs");
		expect(r.stdout).toContain("(rw)");
	});

	test("multiple tmpfs mounts coexist", async () => {
		const s = makeShell();
		await s.run("mount -t tmpfs none /a");
		await s.run("mount -t tmpfs none /b");

		await s.run("echo first > /a/file");
		await s.run("echo second > /b/file");

		const cat = await s.run("cat /a/file /b/file");
		expect(cat.stdout.trim().split("\n")).toEqual(["first", "second"]);

		const list = await s.run("mount");
		expect(list.stdout).toContain("/a");
		expect(list.stdout).toContain("/b");
	});

	test("custom -o options surface in the listing", async () => {
		const s = makeShell();
		await s.run("mount -t tmpfs -o noexec,nosuid none /work");
		const r = await s.run("mount");
		expect(r.stdout).toContain("(noexec,nosuid)");
	});

	test("unmounting a non-mount errors out", async () => {
		const s = makeShell();
		const r = await s.run("umount /nonexistent");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("not mounted");
	});

	test("mount with unsupported type errors out", async () => {
		const s = makeShell();
		const r = await s.run("mount -t bogus src /target");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("unsupported type");
	});

	test("mount missing target errors out", async () => {
		const s = makeShell();
		const r = await s.run("mount -t tmpfs none");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("usage:");
	});

	test("a mount registered programmatically before the shell starts using it shows up", async () => {
		const s = makeShell();
		const { ObjectFileSystem } = await import("@ambiently-work/mirage");
		// Mount points re-root the inner FS, so files under the mount appear at
		// `/note.txt` from the perspective of the inner fs.
		const extra = new ObjectFileSystem({ "/note.txt": "preloaded" });
		s.mount("/external", extra);

		const cat = await s.run("cat /external/note.txt");
		expect(cat.exitCode).toBe(0);
		expect(cat.stdout).toBe("preloaded");

		// The list still surfaces it, just with placeholder metadata since
		// it wasn't created via the `mount` builtin.
		const list = await s.run("mount");
		expect(list.stdout).toContain("/external");
	});

	test("unmounting via the builtin removes a programmatically-added mount", async () => {
		const s = makeShell();
		const { ObjectFileSystem } = await import("@ambiently-work/mirage");
		s.mount("/extra", new ObjectFileSystem({ "/x": "y" }));

		const before = await s.run("cat /extra/x");
		expect(before.stdout).toBe("y");

		const u = await s.run("umount /extra");
		expect(u.exitCode).toBe(0);

		const after = await s.run("cat /extra/x");
		expect(after.exitCode).not.toBe(0);
	});
});
