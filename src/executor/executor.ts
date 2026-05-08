import type { IFileSystem } from "@ambiently-work/mirage";
import type { CommandRegistry } from "../commands/registry.js";
import type { CommandTerminalContext } from "../commands/types.js";
import type { Environment } from "../env/environment.js";
import {
	type ArithmeticNode,
	type AssignmentNode,
	type AstNode,
	type BraceGroupNode,
	type CaseNode,
	type CommandNode,
	type ForNode,
	type FunctionNode,
	type IfNode,
	type ListNode,
	type PipelineNode,
	parse,
	type SelectNode,
	type SubshellNode,
	type UntilNode,
	type WhileNode,
	type Word,
} from "../parser/index.js";
import type { ShellResult } from "../types.js";
import {
	evaluateArithmetic,
	expandGlob,
	expandWord,
	expandWordToFields,
} from "./expansion/index.js";
import { UnboundVariableError } from "./expansion/parameter.js";
import {
	type ExecutorContext,
	executeCommand,
	executePipeline,
	ShellBreak,
	ShellContinue,
	ShellExit,
	ShellReturn,
} from "./pipeline.js";
import { applyInputRedirect, getOutputRedirects, resolveRedirects } from "./redirect.js";

export class Executor {
	private env: Environment;
	private fs: IFileSystem;
	private registry: CommandRegistry;
	private tty: CommandTerminalContext;
	/**
	 * Counts how deep we are inside a context that suppresses `set -e`. A
	 * non-zero depth means we're evaluating a "test" position — `if`/`while`/
	 * `until` condition, the non-final operand of `&&`/`||`, or the body of a
	 * `!`-negated pipeline. POSIX exempts these from errexit so that flow control
	 * keeps working with `-e` set.
	 */
	private errexitSuppressDepth: number = 0;

	/**
	 * Set while the executor is running a trap handler — used to suppress
	 * recursive trap dispatch so DEBUG/ERR firing inside the handler doesn't
	 * loop back into itself.
	 */
	private inTrapHandler: boolean = false;

	constructor(
		env: Environment,
		fs: IFileSystem,
		registry: CommandRegistry,
		tty: CommandTerminalContext = defaultTerminalContext(),
	) {
		this.env = env;
		this.fs = fs;
		this.registry = registry;
		this.tty = tty;
	}

	async execute(node: AstNode, stdin = ""): Promise<ShellResult> {
		try {
			const result = await this.executeNode(node, stdin);
			this.env.lastExitCode = result.exitCode;
			return result;
		} catch (e) {
			if (e instanceof ShellExit) {
				const exitTrap = await this.fireTrap("EXIT").catch(() => null);
				return {
					stdout: e.stdout + (exitTrap?.stdout ?? ""),
					stderr: e.stderr + (exitTrap?.stderr ?? ""),
					exitCode: e.code,
				};
			}
			if (e instanceof ShellReturn) {
				return { stdout: "", stderr: "", exitCode: e.code };
			}
			if (e instanceof ShellBreak) {
				return {
					stdout: "",
					stderr: "break: only meaningful in a `for', `while', `until', or `select' loop\n",
					exitCode: 1,
				};
			}
			if (e instanceof ShellContinue) {
				return {
					stdout: "",
					stderr: "continue: only meaningful in a `for', `while', `until', or `select' loop\n",
					exitCode: 1,
				};
			}
			if (e instanceof UnboundVariableError) {
				this.env.lastExitCode = 1;
				return { stdout: "", stderr: `${e.message}\n`, exitCode: 1 };
			}
			throw e;
		}
	}

	/**
	 * Run `fn` with `set -e` suppressed — used to evaluate condition expressions
	 * (if/while/until/the test side of `&&`/`||`) where bash exempts a failing
	 * command from triggering errexit. Always restores depth in `finally`.
	 */
	private async withErrexitSuppressed<T>(fn: () => Promise<T>): Promise<T> {
		this.errexitSuppressDepth++;
		try {
			return await fn();
		} finally {
			this.errexitSuppressDepth--;
		}
	}

