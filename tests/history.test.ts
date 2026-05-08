import { describe, expect, test } from "bun:test";
import { expandHistory } from "../src/history-expand.js";
import { Shell } from "../src/shell.js";
import { CommandTracker } from "../src/tracker.js";

function interactiveShell(fs?: Record<string, string>) {
	return new Shell({
		interactive: true,
		skipStartupFiles: true,
		user: "luca",
		fs,
	});
}

describe("history builtin (#26)", () => {
	test("interactive shell auto-enables tracking", async () => {
		const shell = interactiveShell();
		await shell.run("echo a");
		expect(shell.tracker?.history.length ?? 0).toBe(1);
	});

	test("non-interactive shell leaves tracking off by default", async () => {
		const shell = new Shell({ user: "luca", skipStartupFiles: true });
		await shell.run("echo a");
		expect(shell.tracker).toBeNull();
	});

	test("default HISTFILE is set under HOME", () => {
		const shell = interactiveShell();
		expect(shell.environment.get("HISTFILE")).toBe("/home/luca/.bash_history");
	});

	test("default HISTSIZE is 500", () => {
		const shell = interactiveShell();
		expect(shell.environment.get("HISTSIZE")).toBe("500");
	});

	test("history lists previously run commands", async () => {
		const shell = interactiveShell();
		await shell.run("echo a");
		await shell.run("echo b");
		const r = await shell.run("history");
		expect(r.stdout).toContain("echo a");
		expect(r.stdout).toContain("echo b");
		expect(r.exitCode).toBe(0);
	});

	test("history N shows last N entries", async () => {
		const shell = interactiveShell();
		await shell.run("echo a");
		await shell.run("echo b");
		await shell.run("echo c");
		const r = await shell.run("history 2");
		const lines = r.stdout.trim().split("\n");
		expect(lines.length).toBe(2);
		expect(lines[1]).toContain("echo c");
	});

	test("history -c clears history", async () => {
		const shell = interactiveShell();
		await shell.run("echo a");
		await shell.run("echo b");
		await shell.run("history -c");
		const r = await shell.run("history");
		// After -c, only the `history -c` and the listing call land back in.
		expect(r.stdout).not.toContain("echo a");
		expect(r.stdout).not.toContain("echo b");
	});

	test("history -d N removes a specific entry", async () => {
		const shell = interactiveShell();
		await shell.run("echo first");
		await shell.run("echo second");
		await shell.run("echo third");
		await shell.run("history -d 2");
		const r = await shell.run("history");
		expect(r.stdout).toContain("echo first");
		expect(r.stdout).not.toContain("echo second");
		expect(r.stdout).toContain("echo third");
	});

	test("history -w writes to a file", async () => {
		const shell = interactiveShell();
		await shell.run("echo a");
		await shell.run("echo b");
		await shell.run("history -w /tmp/h");
		const r = await shell.run("cat /tmp/h");
		expect(r.stdout).toContain("echo a");
		expect(r.stdout).toContain("echo b");
	});

	test("history -w; -c; -r round-trips", async () => {
		const shell = interactiveShell();
		await shell.run("echo first");
		await shell.run("echo second");
		await shell.run("history -w /tmp/h");
		await shell.run("history -c");
		await shell.run("history -r /tmp/h");
		const r = await shell.run("history");
		expect(r.stdout).toContain("echo first");
		expect(r.stdout).toContain("echo second");
	});

	test("history -a appends to a file", async () => {
		const shell = interactiveShell({ "/tmp/h": "echo prelude\n" });
		await shell.run("echo a");
		await shell.run("history -a /tmp/h");
		const r = await shell.run("cat /tmp/h");
		expect(r.stdout).toContain("echo prelude");
		expect(r.stdout).toContain("echo a");
	});

	test("non-interactive shell errors on history", async () => {
		const shell = new Shell({ user: "luca", skipStartupFiles: true });
		const r = await shell.run("history");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("not enabled");
	});

	test("history writes default to $HISTFILE when no path given", async () => {
		const shell = interactiveShell();
		await shell.run("echo target");
		await shell.run("history -w");
		const r = await shell.run("cat /home/luca/.bash_history");
		expect(r.stdout).toContain("echo target");
	});
});

