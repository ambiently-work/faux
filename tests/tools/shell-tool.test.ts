import { describe, expect, test } from "bun:test";
import { Shell, ShellSession, ShellTool, ToolRegistry } from "../../src/index.js";

describe("ShellTool", () => {
	test("runs a command and returns stdout/stderr/exitCode", async () => {
		const tool = new ShellTool({ shellOptions: { user: "luca" } });
		const result = await tool.run({ command: "echo hello" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.stdout).toBe("hello\n");
			expect(result.value.stderr).toBe("");
			expect(result.value.exitCode).toBe(0);
		}
	});

	test("preserves shell state across runs", async () => {
		const tool = new ShellTool({ shellOptions: { user: "luca" } });
		await tool.run({ command: "export FOO=bar" });
		const result = await tool.run({ command: "echo $FOO" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.stdout).toBe("bar\n");
	});

	test("accepts a caller-provided Shell instance", async () => {
		const shell = new Shell({
			user: "luca",
			fs: { "/home/luca/note.txt": "ambient\n" },
		});
		const tool = new ShellTool({ shell });
		const result = await tool.run({ command: "cat /home/luca/note.txt" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.stdout).toBe("ambient\n");
	});

	test("integrates with ToolRegistry and validates input", async () => {
		const registry = new ToolRegistry([new ShellTool()]);
		const ok = await registry.run({
			tool: "shell",
			inputs: { command: "printf ok" },
		});
		expect(ok.ok).toBe(true);

		const bad = await registry.run({ tool: "shell", inputs: {} });
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.error.code).toBe("invalid_input");
	});

	test("serializes concurrent invocations", async () => {
		const tool = new ShellTool({ shellOptions: { user: "luca" } });
		const results = await Promise.all([
			tool.run({ command: "export STEP=1; echo one" }),
			tool.run({ command: "export STEP=2; echo two" }),
			tool.run({ command: "export STEP=3; echo three" }),
		]);
		for (const r of results) expect(r.ok).toBe(true);
		const finalStep = await tool.run({ command: "echo $STEP" });
		if (finalStep.ok) expect(finalStep.value.stdout.trim()).toBe("3");
	});

	test("shared ShellSession reused across tool instances", async () => {
		const session = new ShellSession({ user: "luca" });
		const a = new ShellTool({ id: "shell_a", session });
		const b = new ShellTool({ id: "shell_b", session });
		await a.run({ command: "export SHARED=yes" });
		const r = await b.run({ command: "echo $SHARED" });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.stdout).toBe("yes\n");
		expect(a.shell).toBe(b.shell);
	});
});