	private maybeFireErrexit(result: ShellResult): void {
		if (result.exitCode === 0) return;
		if (this.errexitSuppressDepth > 0) return;
		if (!this.env.hasOption("errexit")) return;
		throw new ShellExit(result.exitCode, "", "");
	}

	/**
	 * Look up `name` in the trap table stored at `\$_TRAPS` and run its handler
	 * if present. Returns the handler's stdout/stderr (concatenated to the
	 * caller) so EXIT/ERR/DEBUG output reaches the user. Errors inside the
	 * handler that aren't `ShellExit` are swallowed — bash's behavior — so a
	 * broken trap doesn't take down unrelated cleanup.
	 */
	private async fireTrap(name: string): Promise<{ stdout: string; stderr: string } | null> {
		if (this.inTrapHandler) return null;
		const trapsStr = this.env.get("_TRAPS") ?? "";
		if (!trapsStr) return null;
		let traps: Record<string, string>;
		try {
			traps = JSON.parse(trapsStr) as Record<string, string>;
		} catch {
			return null;
		}
		const handler = traps[name];
		if (!handler) return null;

		this.inTrapHandler = true;
		try {
			const ast = parse(handler);
			const result = await this.executeNode(ast, "");
			return { stdout: result.stdout, stderr: result.stderr };
		} catch (e) {
			// `exit` inside an EXIT trap is rare but legal — let it propagate so the
			// outer execute() can still surface the right exit code.
			if (e instanceof ShellExit) throw e;
			return null;
		} finally {
			this.inTrapHandler = false;
		}
	}

	private async executeNode(node: AstNode, stdin: string): Promise<ShellResult> {
		switch (node.type) {
			case "command":
				return this.executeCommandNode(node, stdin);
			case "pipeline":
				return this.executePipelineNode(node, stdin);
			case "list":
				return this.executeListNode(node, stdin);
			case "subshell":
				return this.executeSubshellNode(node, stdin);
			case "braceGroup":
				return this.executeBraceGroupNode(node, stdin);
			case "assignment":
				return this.executeAssignmentNode(node);
			case "if":
				return this.executeIfNode(node, stdin);
			case "for":
				return this.executeForNode(node, stdin);
			case "while":
				return this.executeWhileNode(node, stdin);
			case "until":
				return this.executeUntilNode(node, stdin);
			case "case":
				return this.executeCaseNode(node, stdin);
			case "select":
				return this.executeSelectNode(node, stdin);
			case "function":
				return this.executeFunctionNode(node);
			case "arithmetic":
				return this.executeArithmeticNode(node);
			default:
				return { stdout: "", stderr: `Unknown node type: ${(node as AstNode).type}`, exitCode: 1 };
		}
	}

	private _execCtx: ExecutorContext | null = null;

	private getExecCtx(): ExecutorContext {
		if (!this._execCtx) {
			this._execCtx = {
				env: this.env,
				fs: this.fs,
				registry: this.registry,
				tty: this.tty,
				subExec: async (node: AstNode) => {
					const result = await this.executeNode(node, "");
					return { stdout: result.stdout, exitCode: result.exitCode };
				},
				executeNode: (node: AstNode, stdin: string) => this.executeNode(node, stdin),
				fireTrap: (name: string) => this.fireTrap(name),
			};
		}
		return this._execCtx;
	}

	private resolvePath(p: string): string {
		if (p.startsWith("/")) return p;
		const cwd = this.env.cwd;
		if (cwd === "/") return `/${p}`;
		return `${cwd}/${p}`;
	}

	private async expandWordToFieldsList(word: Word): Promise<string[]> {
		return expandWordToFields(word, this.env, this.fs, async (node) => {
			const r = await this.executeNode(node, "");
			return { stdout: r.stdout, exitCode: r.exitCode };
		});
	}

