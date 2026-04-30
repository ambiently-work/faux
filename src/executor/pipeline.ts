import type { IFileSystem } from "@ambiently-work/mirage";
import type { CommandRegistry } from "../commands/registry.js";
import type { CommandContext } from "../commands/types.js";
import type { Environment } from "../env/environment.js";
import { WritableBuffer } from "../io/stream.js";
import { type AstNode, parse } from "../parser/index.js";
import type { ShellResult } from "../types.js";
import type { SubExecFn } from "./expansion/index.js";

export interface ExecutorContext {
	env: Environment;
	fs: IFileSystem;
	registry: CommandRegistry;
	subExec: SubExecFn;
	executeNode: (node: AstNode, stdin: string) => Promise<ShellResult>;
}

export async function executePipeline(
	commands: AstNode[],
	negated: boolean,
	stdin: string,
	ctx: ExecutorContext,
): Promise<ShellResult> {
	let currentStdin = stdin;
	let lastResult: ShellResult = { stdout: "", stderr: "", exitCode: 0 };

	for (let i = 0; i < commands.length; i++) {
		lastResult = await ctx.executeNode(commands[i], currentStdin);
		currentStdin = lastResult.stdout;
	}

	if (negated) {
		lastResult = {
			...lastResult,
			exitCode: lastResult.exitCode === 0 ? 1 : 0,
		};
	}

	return lastResult;
}

