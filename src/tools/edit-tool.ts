import type { IFileSystem } from "@ambiently-work/mirage";
import { z } from "zod";
import { Tool, type ToolResult } from "./tools.js";

export interface EditToolOptions {
	id?: string;
	description?: string;
	fs: IFileSystem;
}

export interface EditToolResult {
	path: string;
	replacements: number;
}

const DEFAULT_DESCRIPTION =
	"Perform exact string replacement in a file. By default `old_string` must appear exactly once — pass `replace_all: true` to substitute every occurrence.";

const inputSchema = z.object({
	path: z.string().min(1),
	old_string: z.string().min(1),
	new_string: z.string(),
	replace_all: z.boolean().optional(),
});

type EditToolInput = z.infer<typeof inputSchema>;

export class EditTool extends Tool<EditToolInput, EditToolResult> {
	readonly id: string;
	readonly description: string;
	readonly schema = inputSchema;
	private readonly fs: IFileSystem;

	constructor(options: EditToolOptions) {
		super();
		this.id = options.id ?? "edit";
		this.description = options.description ?? DEFAULT_DESCRIPTION;
		this.fs = options.fs;
	}

	async run(inputs: EditToolInput): Promise<ToolResult<EditToolResult>> {
		try {
			if (inputs.old_string === inputs.new_string) {
				return {
					ok: false,
					error: {
						code: "tool_failed",
						message: "`old_string` and `new_string` must differ",
					},
				};
			}
			if (!this.fs.exists(inputs.path)) {
				return {
					ok: false,
					error: {
						code: "tool_failed",
						message: `File not found: ${inputs.path}`,
					},
				};
			}
			const content = this.fs.readFile(inputs.path);
			const occurrences = countOccurrences(content, inputs.old_string);
			if (occurrences === 0) {
				return {
					ok: false,
					error: {
						code: "tool_failed",
						message: `\`old_string\` not found in ${inputs.path}`,
					},
				};
			}
			if (!inputs.replace_all && occurrences > 1) {
				return {
					ok: false,
					error: {
						code: "tool_failed",
						message: `\`old_string\` appears ${occurrences} times in ${inputs.path} — pass replace_all: true or provide a more specific string`,
					},
				};
			}
			const next = inputs.replace_all
				? content.split(inputs.old_string).join(inputs.new_string)
				: content.replace(inputs.old_string, inputs.new_string);
			this.fs.writeFile(inputs.path, next);
			return {
				ok: true,
				value: {
					path: inputs.path,
					replacements: inputs.replace_all ? occurrences : 1,
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

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let idx = 0;
	while (true) {
		const found = haystack.indexOf(needle, idx);
		if (found === -1) break;
		count += 1;
		idx = found + needle.length;
	}
	return count;
}