	private async expandWordStr(word: Word): Promise<string> {
		return expandWord(word, this.env, this.fs, async (node) => {
			const r = await this.executeNode(node, "");
			return { stdout: r.stdout, exitCode: r.exitCode };
		});
	}

	private async executeCommandNode(node: CommandNode, stdin: string): Promise<ShellResult> {
		const ctx = this.getExecCtx();

		// DEBUG trap fires before each simple command (skipping when we're already
		// in a trap handler to avoid loops).
		const debugOutput = await this.fireTrap("DEBUG");

		// Handle prefix assignments
		const savedVars: Array<{ name: string; value: string | undefined }> = [];
		for (const assign of node.prefix) {
			const value = await this.expandWordStr(assign.value);
			if (node.name.length > 0) {
				// Temporary assignment for this command
				savedVars.push({ name: assign.name, value: this.env.get(assign.name) });
			}
			this.env.set(assign.name, value);
			if (assign.export) this.env.export(assign.name);
		}

		// If no command name, just assignments
		if (node.name.length === 0) {
			return { stdout: "", stderr: "", exitCode: 0 };
		}

		// Expand command name
		const name = await this.expandWordStr(node.name);

		// Check for alias expansion
		const alias = this.env.getAlias(name);
		if (alias) {
			const aliasedCmd =
				alias +
				" " +
				(await Promise.all(node.args.map((a: Word) => this.expandWordStr(a)))).join(" ");
			const ast = parse(aliasedCmd);
			const result = await this.executeNode(ast, stdin);
			// Restore temp vars from prefix assignments
			for (const { name, value } of savedVars) {
				if (value === undefined) {
					this.env.unset(name);
				} else {
					this.env.set(name, value);
				}
			}
			return result;
		}

		// Expand arguments — each word is split on IFS where unquoted, then each
		// resulting field is glob-expanded.
		const expandedArgs: string[] = [];
		for (const arg of node.args) {
			const fields = await this.expandWordToFieldsList(arg);
			for (const field of fields) {
				const globbed = expandGlob(field, this.fs, this.env.cwd);
				expandedArgs.push(...globbed);
			}
		}

		// Resolve redirects
		const redirects = await resolveRedirects(node.redirects, this.env, this.fs, async (n) => {
			const r = await this.executeNode(n, "");
			return { stdout: r.stdout, exitCode: r.exitCode };
		});

		// Apply input redirects
		const effectiveStdin = applyInputRedirect(redirects, stdin, this.fs, (p) =>
			this.resolvePath(p),
		);

		const outputRedirects = getOutputRedirects(redirects);

		// exec special handling:
		// - exec REDIRS (no command): persist redirects to the shell's fd table and return.
		// - exec CMD args: run CMD then replace the shell by throwing ShellExit.
		if (name === "exec") {
			if (expandedArgs.length === 0) {
				// Apply redirects to the shell's persistent fd table. Convert > to >> so
				// subsequent commands append to the already-opened file rather than
				// re-truncating it on every invocation.
				for (const r of outputRedirects) {
					const path = this.resolvePath(r.target);
					if (r.op === ">" || r.op === "&>") {
						this.fs.writeFile(path, "");
						const persistOp = r.op === "&>" ? "&>>" : ">>";
						this.env.persistentFdOverrides.push({ fd: r.fd, op: persistOp, target: path });
					} else if (r.op === ">>" || r.op === "&>>") {
						if (!this.fs.exists(path)) this.fs.writeFile(path, "");
						this.env.persistentFdOverrides.push({ fd: r.fd, op: r.op, target: path });
					} else if (r.op === ">&") {
						this.env.persistentFdOverrides.push({ fd: r.fd, op: r.op, target: r.target });
					}
				}
				this.env.lastExitCode = 0;
				return { stdout: "", stderr: "", exitCode: 0 };
			}

			// exec CMD: run command then exit the shell with its status.
			const execResult = await executeCommand(
				expandedArgs[0],
				expandedArgs.slice(1),
				effectiveStdin,
				outputRedirects,
				ctx,
			);
			throw new ShellExit(execResult.exitCode, execResult.stdout, execResult.stderr);
		}

		const cmdResult = await executeCommand(
			name,
			expandedArgs,
			effectiveStdin,
			outputRedirects,
			ctx,
		);

		// Restore temp vars
		for (const { name, value } of savedVars) {
			if (value === undefined) {
				this.env.unset(name);
			} else {
				this.env.set(name, value);
			}
		}

		this.env.lastExitCode = cmdResult.exitCode;

		// ERR trap fires whenever a command returns non-zero (with the same
		// exemptions as errexit). Independent of `set -e`.
		let errOutput: { stdout: string; stderr: string } | null = null;
		if (cmdResult.exitCode !== 0 && this.errexitSuppressDepth === 0) {
			errOutput = await this.fireTrap("ERR");
		}

		const result: ShellResult = {
			stdout: (debugOutput?.stdout ?? "") + cmdResult.stdout + (errOutput?.stdout ?? ""),
			stderr: (debugOutput?.stderr ?? "") + cmdResult.stderr + (errOutput?.stderr ?? ""),
			exitCode: cmdResult.exitCode,
		};

		this.maybeFireErrexit(result);
		return result;
	}

