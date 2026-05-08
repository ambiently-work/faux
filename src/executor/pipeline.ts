import type { IFileSystem } from "@ambiently-work/mirage";
import type { CommandRegistry } from "../commands/registry.js";
import type { CommandContext, CommandTerminalContext } from "../commands/types.js";
import type { Environment } from "../env/environment.js";
import { WritableBuffer } from "../io/stream.js";
import { type AstNode, parse } from "../parser/index.js";
import type { ShellResult } from "../types.js";
import type { SubExecFn } from "./expansion/index.js";

export interface ExecutorContext {
	env: Environment;
	fs: IFileSystem;
	registry: CommandRegistry;
	tty: CommandTerminalContext;
	subExec: SubExecFn;
	executeNode: (node: AstNode, stdin: string) => Promise<ShellResult>;
	/**
	 * Run the given trap by name and return its captured output, or null when
	 * no handler is registered. Used by the function-call path to fire RETURN.
	 */
	fireTrap?: (name: string) => Promise<{ stdout: string; stderr: string } | null>;
	/**
	 * Cancellation signal threaded from `Shell#run({ signal })`. Loop hot spots
	 * (`for`, `while`, `until`, between pipeline stages) check it between
	 * iterations and abort with exit 130. Builtins receive the same signal via
	 * `CommandContext.signal`.
	 */
	signal?: AbortSignal;
	/**
	 * Throws `ShellExit(130)` if `signal` has been aborted, after firing the
	 * `INT` trap once per abort. Pipeline stages call this between commands so
	 * Ctrl-C unwinds at the next stage boundary.
	 */
	checkSignal?: () => Promise<void>;
}

export async function executePipeline(
	commands: AstNode[],
	negated: boolean,
	stdin: string,
	ctx: ExecutorContext,
): Promise<ShellResult> {
	let currentStdin = stdin;
	let lastResult: ShellResult = { stdout: "", stderr: "", exitCode: 0 };
	const exitCodes: number[] = [];
	const baseIsatty = { ...ctx.tty.isatty };

	for (let i = 0; i < commands.length; i++) {
		if (ctx.checkSignal) {
			await ctx.checkSignal();
		} else if (ctx.signal?.aborted) {
			throw new ShellExit(130, lastResult.stdout, lastResult.stderr);
		}
		ctx.tty.isatty.stdin = i === 0 ? baseIsatty.stdin : false;
		ctx.tty.isatty.stdout = i === commands.length - 1 ? baseIsatty.stdout : false;
		ctx.tty.isatty.stderr = baseIsatty.stderr;

		try {
			lastResult = await ctx.executeNode(commands[i], currentStdin);
			currentStdin = lastResult.stdout;
			exitCodes.push(lastResult.exitCode);
		} finally {
			Object.assign(ctx.tty.isatty, baseIsatty);
		}
	}

	// Pipefail: return the rightmost non-zero exit code instead of just the last
	// stage's. Off by default; controlled by `set -o pipefail`.
	if (ctx.env.hasOption("pipefail")) {
		for (let i = exitCodes.length - 1; i >= 0; i--) {
			const code = exitCodes[i];
			if (code !== undefined && code !== 0) {
				lastResult = { ...lastResult, exitCode: code };
				break;
			}
		}
	}

	if (negated) {
		lastResult = {
			...lastResult,
			exitCode: lastResult.exitCode === 0 ? 1 : 0,
		};
	}

	return lastResult;
}

const SHELL_INTERPRETERS = new Set(["sh", "bash", "dash", "ash", "ksh", "zsh"]);

/**
 * Resolve `name` to a script path either via direct path resolution (when it
 * contains `/`) or by walking `$PATH`. Returns `null` if no candidate matches.
 */
function resolveScriptPath(name: string, ctx: ExecutorContext): string | null {
	const cwd = ctx.env.cwd;
	const resolveAgainstCwd = (p: string): string => {
		if (p.startsWith("/")) return p;
		return cwd === "/" ? `/${p}` : `${cwd}/${p}`;
	};

	if (name.includes("/")) {
		const candidate = resolveAgainstCwd(name);
		return ctx.fs.exists(candidate) ? candidate : null;
	}

	const pathStr = ctx.env.get("PATH") ?? "";
	for (const dir of pathStr.split(":")) {
		if (!dir) continue;
		const candidate = dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
		try {
			if (ctx.fs.exists(candidate)) return candidate;
		} catch {
			// Some dirs in PATH may not exist — skip.
		}
	}
	return null;
}

