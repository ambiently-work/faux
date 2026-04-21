import type { IFileSystem } from "@ambiently-work/mirage";
import { z } from "zod";
import { Tool, type ToolResult } from "./tools.js";

export interface GrepToolOptions {
	id?: string;
	description?: string;
	fs: IFileSystem;
	/** Default glob used to pick files when `glob` is omitted. */
	defaultGlob?: string;
	/** Maximum bytes to scan per file (larger files are skipped). */
	maxFileBytes?: number;
}

export interface GrepMatch {
	path: string;
	line: number;
	text: string;
}

export type GrepToolResult =
	| {
			output_mode: "files_with_matches";
			matches: string[];
			count: number;
	  }
	| {
			output_mode: "count";
			counts: Array<{ path: string; count: number }>;
			total: number;
	  }
	| {
			output_mode: "content";
			matches: GrepMatch[];
			count: number;
			truncated: boolean;
	  };

const DEFAULT_DESCRIPTION =
	"Search file contents with a regular expression across the virtual filesystem. Supports filtering by glob, case-insensitive matching, and three output modes: `files_with_matches` (default), `count`, `content`.";

const inputSchema = z.object({
	pattern: z.string().min(1),
	path: z.string().optional(),
	glob: z.string().optional(),
	output_mode: z.enum(["files_with_matches", "count", "content"]).default("files_with_matches"),
	case_insensitive: z.boolean().optional(),
	multiline: z.boolean().optional(),
	head_limit: z.number().int().positive().optional(),
});

type GrepToolInput = z.infer<typeof inputSchema>;

export class GrepTool extends Tool<GrepToolInput, GrepToolResult> {
	readonly id: string;
	readonly description: string;
	readonly schema = inputSchema;
	private readonly fs: IFileSystem;
	private readonly defaultGlob: string;
	private readonly maxFileBytes: number;

	constructor(options: GrepToolOptions) {
		super();
		this.id = options.id ?? "grep";
		this.description = options.description ?? DEFAULT_DESCRIPTION;
		this.fs = options.fs;
		this.defaultGlob = options.defaultGlob ?? "**/*";
		this.maxFileBytes = options.maxFileBytes ?? 1_000_000;
	}

	async run(inputs: GrepToolInput): Promise<ToolResult<GrepToolResult>> {
		try {
			const flags = `g${inputs.case_insensitive ? "i" : ""}${inputs.multiline ? "s" : ""}`;
			let regex: RegExp;
			try {
				regex = new RegExp(inputs.pattern, flags);
			} catch (e) {
				return {
					ok: false,
					error: {
						code: "invalid_input",
						message: `Invalid regex: ${e instanceof Error ? e.message : String(e)}`,
						issues: [],
					},
				};
			}

			const pattern = inputs.glob ?? this.defaultGlob;
			const candidates = this.fs.glob(pattern, { cwd: inputs.path });
			const files = candidates.filter((p) => {
				try {
					const stat = this.fs.stat(p);
					return stat.isFile() && stat.size <= this.maxFileBytes;
				} catch {
					return false;
				}
			});

			if (inputs.output_mode === "files_with_matches") {
				const hits: string[] = [];
				for (const f of files) {
					const content = this.fs.readFile(f);
					if (regex.test(content)) {
						hits.push(f);
						if (inputs.head_limit && hits.length >= inputs.head_limit) break;
					}
				}
				return {
					ok: true,
					value: {
						output_mode: "files_with_matches",
						matches: hits,
						count: hits.length,
					},
				};
			}

			if (inputs.output_mode === "count") {
				const counts: Array<{ path: string; count: number }> = [];
				let total = 0;
				for (const f of files) {
					const content = this.fs.readFile(f);
					const matches = Array.from(content.matchAll(regex));
					if (matches.length > 0) {
						counts.push({ path: f, count: matches.length });
						total += matches.length;
					}
				}
				if (inputs.head_limit) counts.splice(inputs.head_limit);
				return {
					ok: true,
					value: { output_mode: "count", counts, total },
				};
			}

			const matches: GrepMatch[] = [];
			let truncated = false;
			const lineRegex = new RegExp(inputs.pattern, inputs.case_insensitive ? "i" : "");
			for (const f of files) {
				const content = this.fs.readFile(f);
				const lines = content.split("\n");
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i] ?? "";
					if (lineRegex.test(line)) {
						matches.push({ path: f, line: i + 1, text: line });
						if (inputs.head_limit && matches.length >= inputs.head_limit) {
							truncated = true;
							break;
						}
					}
				}
				if (truncated) break;
			}
			return {
				ok: true,
				value: {
					output_mode: "content",
					matches,
					count: matches.length,
					truncated,
				},
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