	private async executePipelineNode(node: PipelineNode, stdin: string): Promise<ShellResult> {
		const ctx = this.getExecCtx();
		// Negated pipelines (`! cmd`) are exempt from errexit even if the inner
		// pipeline exit is non-zero after flipping. Suppress while running so the
		// per-command checks inside also stay quiet.
		const result = node.negated
			? await this.withErrexitSuppressed(() =>
					executePipeline(node.commands, node.negated, stdin, ctx),
				)
			: await executePipeline(node.commands, node.negated, stdin, ctx);
		this.env.lastExitCode = result.exitCode;
		this.maybeFireErrexit(result);
		return result;
	}

	private async executeListNode(node: ListNode, stdin: string): Promise<ShellResult> {
		// `cmd1 && cmd2` and `cmd1 || cmd2` exempt the left operand from errexit
		// because its exit code is being explicitly tested by the operator.
		const leftSuppressed = node.operator === "&&" || node.operator === "||";
		const leftResult = leftSuppressed
			? await this.withErrexitSuppressed(() => this.executeNode(node.left, stdin))
			: await this.executeNode(node.left, stdin);

		const combine = (right: ShellResult): ShellResult => ({
			stdout: leftResult.stdout + right.stdout,
			stderr: leftResult.stderr + right.stderr,
			exitCode: right.exitCode,
		});

		const runRight = async (): Promise<ShellResult> => {
			try {
				return combine(await this.executeNode(node.right, stdin));
			} catch (e) {
				if (e instanceof ShellBreak) {
					throw new ShellBreak(
						e.levels,
						leftResult.stdout + e.stdout,
						leftResult.stderr + e.stderr,
					);
				}
				if (e instanceof ShellContinue) {
					throw new ShellContinue(
						e.levels,
						leftResult.stdout + e.stdout,
						leftResult.stderr + e.stderr,
					);
				}
				if (e instanceof ShellExit) {
					// Preserve any output already produced by the left side so trap
					// handlers and prior commands aren't dropped when the right side
					// calls `exit`.
					throw new ShellExit(e.code, leftResult.stdout + e.stdout, leftResult.stderr + e.stderr);
				}
				throw e;
			}
		};

		switch (node.operator) {
			case "&&":
				if (leftResult.exitCode === 0) {
					return runRight();
				}
				return leftResult;

			case "||":
				if (leftResult.exitCode !== 0) {
					return runRight();
				}
				return leftResult;

			case ";":
				return runRight();

			case "&":
				// Background: just execute right immediately (no true async in our model)
				return runRight();

			default:
				return leftResult;
		}
	}

