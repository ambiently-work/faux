import type { IFileSystem } from "@ambiently-work/mirage";
import { z } from "zod";
import { Tool, type ToolResult } from "./tools.js";

export interface ReadToolOptions {
	id?: string;
	description?: string;
	fs: IFileSystem;
	/** Default maximum number of lines to read when `limit` is omitted. */
	defaultLimit?: number;
	/** Maximum bytes returned per line (longer lines are truncated). */
	maxLineLength?: number;
}

export interface ReadToolResult {
	/** File content formatted like `cat -n` (line numbers, tab separator). */
	content: string;
	/** Actual line count returned. */
	lines: number;
	/** Total lines in the file (may exceed `lines`). */
	totalLines: number;
	/** Whether the returned view was truncated at `limit`. */
	truncated: boolean;
}

const DEFAULT_DESCRIPTION =
	"Read a file from the virtual filesystem. Returns content formatted with line numbers like `cat -n`. Supports `offset`/`limit` for paginating through large files.";

const inputSchema = z.object({
	path: z.string().min(1),
	offset: z.number().int().nonnegative().optional(),
	limit: z.number().int().positive().optional(),
});

type ReadToolInput = z.infer<typeof inputSchema>;

export class ReadTool extends Tool<ReadToolInput, ReadToolResult> {
	readonly id: string;
	readonly description: string;
	readonly schema = inputSchema;
	private readonly fs: IFileSystem;
	private readonly defaultLimit: number;
	private readonly maxLineLength: number;

	constructor(options: ReadToolOptions) {
		super();
		this.id = options.id ?? "read";
		this.description = options.description ?? DEFAULT_DESCRIPTION;
		this.fs = options.fs;
		this.defaultLimit = options.defaultLimit ?? 2000;
		this.maxLineLength = options.maxLineLength ?? 2000;
	}

	async run(inputs: ReadToolInput): Promise<ToolResult<ReadToolResult>> {
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
			const stat = this.fs.stat(inputs.path);
			if (stat.isDirectory()) {
				return {
					ok: false,
					error: {
						code: "tool_failed",
						message: `Path is a directory: ${inputs.path}`,
					},
				};
			}
			const raw = this.fs.readFile(inputs.path);
			const allLines = raw.split("\n");
			const totalLines =
				raw.length > 0 && raw.endsWith("\n") ? allLines.length - 1 : allLines.length;
			const offset = inputs.offset ?? 0;
			const limit = inputs.limit ?? this.defaultLimit;
			const slice = allLines.slice(offset, offset + limit);

			const width = String(offset + slice.length).length;
			const formatted = slice
				.map((line, i) => {
					const num = String(offset + i + 1).padStart(width, " ");
					const truncated =
						line.length > this.maxLineLength ? `${line.slice(0, this.maxLineLength)}…` : line;
					return `${num}\t${truncated}`;
				})
				.join("\n");

			return {
				ok: true,
				value: {
					content: formatted,
					lines: slice.length,
					totalLines,
					truncated: offset + slice.length < totalLines,
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
