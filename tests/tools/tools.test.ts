import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Tool, ToolRegistry, type ToolResult } from "../../src/index.js";

class EchoTool extends Tool<{ message: string }, string> {
	readonly id = "echo";
	readonly description = "Echoes the input message";
	readonly schema = z.object({ message: z.string() });

	async run(inputs: { message: string }): Promise<ToolResult<string>> {
		return { ok: true, value: inputs.message };
	}
}

describe("Tool.parse", () => {
	test("returns ok for valid input", () => {
		const tool = new EchoTool();
		expect(tool.parse({ message: "hi" })).toEqual({
			ok: true,
			value: { message: "hi" },
		});
	});

	test("returns invalid_input for bad input", () => {
		const tool = new EchoTool();
		const result = tool.parse({ message: 42 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("invalid_input");
	});
});

describe("ToolRegistry", () => {
	test("registers, lists, runs", async () => {
		const registry = new ToolRegistry([new EchoTool()]);
		expect(registry.list().map((t) => t.id)).toEqual(["echo"]);
		const result = await registry.run({
			tool: "echo",
			inputs: { message: "hello" },
		});
		expect(result).toEqual({ ok: true, value: "hello" });
	});

	test("rejects duplicate ids", () => {
		const registry = new ToolRegistry([new EchoTool()]);
		const result = registry.register(new EchoTool());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("duplicate_tool");
	});

	test("unknown tool surfaces unknown_tool error", async () => {
		const registry = new ToolRegistry();
		const result = await registry.run({ tool: "missing", inputs: {} });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("unknown_tool");
	});
});