/**
 * Try to load `name` from the VFS as an executable script. Returns the result
 * of executing it, or `null` if no candidate could be resolved (so the caller
 * falls through to the standard `command not found` error).
 *
 * Honors:
 *   - The execute bit on the file (`mode & 0o111`); rejects with exit 126 if
 *     the file exists but isn't executable.
 *   - `#!interpreter` shebangs for the known POSIX shells. Anything else
 *     surfaces as `bad interpreter: ...: not found` with exit 126.
 *   - Files without a shebang are parsed and run as shell input (matching bash).
 */
async function tryExecuteScript(
	name: string,
	args: string[],
	stdin: string,
	ctx: ExecutorContext,
): Promise<ShellResult | null> {
	const path = resolveScriptPath(name, ctx);
	if (!path) return null;

	let mode = 0;
	try {
		mode = ctx.fs.stat(path).mode;
	} catch {
		return null;
	}

	if ((mode & 0o111) === 0) {
		return {
			stdout: "",
			stderr: `${name}: Permission denied\n`,
			exitCode: 126,
		};
	}

	let content: string;
	try {
		content = ctx.fs.readFile(path);
	} catch {
		return null;
	}

	let body = content;
	if (content.startsWith("#!")) {
		const newlineIdx = content.indexOf("\n");
		const shebang = newlineIdx === -1 ? content : content.slice(0, newlineIdx);
		body = newlineIdx === -1 ? "" : content.slice(newlineIdx + 1);

		const interpreterArgs = shebang.slice(2).trim().split(/\s+/);
		// Shebangs commonly use `/usr/bin/env <interp>`; peel that wrapper off.
		let interpName: string | undefined;
		const first = interpreterArgs[0];
		if (first && (first === "/usr/bin/env" || first.endsWith("/env"))) {
			interpName = interpreterArgs[1];
		} else if (first) {
			interpName = first.includes("/") ? first.split("/").pop() : first;
		}

		if (!interpName || !SHELL_INTERPRETERS.has(interpName)) {
			return {
				stdout: "",
				stderr: `${name}: bad interpreter: ${interpName ?? shebang}: not found\n`,
				exitCode: 126,
			};
		}
	}

	// Run the body with the script's positional args swapped in. The argument
	// representing the script itself is conventionally `$0`; we set positional
	// args 1..N from `args`.
	const oldArgs = ctx.env.positionalArgs;
	const oldShellName = ctx.env.shellName;
	ctx.env.positionalArgs = args;
	ctx.env.shellName = name;
	try {
		const ast = parse(body);
		return await ctx.executeNode(ast, stdin);
	} finally {
		ctx.env.positionalArgs = oldArgs;
		ctx.env.shellName = oldShellName;
	}
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
				const result = await ctx.executeNode(func as AstNode, stdin);
				const ret = ctx.fireTrap ? await ctx.fireTrap("RETURN") : null;
				if (!ret) return result;
				return {
					stdout: result.stdout + ret.stdout,
					stderr: result.stderr + ret.stderr,
					exitCode: result.exitCode,
				};
			} finally {
				ctx.env.positionalArgs = oldArgs;
			}
		}

		// Last resort: try to run a VFS-resident executable script.
		const scriptResult = await tryExecuteScript(name, args, stdin, ctx);
		if (scriptResult) return scriptResult;

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
		isatty: ctx.tty.isatty,
		term: ctx.tty.term,
		stdout,
		stderr,
		resolve: resolvePath,
		subExec: async (cmd: string) => {
			const ast = parse(cmd);
			return ctx.executeNode(ast, "");
		},
		signal: ctx.signal,
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
			// Re-throw with any captured output attached so the outer executor's
			// catch (and any EXIT trap) gets a chance to run. Subshells and the
			// top-level `Executor.execute` still convert this back into a
			// `ShellResult` at the appropriate boundary.
			throw new ShellExit(e.code, stdout.toString() + e.stdout, stderr.toString() + e.stderr);
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
