import type { IFileSystem } from "@ambiently-work/mirage";
import { dirname } from "@ambiently-work/mirage";
import { z } from "zod";
import { Tool, type ToolResult } from "./tools.js";

export interface WriteToolOptions {
	id?: string;
	description?: string;
	fs: IFileSystem;
	/** If true, create parent directories as needed. Defaults to `true`. */
	createDirs?: boolean;
}

export interface WriteToolResult {
	path: string;
	bytesWritten: number;
	created: boolean;
}

const DEFAULT_DESCRIPTION =
	"Write content to a file in the virtual filesystem, overwriting existing files. Parent directories are created automatically.";

const inputSchema = z.object({
	path: z.string().min(1),
	content: z.string(),
});

type WriteToolInput = z.infer<typeof inputSchema>;

export class WriteTool extends Tool<WriteToolInput, WriteToolResult> {
	readonly id: string;
	readonly description: string;
	readonly schema = inputSchema;
	private readonly fs: IFileSystem;
	private readonly createDirs: boolean;

	constructor(options: WriteToolOptions) {
		super();
		this.id = options.id ?? "write";
		this.description = options.description ?? DEFAULT_DESCRIPTION;
		this.fs = options.fs;
		this.createDirs = options.createDirs !== false;
	}

	async run(inputs: WriteToolInput): Promise<ToolResult<WriteToolResult>> {
		try {
			const existed = this.fs.exists(inputs.path);
			if (existed && this.fs.stat(inputs.path).isDirectory()) {
				return {
					ok: false,
					error: {
						code: "tool_failed",
						message: `Path is a directory: ${inputs.path}`,
					},
				};
			}
			if (this.createDirs) {
				const parent = dirname(inputs.path);
				if (parent && !this.fs.exists(parent)) {
					this.fs.mkdir(parent, { recursive: true });
				}
			}
			this.fs.writeFile(inputs.path, inputs.content);
			return {
				ok: true,
				value: {
					path: inputs.path,
					bytesWritten: inputs.content.length,
					created: !existed,
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