describe("history expansion (set -H)", () => {
	test("disabled by default", async () => {
		const shell = interactiveShell();
		await shell.run("echo first");
		const r = await shell.run("echo !!");
		// !! is literal text when histexpand is off
		expect(r.stdout.trim()).toContain("!");
	});

	test("!! expands to last command", async () => {
		const shell = interactiveShell();
		await shell.run("echo target");
		await shell.run("set -H");
		const r = await shell.run("!!");
		// !! expanded to `set -H` (last command), which produces no output
		expect(r.exitCode).toBe(0);
	});

	test("!N expands to entry N", () => {
		const tracker = new CommandTracker();
		tracker.recordCommand("echo first");
		tracker.recordCommand("echo second");
		expect(expandHistory("!1", tracker)).toBe("echo first");
		expect(expandHistory("!2", tracker)).toBe("echo second");
	});

	test("!-N expands to N commands back", () => {
		const tracker = new CommandTracker();
		tracker.recordCommand("a");
		tracker.recordCommand("b");
		tracker.recordCommand("c");
		expect(expandHistory("!-1", tracker)).toBe("c");
		expect(expandHistory("!-3", tracker)).toBe("a");
	});

	test("!string expands to most recent starting with prefix", () => {
		const tracker = new CommandTracker();
		tracker.recordCommand("git status");
		tracker.recordCommand("ls");
		tracker.recordCommand("git diff");
		expect(expandHistory("!git", tracker)).toBe("git diff");
		expect(expandHistory("!ls", tracker)).toBe("ls");
	});

	test("event-not-found returns null", () => {
		const tracker = new CommandTracker();
		tracker.recordCommand("echo a");
		expect(expandHistory("!nonexistent", tracker)).toBeNull();
		expect(expandHistory("!99", tracker)).toBeNull();
	});

	test("backslash escapes !", () => {
		const tracker = new CommandTracker();
		tracker.recordCommand("echo last");
		expect(expandHistory("echo \\!\\!", tracker)).toBe("echo \\!\\!");
	});

	test("single-quoted ! is literal", () => {
		const tracker = new CommandTracker();
		tracker.recordCommand("echo last");
		expect(expandHistory("echo '!!'", tracker)).toBe("echo '!!'");
	});

	test("double-quoted ! still expands", () => {
		const tracker = new CommandTracker();
		tracker.recordCommand("echo last");
		expect(expandHistory('echo "!!"', tracker)).toBe('echo "echo last"');
	});

	test("trailing or whitespace-followed ! is literal", () => {
		const tracker = new CommandTracker();
		tracker.recordCommand("echo last");
		expect(expandHistory("echo !", tracker)).toBe("echo !");
		expect(expandHistory("foo ! bar", tracker)).toBe("foo ! bar");
	});

	test("event-not-found surfaces error from Shell.run", async () => {
		const shell = interactiveShell();
		await shell.run("set -H");
		const r = await shell.run("!nonexistent");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("event not found");
	});
});

describe("CommandTracker history helpers", () => {
	test("recordCommand stores a synthetic entry", () => {
		const tracker = new CommandTracker();
		tracker.recordCommand("echo replay");
		expect(tracker.history.length).toBe(1);
		expect(tracker.history[0]?.command).toBe("echo replay");
	});

	test("replaceHistory swaps the entire list", () => {
		const tracker = new CommandTracker();
		tracker.recordCommand("a");
		tracker.recordCommand("b");
		tracker.replaceHistory([]);
		expect(tracker.history.length).toBe(0);
	});
});