export async function executeCommand(
	name: string,
	args: string[],
	stdin: string,
	redirects: Array<{ fd: number; op: string; target: string }>,
	ctx: ExecutorContext,
): Promise<ShellResult> {
	const stdout = new WritableBuffer();
	const stderr = new WritableBuffer();

	const handler = ctx.registry.get(name);
	if (!handler) {
		// Check if it's a function
		const func = ctx.env.getFunction(name);
		if (func) {
			const oldArgs = ctx.env.positionalArgs;
			ctx.env.positionalArgs = args;
			try {
				return await ctx.executeNode(func as AstNode, stdin);
			} finally {
				ctx.env.positionalArgs = oldArgs;
			}
		}

		stderr.writeln(`${name}: command not found`);
		return { stdout: "", stderr: stderr.toString(), exitCode: 127 };
	}

	const resolvePath = (p: string): string => {
		if (p.startsWith("/")) return p;
		const cwd = ctx.env.cwd;
		if (cwd === "/") return `/${p}`;
		return `${cwd}/${p}`;
	};

	const cmdCtx: CommandContext = {
		args,
		stdin,
		env: ctx.env,
		fs: ctx.fs,
		cwd: ctx.env.cwd,
		stdout,
		stderr,
		resolve: resolvePath,
		subExec: async (cmd: string) => {
			const ast = parse(cmd);
			return ctx.executeNode(ast, "");
		},
	};

	try {
		const exitCode = await handler.execute(cmdCtx);

		// Apply redirects left-to-right with POSIX fd-table semantics.
		//
		// Each fd tracks where its output will ultimately land via object identity:
		//   BufferTarget  — content stays in the returned stdout/stderr string
		//   FileTarget    — content is written/appended to a file path
		//
		// fd-duplicate operators (>&, 2>&1) copy the *current* target object of the
		// source fd into the destination fd at the time the operator is evaluated.
		// This is the key POSIX invariant: `> file 2>&1` redirects fd2 to the file
		// because fd1 already points there when `2>&1` is evaluated.

		type BufferTarget = { kind: "buffer" };
		type FileTarget = { kind: "file"; path: string; append: boolean };
		type FdTarget = BufferTarget | FileTarget;

		const stdoutTarget: BufferTarget = { kind: "buffer" };
		const stderrTarget: BufferTarget = { kind: "buffer" };

		const fdTable: Record<number, FdTarget> = {
			1: stdoutTarget,
			2: stderrTarget,
		};

		// Apply shell-level persistent fd overrides (set by `exec REDIRS`) before
		// per-command redirects so each command inherits the shell's fd state.
		const allRedirects = [...ctx.env.persistentFdOverrides, ...redirects];

		for (const redirect of allRedirects) {
			if (redirect.op === ">" || redirect.op === ">>") {
				const fd = redirect.fd === -1 ? 1 : redirect.fd;
				fdTable[fd] = {
					kind: "file",
					path: resolvePath(redirect.target),
					append: redirect.op === ">>",
				};
			} else if (redirect.op === "&>" || redirect.op === "&>>") {
				// &> is shorthand for > file 2>&1
				const fileTarget: FileTarget = {
					kind: "file",
					path: resolvePath(redirect.target),
					append: redirect.op === "&>>",
				};
				fdTable[1] = fileTarget;
				fdTable[2] = fileTarget;
			} else if (redirect.op === ">&") {
				const srcFd = redirect.fd === -1 ? 1 : redirect.fd;
				const targetFd = Number.parseInt(redirect.target, 10);
				if (!Number.isNaN(targetFd) && fdTable[targetFd] !== undefined) {
					fdTable[srcFd] = fdTable[targetFd];
				}
			}
		}

		const stdoutStr = stdout.toString();
		const stderrStr = stderr.toString();

		// Route each fd's content to its destination.
		// Use a Map keyed by target object identity to combine multiple fds pointing
		// at the same file without double-writing. Always register every file target
		// (even with empty content) so that `> file` creates/truncates the file.
		const fileWrites = new Map<FdTarget, string>();

		const registerFileTarget = (target: FdTarget): void => {
			if (target.kind === "file" && !fileWrites.has(target)) {
				fileWrites.set(target, "");
			}
		};

		const routeFd = (content: string, target: FdTarget): void => {
			if (target.kind !== "file") return;
			fileWrites.set(target, (fileWrites.get(target) ?? "") + content);
		};

		// Register all file targets first so empty redirects still create the file.
		registerFileTarget(fdTable[1]);
		registerFileTarget(fdTable[2]);

		// fd1 is flushed first so that when fd2 === stdoutTarget (via 2>&1 with no
		// prior file redirect), the stderr content lands in the correct return slot.
		routeFd(stdoutStr, fdTable[1]);
		routeFd(stderrStr, fdTable[2]);

		for (const [target, content] of fileWrites) {
			const fileTarget = target as FileTarget;
			if (fileTarget.append) {
				if (content !== "") {
					ctx.fs.appendFile(fileTarget.path, content);
				} else if (!ctx.fs.exists(fileTarget.path)) {
					ctx.fs.writeFile(fileTarget.path, "");
				}
			} else {
				ctx.fs.writeFile(fileTarget.path, content);
			}
		}

		// Build return values based on where each original buffer target now appears.
		// Content goes back to the caller only for fds that still point at a buffer.
		const returnStdout =
			(fdTable[1] === stdoutTarget ? stdoutStr : "") +
			(fdTable[2] === stdoutTarget ? stderrStr : "");
		const returnStderr =
			(fdTable[2] === stderrTarget ? stderrStr : "") +
			(fdTable[1] === stderrTarget ? stdoutStr : "");

		return { stdout: returnStdout, stderr: returnStderr, exitCode };
	} catch (e) {
		if (e instanceof ShellExit) {
			return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: e.code };
		}
		if (e instanceof ShellReturn) {
			return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: e.code };
		}
		if (e instanceof ShellBreak || e instanceof ShellContinue) {
			throw e;
		}
		stderr.writeln(`${name}: ${e instanceof Error ? e.message : String(e)}`);
		return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 1 };
	}
}

export class ShellExit extends Error {
	constructor(
		public code: number,
		public stdout = "",
		public stderr = "",
	) {
		super(`exit ${code}`);
		this.name = "ShellExit";
	}
}

export class ShellReturn extends Error {
	constructor(public code: number) {
		super(`return ${code}`);
		this.name = "ShellReturn";
	}
}

export class ShellBreak extends Error {
	constructor(
		public levels: number = 1,
		public stdout: string = "",
		public stderr: string = "",
	) {
		super("break");
		this.name = "ShellBreak";
	}
}

export class ShellContinue extends Error {
	constructor(
		public levels: number = 1,
		public stdout: string = "",
		public stderr: string = "",
	) {
		super("continue");
		this.name = "ShellContinue";
	}
}
