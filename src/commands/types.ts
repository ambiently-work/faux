import type { IFileSystem } from "@ambiently-work/mirage";
import type { Environment } from "../env/environment.js";
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
	/** Whether each standard stream is connected to a terminal */
	isatty: CommandIsatty;
	/** Terminal dimensions and type */
	term: CommandTerm;
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

export interface CommandIsatty {
	stdin: boolean;
	stdout: boolean;
	stderr: boolean;
}

export interface CommandTerm {
	cols: number;
	rows: number;
	name: string;
}

export interface CommandTerminalContext {
	isatty: CommandIsatty;
	term: CommandTerm;
}