	private async executeSubshellNode(node: SubshellNode, stdin: string): Promise<ShellResult> {
		const childEnv = this.env.fork();
		const childExec = new Executor(childEnv, this.fs, this.registry, this.tty);
		return childExec.execute(node.body, stdin);
	}

	private async executeBraceGroupNode(node: BraceGroupNode, stdin: string): Promise<ShellResult> {
		return this.executeNode(node.body, stdin);
	}

	private async executeAssignmentNode(node: AssignmentNode): Promise<ShellResult> {
		const value = await this.expandWordStr(node.value);

		if (node.append) {
			const existing = this.env.get(node.name) ?? "";
			this.env.set(node.name, existing + value);
		} else {
			this.env.set(node.name, value);
		}

		if (node.export) this.env.export(node.name);
		if (node.readonly) this.env.markReadonly(node.name);

		return { stdout: "", stderr: "", exitCode: 0 };
	}

	private async executeIfNode(node: IfNode, stdin: string): Promise<ShellResult> {
		let allStdout = "";
		let allStderr = "";

		for (const clause of node.clauses) {
			// `if`/`elif` conditions are POSIX-exempt from errexit.
			const condResult = await this.withErrexitSuppressed(() =>
				this.executeNode(clause.condition, stdin),
			);
			allStdout += condResult.stdout;
			allStderr += condResult.stderr;
			if (condResult.exitCode === 0) {
				const bodyResult = await this.executeNode(clause.body, stdin);
				return {
					stdout: allStdout + bodyResult.stdout,
					stderr: allStderr + bodyResult.stderr,
					exitCode: bodyResult.exitCode,
				};
			}
		}

		if (node.elseBody) {
			const elseResult = await this.executeNode(node.elseBody, stdin);
			return {
				stdout: allStdout + elseResult.stdout,
				stderr: allStderr + elseResult.stderr,
				exitCode: elseResult.exitCode,
			};
		}

		return { stdout: allStdout, stderr: allStderr, exitCode: 0 };
	}

	private async executeForNode(node: ForNode, stdin: string): Promise<ShellResult> {
		let words: string[];

		if (node.words) {
			words = [];
			for (const w of node.words) {
				const fields = await this.expandWordToFieldsList(w);
				for (const field of fields) {
					const globbed = expandGlob(field, this.fs, this.env.cwd);
					words.push(...globbed);
				}
			}
		} else {
			words = this.env.positionalArgs;
		}

		let lastResult: ShellResult = { stdout: "", stderr: "", exitCode: 0 };
		const stdoutParts: string[] = [];
		const stderrParts: string[] = [];

		for (const word of words) {
			this.env.set(node.variable, word);
			try {
				const result = await this.executeNode(node.body, stdin);
				if (result.stdout) stdoutParts.push(result.stdout);
				if (result.stderr) stderrParts.push(result.stderr);
				lastResult = result;
			} catch (e) {
				if (e instanceof ShellBreak) {
					if (e.stdout) stdoutParts.push(e.stdout);
					if (e.stderr) stderrParts.push(e.stderr);
					if (e.levels > 1) {
						throw new ShellBreak(e.levels - 1, stdoutParts.join(""), stderrParts.join(""));
					}
					break;
				}
				if (e instanceof ShellContinue) {
					if (e.stdout) stdoutParts.push(e.stdout);
					if (e.stderr) stderrParts.push(e.stderr);
					if (e.levels > 1) {
						throw new ShellContinue(e.levels - 1, stdoutParts.join(""), stderrParts.join(""));
					}
					continue;
				}
				throw e;
			}
		}

		return {
			stdout: stdoutParts.join(""),
			stderr: stderrParts.join(""),
			exitCode: lastResult.exitCode,
		};
	}

