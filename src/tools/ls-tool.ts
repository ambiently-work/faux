import type { IFileSystem } from "@ambiently-work/mirage";
import { z } from "zod";
import { Tool, type ToolResult } from "./tools.js";

export interface LsToolOptions {
	id?: string;
	description?: string;
	fs: IFileSystem;
}

export interface LsEntry {
	name: string;
	kind: "file" | "directory" | "symlink";
	size: number;
	mtime: number;
}

export interface LsToolResult {
	path: string;
	entries: LsEntry[];
}

const DEFAULT_DESCRIPTION =
	"List the contents of a directory in the virtual filesystem. Returns each entry's name, kind (file/directory/symlink), size, and mtime.";

const inputSchema = z.object({
	path: z.string().min(1),
});

type LsToolInput = z.infer<typeof inputSchema>;

export class LsTool extends Tool<LsToolInput, LsToolResult> {
	readonly id: string;
	readonly description: string;
	readonly schema = inputSchema;
	private readonly fs: IFileSystem;

	constructor(options: LsToolOptions) {
		super();
		this.id = options.id ?? "ls";
		this.description = options.description ?? DEFAULT_DESCRIPTION;
		this.fs = options.fs;
	}

	async run(inputs: LsToolInput): Promise<ToolResult<LsToolResult>> {
		try {
			if (!this.fs.exists(inputs.path)) {
				return {
					ok: false,
					error: {
						code: "tool_failed",
						message: `Path not found: ${inputs.path}`,
					},
				};
			}
			if (!this.fs.stat(inputs.path).isDirectory()) {
				return {
					ok: false,
					error: {
						code: "tool_failed",
						message: `Path is not a directory: ${inputs.path}`,
					},
				};
			}
			const names = this.fs.readDir(inputs.path).sort();
			const entries: LsEntry[] = [];
			for (const name of names) {
				const child = inputs.path === "/" ? `/${name}` : `${inputs.path}/${name}`;
				try {
					const stat = this.fs.lstat(child);
					entries.push({
						name,
						kind: stat.isDirectory() ? "directory" : stat.isSymlink() ? "symlink" : "file",
						size: stat.size,
						mtime: stat.mtime,
					});
				} catch {
					entries.push({ name, kind: "file", size: 0, mtime: 0 });
				}
			}
			return { ok: true, value: { path: inputs.path, entries } };
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
