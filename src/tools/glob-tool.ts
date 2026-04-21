import type { IFileSystem } from "@ambiently-work/mirage";
import { z } from "zod";
import { Tool, type ToolResult } from "./tools.js";

export interface GlobToolOptions {
	id?: string;
	description?: string;
	fs: IFileSystem;
}

export interface GlobToolResult {
	matches: string[];
	count: number;
}

const DEFAULT_DESCRIPTION =
	"Find files matching a glob pattern (e.g. `**/*.ts`). Returns matching paths sorted by modification time (newest first).";

const inputSchema = z.object({
	pattern: z.string().min(1),
	path: z.string().optional(),
	limit: z.number().int().positive().optional(),
});

type GlobToolInput = z.infer<typeof inputSchema>;

export class GlobTool extends Tool<GlobToolInput, GlobToolResult> {
	readonly id: string;
	readonly description: string;
	readonly schema = inputSchema;
	private readonly fs: IFileSystem;

	constructor(options: GlobToolOptions) {
		super();
		this.id = options.id ?? "glob";
		this.description = options.description ?? DEFAULT_DESCRIPTION;
		this.fs = options.fs;
	}

	async run(inputs: GlobToolInput): Promise<ToolResult<GlobToolResult>> {
		try {
			const matches = this.fs.glob(inputs.pattern, { cwd: inputs.path });
			const sorted = sortByMtimeDesc(this.fs, matches);
			const limited = inputs.limit ? sorted.slice(0, inputs.limit) : sorted;
			return {
				ok: true,
				value: { matches: limited, count: limited.length },
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

function sortByMtimeDesc(fs: IFileSystem, paths: string[]): string[] {
	const stamped = paths.map((p) => {
		try {
			return { path: p, mtime: fs.stat(p).mtime };
		} catch {
			return { path: p, mtime: 0 };
		}
	});
	stamped.sort((a, b) => b.mtime - a.mtime);
	return stamped.map((s) => s.path);
}