	private async executeWhileNode(node: WhileNode, stdin: string): Promise<ShellResult> {
		let lastResult: ShellResult = { stdout: "", stderr: "", exitCode: 0 };
		const stdoutParts: string[] = [];
		const stderrParts: string[] = [];
		let iterations = 0;
		const maxIterations = 100000;

		while (iterations < maxIterations) {
			// `while` condition is exempt from errexit.
			const condResult = await this.withErrexitSuppressed(() =>
				this.executeNode(node.condition, stdin),
			);
			if (condResult.stdout) stdoutParts.push(condResult.stdout);
			if (condResult.stderr) stderrParts.push(condResult.stderr);
			if (condResult.exitCode !== 0) break;

			try {
				const result = await this.executeNode(node.body, stdin);
				if (result.stdout) stdoutParts.push(result.stdout);
				if (result.stderr) stderrParts.push(result.stderr);
				lastResult = result;
			} catch (e) {
				if (e instanceof ShellBreak) {
					if (e.stdout) stdoutParts.push(e.stdout);
					if (e.stderr) stderrParts.push(e.stderr);
					if (e.levels > 1) {
						throw new ShellBreak(e.levels - 1, stdoutParts.join(""), stderrParts.join(""));
					}
					break;
				}
				if (e instanceof ShellContinue) {
					if (e.stdout) stdoutParts.push(e.stdout);
					if (e.stderr) stderrParts.push(e.stderr);
					if (e.levels > 1) {
						throw new ShellContinue(e.levels - 1, stdoutParts.join(""), stderrParts.join(""));
					}
					iterations++;
					continue;
				}
				throw e;
			}

			iterations++;
		}

		return {
			stdout: stdoutParts.join(""),
			stderr: stderrParts.join(""),
			exitCode: lastResult.exitCode,
		};
	}

	private async executeUntilNode(node: UntilNode, stdin: string): Promise<ShellResult> {
		let lastResult: ShellResult = { stdout: "", stderr: "", exitCode: 0 };
		const stdoutParts: string[] = [];
		const stderrParts: string[] = [];
		let iterations = 0;
		const maxIterations = 100000;

		while (iterations < maxIterations) {
			// `until` condition is exempt from errexit.
			const condResult = await this.withErrexitSuppressed(() =>
				this.executeNode(node.condition, stdin),
			);
			if (condResult.stdout) stdoutParts.push(condResult.stdout);
			if (condResult.stderr) stderrParts.push(condResult.stderr);
			if (condResult.exitCode === 0) break;

			try {
				const result = await this.executeNode(node.body, stdin);
				if (result.stdout) stdoutParts.push(result.stdout);
				if (result.stderr) stderrParts.push(result.stderr);
				lastResult = result;
			} catch (e) {
				if (e instanceof ShellBreak) {
					if (e.stdout) stdoutParts.push(e.stdout);
					if (e.stderr) stderrParts.push(e.stderr);
					if (e.levels > 1) {
						throw new ShellBreak(e.levels - 1, stdoutParts.join(""), stderrParts.join(""));
					}
					break;
				}
				if (e instanceof ShellContinue) {
					if (e.stdout) stdoutParts.push(e.stdout);
					if (e.stderr) stderrParts.push(e.stderr);
					if (e.levels > 1) {
						throw new ShellContinue(e.levels - 1, stdoutParts.join(""), stderrParts.join(""));
					}
					iterations++;
					continue;
				}
				throw e;
			}

			iterations++;
		}

		return {
			stdout: stdoutParts.join(""),
			stderr: stderrParts.join(""),
			exitCode: lastResult.exitCode,
		};
	}

	private async executeCaseNode(node: CaseNode, stdin: string): Promise<ShellResult> {
		const word = await this.expandWordStr(node.word);
		let allStdout = "";
		let allStderr = "";
		let lastExit = 0;
		let fallthrough = false;

		for (const item of node.items) {
			let matched = fallthrough;

			if (!matched) {
				for (const pattern of item.patterns) {
					const patStr = await this.expandWordStr(pattern);
					if (matchGlobPattern(word, patStr)) {
						matched = true;
						break;
					}
				}
			}

			if (matched && item.body) {
				const result = await this.executeNode(item.body, stdin);
				allStdout += result.stdout;
				allStderr += result.stderr;
				lastExit = result.exitCode;

				if (item.terminator === ";;") {
					return { stdout: allStdout, stderr: allStderr, exitCode: lastExit };
				}
				if (item.terminator === ";&") {
					fallthrough = true;
				}
				// ";;&" continues checking patterns
			}
		}

		return { stdout: allStdout, stderr: allStderr, exitCode: lastExit };
	}

