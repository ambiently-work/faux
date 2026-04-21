import type { IFileSystem } from "@ambiently-work/mirage";
import type { BiomeInstance } from "../commands/builtins/biome.js";
import { EditTool } from "./edit-tool.js";
import { GlobTool } from "./glob-tool.js";
import { GrepTool } from "./grep-tool.js";
import { LsTool } from "./ls-tool.js";
import { LspTool } from "./lsp-tool.js";
import { ReadTool } from "./read-tool.js";
import type { ShellSession } from "./shell-session.js";
import { ShellTool } from "./shell-tool.js";
import { type Tool, ToolRegistry } from "./tools.js";
import { WriteTool } from "./write-tool.js";

export { EditTool, type EditToolOptions, type EditToolResult } from "./edit-tool.js";
export { GlobTool, type GlobToolOptions, type GlobToolResult } from "./glob-tool.js";
export {
	type GrepMatch,
	GrepTool,
	type GrepToolOptions,
	type GrepToolResult,
} from "./grep-tool.js";
export { type LsEntry, LsTool, type LsToolOptions, type LsToolResult } from "./ls-tool.js";
export {
	type LspDiagnostic,
	LspTool,
	type LspToolOptions,
	type LspToolResult,
} from "./lsp-tool.js";
export { ReadTool, type ReadToolOptions, type ReadToolResult } from "./read-tool.js";
export { ShellSession } from "./shell-session.js";
export { ShellTool, type ShellToolOptions } from "./shell-tool.js";
export {
	type Result,
	Tool,
	type ToolCall,
	type ToolError,
	ToolRegistry,
	type ToolResult,
} from "./tools.js";
export { WriteTool, type WriteToolOptions, type WriteToolResult } from "./write-tool.js";

export interface DefaultToolsOptions {
	/** Virtual filesystem used by file tools. */
	fs: IFileSystem;
	/** Optional shared shell session for the shell tool. */
	session?: ShellSession;
	/** Optional Biome instance — enables the LSP tool when provided. */
	biome?: BiomeInstance;
	/** Optional path to a biome config file in the VFS. */
	biomeConfigPath?: string;
	/** Override ids (e.g. rename "shell" to "bash"). */
	ids?: Partial<{
		shell: string;
		read: string;
		write: string;
		edit: string;
		glob: string;
		grep: string;
		ls: string;
		lsp: string;
	}>;
}

/**
 * Build a {@link ToolRegistry} with the standard file + shell toolkit wired up
 * to a shared virtual filesystem and (optionally) a Biome instance.
 *
 * The registry includes: `shell`, `read`, `write`, `edit`, `glob`, `grep`,
 * `ls`, and — when `biome` is provided — `lsp`.
 */
export function createDefaultTools(options: DefaultToolsOptions): ToolRegistry {
	const ids = options.ids ?? {};
	const session = options.session;
	const tools: Tool[] = [
		new ShellTool({ id: ids.shell, session }),
		new ReadTool({ id: ids.read, fs: options.fs }),
		new WriteTool({ id: ids.write, fs: options.fs }),
		new EditTool({ id: ids.edit, fs: options.fs }),
		new GlobTool({ id: ids.glob, fs: options.fs }),
		new GrepTool({ id: ids.grep, fs: options.fs }),
		new LsTool({ id: ids.ls, fs: options.fs }),
	];
	if (options.biome) {
		tools.push(
			new LspTool({
				id: ids.lsp,
				fs: options.fs,
				biome: options.biome,
				configPath: options.biomeConfigPath,
			}),
		);
	}
	return new ToolRegistry(tools);
}
