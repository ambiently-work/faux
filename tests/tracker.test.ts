import { describe, expect, test } from "bun:test";
import type { CommandExecution } from "../src/hooks.js";
import { Shell } from "../src/shell.js";
import { CommandTracker } from "../src/tracker.js";

function makeRecord(
	command: string,
	exitCode: number,
	durationMs: number,
	stderr = "",
): CommandExecution {
	return {
		command,
		result: { stdout: "", stderr, exitCode },
		durationMs,
		startedAt: Date.now(),
		cwd: "/",
	};
}

describe("CommandTracker (direct)", () => {
	test("count starts at 0", () => {
		const t = new CommandTracker();
		expect(t.count).toBe(0);
	});

	test("record appends to history", () => {
		const t = new CommandTracker();
		t.record(makeRecord("echo a", 0, 10));
		t.record(makeRecord("echo b", 0, 20));
		expect(t.count).toBe(2);
		expect(t.history).toHaveLength(2);
	});

	test("history reflects insertion order", () => {
		const t = new CommandTracker();
		t.record(makeRecord("first", 0, 1));
		t.record(makeRecord("second", 0, 1));
		expect(t.history[0].command).toBe("first");
		expect(t.history[1].command).toBe("second");
	});

	test("maxHistory drops oldest entries", () => {
		const t = new CommandTracker(3);
		t.record(makeRecord("a", 0, 1));
		t.record(makeRecord("b", 0, 1));
		t.record(makeRecord("c", 0, 1));
		t.record(makeRecord("d", 0, 1));
		expect(t.count).toBe(3);
		expect(t.history.map((h) => h.command)).toEqual(["b", "c", "d"]);
	});

	test("last(n) returns trailing slice", () => {
		const t = new CommandTracker();
		for (let i = 0; i < 5; i++) t.record(makeRecord(`cmd${i}`, 0, 1));
		const last2 = t.last(2);
		expect(last2.map((h) => h.command)).toEqual(["cmd3", "cmd4"]);
	});

	test("last() default to 10", () => {
		const t = new CommandTracker();
		for (let i = 0; i < 15; i++) t.record(makeRecord(`cmd${i}`, 0, 1));
		expect(t.last()).toHaveLength(10);
	});

	test("failures filters non-zero exit codes", () => {
		const t = new CommandTracker();
		t.record(makeRecord("ok", 0, 1));
		t.record(makeRecord("fail1", 1, 1));
		t.record(makeRecord("fail2", 127, 1));
		expect(t.failures).toHaveLength(2);
		expect(t.failCount).toBe(2);
	});

	test("successes filters zero exit codes", () => {
		const t = new CommandTracker();
		t.record(makeRecord("a", 0, 1));
		t.record(makeRecord("b", 1, 1));
		t.record(makeRecord("c", 0, 1));
		expect(t.successes).toHaveLength(2);
	});

	test("slowest sorts descending by duration", () => {
		const t = new CommandTracker();
		t.record(makeRecord("fast", 0, 5));
		t.record(makeRecord("slow", 0, 100));
		t.record(makeRecord("medium", 0, 50));
		const slowest = t.slowest;
		expect(slowest[0].command).toBe("slow");
		expect(slowest[1].command).toBe("medium");
		expect(slowest[2].command).toBe("fast");
	});

	test("totalTimeMs sums durations", () => {
		const t = new CommandTracker();
		t.record(makeRecord("a", 0, 10));
		t.record(makeRecord("b", 0, 20));
		t.record(makeRecord("c", 0, 30));
		expect(t.totalTimeMs).toBe(60);
	});

	test("avgTimeMs is mean", () => {
		const t = new CommandTracker();
		t.record(makeRecord("a", 0, 10));
		t.record(makeRecord("b", 0, 30));
		expect(t.avgTimeMs).toBe(20);
	});

	test("avgTimeMs is 0 with no history", () => {
		expect(new CommandTracker().avgTimeMs).toBe(0);
	});

	test("successRate is 1 with no history", () => {
		expect(new CommandTracker().successRate).toBe(1);
	});

	test("successRate computes proportion", () => {
		const t = new CommandTracker();
		t.record(makeRecord("a", 0, 1));
		t.record(makeRecord("b", 0, 1));
		t.record(makeRecord("c", 1, 1));
		t.record(makeRecord("d", 1, 1));
		expect(t.successRate).toBe(0.5);
	});

	test("commandFrequency counts base names", () => {
		const t = new CommandTracker();
		t.record(makeRecord("ls -la", 0, 1));
		t.record(makeRecord("ls /tmp", 0, 1));
		t.record(makeRecord("cat file", 0, 1));
		const freq = t.commandFrequency();
		expect(freq.ls).toBe(2);
		expect(freq.cat).toBe(1);
	});

	test("stats() bundles aggregate info", () => {
		const t = new CommandTracker();
		t.record(makeRecord("ok1", 0, 5));
		t.record(makeRecord("ok2", 0, 10));
		t.record(makeRecord("bad", 1, 50, "kaboom"));
		const s = t.stats();
		expect(s.total).toBe(3);
		expect(s.succeeded).toBe(2);
		expect(s.failed).toBe(1);
		expect(s.totalTimeMs).toBe(65);
		expect(s.slowestCommands[0].command).toBe("bad");
		expect(s.recentFailures[0].command).toBe("bad");
		expect(s.recentFailures[0].stderr).toContain("kaboom");
	});

	test("stats slowestCommands capped at 5", () => {
		const t = new CommandTracker();
		for (let i = 0; i < 10; i++) t.record(makeRecord(`c${i}`, 0, i * 10));
		const s = t.stats();
		expect(s.slowestCommands).toHaveLength(5);
	});

	test("stats recentFailures capped at 5 with truncated stderr", () => {
		const t = new CommandTracker();
		const longErr = "x".repeat(500);
		for (let i = 0; i < 10; i++) t.record(makeRecord(`f${i}`, 1, 1, longErr));
		const s = t.stats();
		expect(s.recentFailures).toHaveLength(5);
		expect(s.recentFailures[0].stderr.length).toBeLessThanOrEqual(200);
	});

	test("summary returns multi-line string", () => {
		const t = new CommandTracker();
		t.record(makeRecord("ok", 0, 1));
		t.record(makeRecord("bad", 1, 1, "fail"));
		const out = t.summary();
		expect(out).toContain("Commands: 2");
		expect(out).toContain("Success rate: 50.0%");
	});

	test("clear resets history", () => {
		const t = new CommandTracker();
		t.record(makeRecord("x", 0, 1));
		t.clear();
		expect(t.count).toBe(0);
	});
});

