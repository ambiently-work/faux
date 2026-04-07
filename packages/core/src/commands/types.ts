import type { Environment } from "../env/environment.js";
import type { IFileSystem } from "../vfs/types.js";
import type { WritableBuffer } from "../io/stream.js";

export interface CommandContext {
	/** Arguments passed to the command (argv[1:]) */
	args: string[];
	/** Standard input content */
	stdin: string;
	/** Environment variables (read/write) */
	env: Environment;
	/** Virtual filesystem access */
	fs: IFileSystem;
	/** Current working directory */
	cwd: string;
	/** Write to stdout */
	stdout: WritableBuffer;
	/** Write to stderr */
	stderr: WritableBuffer;
	/** Resolve a path relative to cwd */
	resolve(path: string): string;
	/** Run a sub-command (for source, eval, etc.) */
	subExec(command: string): Promise<ShellSubExecResult>;
}

export interface ShellSubExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface CommandHandler {
	name: string;
	execute(ctx: CommandContext): number | Promise<number>;
}
