import type { AstNode } from "@faux-shell/parser";
import type { Environment } from "../env/environment.js";
import type { IFileSystem } from "../vfs/types.js";
import type { CommandRegistry } from "../commands/registry.js";
import type { ShellResult } from "../types.js";
import { WritableBuffer } from "../io/stream.js";
import type { CommandContext } from "../commands/types.js";
import { expandWord, expandGlob, expandBraces, evaluateArithmetic, type SubExecFn } from "./expansion/index.js";

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
			const result = await ctx.executeNode(func as AstNode, stdin);
			ctx.env.positionalArgs = oldArgs;
			return result;
		}

		stderr.writeln(`${name}: command not found`);
		return { stdout: "", stderr: stderr.toString(), exitCode: 127 };
	}

	const resolvePath = (p: string): string => {
		if (p.startsWith("/")) return p;
		const cwd = ctx.env.cwd;
		if (cwd === "/") return "/" + p;
		return cwd + "/" + p;
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
			// This will be wired up by the Shell class
			const { parse } = await import("@faux-shell/parser");
			const ast = parse(cmd);
			return ctx.executeNode(ast, "");
		},
	};

	try {
		const exitCode = await handler.execute(cmdCtx);

		// Handle redirects: write stdout to file if needed
		let stdoutStr = stdout.toString();
		let stderrStr = stderr.toString();

		for (const redirect of redirects) {
			if (redirect.op === ">" || redirect.op === ">>") {
				const target = resolvePath(redirect.target);
				if (redirect.fd === 1 || redirect.fd === -1) {
					if (redirect.op === ">") {
						ctx.fs.writeFile(target, stdoutStr);
					} else {
						ctx.fs.appendFile(target, stdoutStr);
					}
					stdoutStr = "";
				} else if (redirect.fd === 2) {
					if (redirect.op === ">") {
						ctx.fs.writeFile(target, stderrStr);
					} else {
						ctx.fs.appendFile(target, stderrStr);
					}
					stderrStr = "";
				}
			} else if (redirect.op === "&>" || redirect.op === "&>>") {
				const target = resolvePath(redirect.target);
				const combined = stdoutStr + stderrStr;
				if (redirect.op === "&>") {
					ctx.fs.writeFile(target, combined);
				} else {
					ctx.fs.appendFile(target, combined);
				}
				stdoutStr = "";
				stderrStr = "";
			} else if (redirect.op === ">&") {
				const targetFd = Number.parseInt(redirect.target, 10);
				if (redirect.fd === 2 && targetFd === 1) {
					// 2>&1: merge stderr into stdout
					stdoutStr += stderrStr;
					stderrStr = "";
				} else if ((redirect.fd === 1 || redirect.fd === -1) && targetFd === 2) {
					// >&2 or 1>&2: merge stdout into stderr
					stderrStr += stdoutStr;
					stdoutStr = "";
				}
			}
		}

		return { stdout: stdoutStr, stderr: stderrStr, exitCode };
	} catch (e) {
		if (e instanceof ShellExit) {
			return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: e.code };
		}
		if (e instanceof ShellReturn) {
			return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: e.code };
		}
		stderr.writeln(`${name}: ${e instanceof Error ? e.message : String(e)}`);
		return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 1 };
	}
}

export class ShellExit extends Error {
	constructor(public code: number) {
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