	private async executeSelectNode(node: SelectNode, stdin: string): Promise<ShellResult> {
		// Select is interactive — in our virtual shell, just iterate once
		let words: string[] = [];
		if (node.words) {
			for (const w of node.words) {
				words.push(await this.expandWordStr(w));
			}
		} else {
			words = this.env.positionalArgs;
		}

		if (words.length === 0) {
			return { stdout: "", stderr: "", exitCode: 0 };
		}

		// Just select the first item
		this.env.set(node.variable, words[0]);
		try {
			return await this.executeNode(node.body, stdin);
		} catch (e) {
			if (e instanceof ShellBreak) {
				if (e.levels > 1) throw new ShellBreak(e.levels - 1);
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			if (e instanceof ShellContinue) {
				if (e.levels > 1) throw new ShellContinue(e.levels - 1);
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			throw e;
		}
	}

	private async executeFunctionNode(node: FunctionNode): Promise<ShellResult> {
		this.env.setFunction(node.name, node.body);
		return { stdout: "", stderr: "", exitCode: 0 };
	}

	private async executeArithmeticNode(node: ArithmeticNode): Promise<ShellResult> {
		const result = evaluateArithmetic(node.expression, this.env);
		return { stdout: "", stderr: "", exitCode: result === 0 ? 1 : 0 };
	}
}

function matchGlobPattern(text: string, pattern: string): boolean {
	if (pattern === "*") return true;

	let ti = 0;
	let pi = 0;
	let starTi = -1;
	let starPi = -1;

	while (ti < text.length) {
		if (pi < pattern.length && pattern[pi] === "[") {
			// Character class
			let j = pi + 1;
			let negate = false;
			if (j < pattern.length && pattern[j] === "!") {
				negate = true;
				j++;
			}
			let found = false;
			while (j < pattern.length && pattern[j] !== "]") {
				if (j + 2 < pattern.length && pattern[j + 1] === "-" && pattern[j + 2] !== "]") {
					// Range like a-z
					if (text[ti] >= pattern[j] && text[ti] <= pattern[j + 2]) found = true;
					j += 3;
				} else {
					if (text[ti] === pattern[j]) found = true;
					j++;
				}
			}
			if (j >= pattern.length) {
				// Unclosed bracket — treat as literal
				if (pattern[pi] === text[ti]) {
					ti++;
					pi++;
				} else if (starPi >= 0) {
					ti = ++starTi;
					pi = starPi + 1;
				} else {
					return false;
				}
			} else if (found !== negate) {
				ti++;
				pi = j + 1; // skip past ]
			} else if (starPi >= 0) {
				ti = ++starTi;
				pi = starPi + 1;
			} else {
				return false;
			}
		} else if (pi < pattern.length && (pattern[pi] === text[ti] || pattern[pi] === "?")) {
			ti++;
			pi++;
		} else if (pi < pattern.length && pattern[pi] === "*") {
			starTi = ti;
			starPi = pi;
			pi++;
		} else if (starPi >= 0) {
			ti = ++starTi;
			pi = starPi + 1;
		} else {
			return false;
		}
	}

	while (pi < pattern.length && pattern[pi] === "*") {
		pi++;
	}

	return pi === pattern.length;
}

function defaultTerminalContext(): CommandTerminalContext {
	return {
		isatty: { stdin: false, stdout: false, stderr: false },
		term: { cols: 80, rows: 24, name: "dumb" },
	};
}