describe("Shell tracking integration", () => {
	test("tracker is null when tracking disabled", () => {
		const shell = new Shell();
		expect(shell.tracker).toBeNull();
	});

	test("tracker is created when tracking enabled at construction", async () => {
		const shell = new Shell({ tracking: true });
		expect(shell.tracker).not.toBeNull();
		await shell.run("echo hi");
		expect(shell.tracker?.count).toBe(1);
	});

	test("enableTracking() turns it on after construction", async () => {
		const shell = new Shell();
		shell.enableTracking();
		await shell.run("echo hi");
		expect(shell.tracker?.count).toBe(1);
	});

	test("tracking records both successes and failures", async () => {
		const shell = new Shell({ tracking: true });
		await shell.run("true");
		await shell.run("false");
		await shell.run("nonexistent_xyz");
		const t = shell.tracker;
		if (!t) throw new Error("tracker should be enabled");
		expect(t.count).toBe(3);
		expect(t.failCount).toBe(2);
	});

	test("recorded execution carries cwd snapshot", async () => {
		const shell = new Shell({ tracking: true, fs: { "/tmp/x": "" } });
		await shell.run("cd /tmp");
		await shell.run("echo hi");
		const last = shell.tracker?.last(1)[0];
		expect(last?.cwd).toBe("/tmp");
	});

	test("maxHistory option limits stored history", async () => {
		const shell = new Shell({ tracking: true, maxHistory: 2 });
		await shell.run("echo a");
		await shell.run("echo b");
		await shell.run("echo c");
		expect(shell.tracker?.count).toBe(2);
	});
});
