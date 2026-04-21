import type { IFileSystem } from "@ambiently-work/mirage";
import { z } from "zod";
import type { BiomeInstance } from "../commands/builtins/biome.js";
import { Tool, type ToolResult } from "./tools.js";

export interface LspToolOptions {
	id?: string;
	description?: string;
	fs: IFileSystem;
	biome: BiomeInstance;
	/**
	 * Optional path to a biome config file in the VFS. Parsed JSON is applied
	 * via `applyConfiguration` before diagnostics run.
	 */
	configPath?: string;
}

export interface LspDiagnostic {
	severity: "error" | "warning" | "info";
	kind: "format" | "lint";
	message: string;
}

export interface LspToolResult {
	path: string;
	diagnostics: LspDiagnostic[];
	/** Biome's pretty-printed diagnostics, when there are any. */
	pretty: string;
	/** Formatted source produced by Biome, if different from the input. */
	formatted?: string;
}

const DEFAULT_DESCRIPTION =
	"Report LSP-style diagnostics for a JS/TS/JSON/CSS file using Biome. Returns structured diagnostics and Biome's pretty-printed output.";

const SUPPORTED_EXTENSIONS = new Set([
	".js",
	".jsx",
	".ts",
	".tsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
	".json",
	".jsonc",
	".css",
]);

function getExtension(filePath: string): string {
	const dot = filePath.lastIndexOf(".");
	return dot === -1 ? "" : filePath.slice(dot);
}

function diagnosticSeverity(d: unknown): "error" | "warning" | "info" {
	const rec = d as Record<string, unknown>;
	const sev = typeof rec.severity === "string" ? rec.severity.toLowerCase() : "";
	if (sev.includes("warn")) return "warning";
	if (sev.includes("info")) return "info";
	return "error";
}

function diagnosticMessage(d: unknown): string {
	const rec = d as Record<string, unknown>;
	return String(rec.message ?? rec.description ?? "unknown diagnostic");
}

const inputSchema = z.object({
	path: z.string().min(1),
});

type LspToolInput = z.infer<typeof inputSchema>;

export class LspTool extends Tool<LspToolInput, LspToolResult> {
	readonly id: string;
	readonly description: string;
	readonly schema = inputSchema;
	private readonly fs: IFileSystem;
	private readonly biome: BiomeInstance;
	private readonly configPath?: string;

	constructor(options: LspToolOptions) {
		super();
		this.id = options.id ?? "lsp";
		this.description = options.description ?? DEFAULT_DESCRIPTION;
		this.fs = options.fs;
		this.biome = options.biome;
		this.configPath = options.configPath;
	}

	async run(inputs: LspToolInput): Promise<ToolResult<LspToolResult>> {
		try {
			if (!this.fs.exists(inputs.path)) {
				return {
					ok: false,
					error: {
						code: "tool_failed",
						message: `File not found: ${inputs.path}`,
					},
				};
			}
			const ext = getExtension(inputs.path);
			if (!SUPPORTED_EXTENSIONS.has(ext)) {
				return {
					ok: false,
					error: {
						code: "tool_failed",
						message: `Unsupported file type: ${ext || "(none)"}`,
					},
				};
			}

			const content = this.fs.readFile(inputs.path);
			const { projectKey } = this.biome.openProject();
			if (this.configPath && this.fs.exists(this.configPath)) {
				try {
					const raw = this.fs.readFile(this.configPath);
					const parsed = JSON.parse(raw) as Record<string, unknown>;
					delete parsed.$schema;
					this.biome.applyConfiguration(projectKey, parsed);
				} catch {
					// Ignore bad config — biome's default rules still run
				}
			}

			const diagnostics: LspDiagnostic[] = [];
			let pretty = "";
			let formatted: string | undefined;

			try {
				const fmt = this.biome.formatContent(projectKey, content, {
					filePath: inputs.path,
				});
				if (fmt.content !== content) {
					formatted = fmt.content;
					diagnostics.push({
						severity: "warning",
						kind: "format",
						message: "File is not formatted",
					});
				}
				for (const d of fmt.diagnostics) {
					diagnostics.push({
						severity: diagnosticSeverity(d),
						kind: "format",
						message: diagnosticMessage(d),
					});
				}
			} catch (e) {
				diagnostics.push({
					severity: "error",
					kind: "format",
					message: `Format error: ${e instanceof Error ? e.message : e}`,
				});
			}

			try {
				const linted = this.biome.lintContent(projectKey, content, {
					filePath: inputs.path,
				});
				for (const d of linted.diagnostics) {
					diagnostics.push({
						severity: diagnosticSeverity(d),
						kind: "lint",
						message: diagnosticMessage(d),
					});
				}
				if (linted.diagnostics.length > 0) {
					pretty = this.biome.printDiagnostics(linted.diagnostics, {
						filePath: inputs.path,
						fileSource: content,
					});
				}
			} catch (e) {
				diagnostics.push({
					severity: "error",
					kind: "lint",
					message: `Lint error: ${e instanceof Error ? e.message : e}`,
				});
			}

			return {
				ok: true,
				value: { path: inputs.path, diagnostics, pretty, formatted },
			};
		} catch (error) {
			return {
				ok: false,
				error: {
					code: "tool_failed",
					message: error instanceof Error ? error.message : String(error),
					cause: error,
				},
			};
		}
	}
}
