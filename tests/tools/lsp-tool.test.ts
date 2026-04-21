import { describe, expect, test } from "bun:test";
import { VirtualFileSystem } from "@ambiently-work/mirage";
import { Biome } from "@biomejs/js-api/nodejs";
import { LspTool } from "../../src/tools/lsp-tool.js";

describe("LspTool", () => {
	test("reports a formatting warning when source is unformatted", async () => {
		const fs = new VirtualFileSystem({
			files: { "/a.ts": "const  x    =   1\n" },
		});
		const tool = new LspTool({ fs, biome: new Biome() });
		const result = await tool.run({ path: "/a.ts" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			const formatIssues = result.value.diagnostics.filter((d) => d.kind === "format");
			expect(formatIssues.length).toBeGreaterThan(0);
			expect(result.value.formatted).toBeDefined();
		}
	});

	test("rejects unsupported file types", async () => {
		const fs = new VirtualFileSystem({ files: { "/a.md": "# hi" } });
		const tool = new LspTool({ fs, biome: new Biome() });
		const result = await tool.run({ path: "/a.md" });
		expect(result.ok).toBe(false);
	});

	test("reports missing-file error", async () => {
		const fs = new VirtualFileSystem();
		const tool = new LspTool({ fs, biome: new Biome() });
		const result = await tool.run({ path: "/missing.ts" });
		expect(result.ok).toBe(false);
	});

	test("clean formatted source yields no format diagnostics", async () => {
		const fs = new VirtualFileSystem({
			files: { "/a.ts": "const x = 1;\n" },
		});
		const tool = new LspTool({ fs, biome: new Biome() });
		const result = await tool.run({ path: "/a.ts" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			const formatIssues = result.value.diagnostics.filter(
				(d) => d.kind === "format" && d.severity !== "info",
			);
			expect(formatIssues.length).toBe(0);
		}
	});
});
