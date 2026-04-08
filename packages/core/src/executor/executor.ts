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
	type SelectNode,
	type SubshellNode,
	type UntilNode,
	type WhileNode,
	type Word,
	parse,
} from "@faux-shell/parser";
import type { CommandRegistry } from "../commands/registry.js";
import type { Environment } from "../env/environment.js";
import type { ShellResult } from "../types.js";
import type { IFileSystem } from "../vfs/types.js";
import {
	evaluateArithmetic,
	expandBraces,
	expandGlob,
	expandWord,
	expandWordToFields,
	type SubExecFn,
} from "./expansion/index.js";
import {
	type ExecutorContext,
	executeCommand,
	executePipeline,
	ShellExit,
	ShellReturn,
} from "./pipeline.js";
import { applyInputRedirect, getOutputRedirects, resolveRedirects } from "./redirect.js";

export class Executor {
	private env: Environment;
	private fs: IFileSystem;
	private registry: CommandRegistry;
	private traps = new Map<string, string>();

	constructor(env: Environment, fs: IFileSystem, registry: CommandRegistry) {
		this.env = env;
		this.fs = fs;
		this.registry = registry;
	}

	async execute(node: AstNode, stdin = ""): Promise<ShellResult> {
		try {
			const result = await this.executeNode(node, stdin);
			this.env.lastExitCode = result.exitCode;
			return result;
		} catch (e) {
			if (e instanceof ShellExit) {
				return { stdout: "", stderr: "", exitCode: e.code };
			}
			if (e instanceof ShellReturn) {
				return { stdout: "", stderr: "", exitCode: e.code };
			}
			throw e;
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

	private getExecCtx(): ExecutorContext {
		return {
			env: this.env,
			fs: this.fs,
			registry: this.registry,
			subExec: async (node: AstNode) => {
				const result = await this.executeNode(node, "");
				return { stdout: result.stdout, exitCode: result.exitCode };
			},
			executeNode: (node: AstNode, stdin: string) => this.executeNode(node, stdin),
		};
	}

	private resolvePath(p: string): string {
		if (p.startsWith("/")) return p;
		const cwd = this.env.cwd;
		if (cwd === "/") return "/" + p;
		return cwd + "/" + p;
	}

	private async expandWordStr(word: Word): Promise<string> {
		return expandWord(word, this.env, this.fs, async (node) => {
			const r = await this.executeNode(node, "");
			return { stdout: r.stdout, exitCode: r.exitCode };
		});
	}

	private async executeCommandNode(node: CommandNode, stdin: string): Promise<ShellResult> {
		const ctx = this.getExecCtx();

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

		// Expand arguments
		const expandedArgs: string[] = [];
		for (const arg of node.args) {
			const expanded = await this.expandWordStr(arg);
			// Glob expansion
			const globbed = expandGlob(expanded, this.fs, this.env.cwd);
			expandedArgs.push(...globbed);
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

		const result = await executeCommand(name, expandedArgs, effectiveStdin, outputRedirects, ctx);

		// Restore temp vars
		for (const { name, value } of savedVars) {
			if (value === undefined) {
				this.env.unset(name);
			} else {
				this.env.set(name, value);
			}
		}

		this.env.lastExitCode = result.exitCode;
		return result;
	}

	private async executePipelineNode(node: PipelineNode, stdin: string): Promise<ShellResult> {
		const ctx = this.getExecCtx();
		return executePipeline(node.commands, node.negated, stdin, ctx);
	}

	private async executeListNode(node: ListNode, stdin: string): Promise<ShellResult> {
		const leftResult = await this.executeNode(node.left, stdin);

		const combine = (right: ShellResult): ShellResult => ({
			stdout: leftResult.stdout + right.stdout,
			stderr: leftResult.stderr + right.stderr,
			exitCode: right.exitCode,
		});

		switch (node.operator) {
			case "&&":
				if (leftResult.exitCode === 0) {
					return combine(await this.executeNode(node.right, stdin));
				}
				return leftResult;

			case "||":
				if (leftResult.exitCode !== 0) {
					return combine(await this.executeNode(node.right, stdin));
				}
				return leftResult;

			case ";":
				return combine(await this.executeNode(node.right, stdin));

			case "&":
				// Background: just execute right immediately (no true async in our model)
				return combine(await this.executeNode(node.right, stdin));

			default:
				return leftResult;
		}
	}

	private async executeSubshellNode(node: SubshellNode, stdin: string): Promise<ShellResult> {
		const childEnv = this.env.fork();
		const childExec = new Executor(childEnv, this.fs, this.registry);
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
			const condResult = await this.executeNode(clause.condition, stdin);
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
				const expanded = await this.expandWordStr(w);
				const globbed = expandGlob(expanded, this.fs, this.env.cwd);
				words.push(...globbed);
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
				if (e instanceof BreakSignal) {
					if (e.levels > 1) throw new BreakSignal(e.levels - 1);
					break;
				}
				if (e instanceof ContinueSignal) {
					if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
					continue;
				}
				throw e;
			}
		}

		return { stdout: stdoutParts.join(""), stderr: stderrParts.join(""), exitCode: lastResult.exitCode };
	}

	private async executeWhileNode(node: WhileNode, stdin: string): Promise<ShellResult> {
		let lastResult: ShellResult = { stdout: "", stderr: "", exitCode: 0 };
		const stdoutParts: string[] = [];
		const stderrParts: string[] = [];
		let iterations = 0;
		const maxIterations = 100000;

		while (iterations < maxIterations) {
			const condResult = await this.executeNode(node.condition, stdin);
			if (condResult.stdout) stdoutParts.push(condResult.stdout);
			if (condResult.stderr) stderrParts.push(condResult.stderr);
			if (condResult.exitCode !== 0) break;

			try {
				const result = await this.executeNode(node.body, stdin);
				if (result.stdout) stdoutParts.push(result.stdout);
				if (result.stderr) stderrParts.push(result.stderr);
				lastResult = result;
			} catch (e) {
				if (e instanceof BreakSignal) {
					if (e.levels > 1) throw new BreakSignal(e.levels - 1);
					break;
				}
				if (e instanceof ContinueSignal) {
					if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
					iterations++;
					continue;
				}
				throw e;
			}

			iterations++;
		}

		return { stdout: stdoutParts.join(""), stderr: stderrParts.join(""), exitCode: lastResult.exitCode };
	}

	private async executeUntilNode(node: UntilNode, stdin: string): Promise<ShellResult> {
		let lastResult: ShellResult = { stdout: "", stderr: "", exitCode: 0 };
		const stdoutParts: string[] = [];
		const stderrParts: string[] = [];
		let iterations = 0;
		const maxIterations = 100000;

		while (iterations < maxIterations) {
			const condResult = await this.executeNode(node.condition, stdin);
			if (condResult.stdout) stdoutParts.push(condResult.stdout);
			if (condResult.stderr) stderrParts.push(condResult.stderr);
			if (condResult.exitCode === 0) break;

			try {
				const result = await this.executeNode(node.body, stdin);
				if (result.stdout) stdoutParts.push(result.stdout);
				if (result.stderr) stderrParts.push(result.stderr);
				lastResult = result;
			} catch (e) {
				if (e instanceof BreakSignal) {
					if (e.levels > 1) throw new BreakSignal(e.levels - 1);
					break;
				}
				if (e instanceof ContinueSignal) {
					if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
					iterations++;
					continue;
				}
				throw e;
			}

			iterations++;
		}

		return { stdout: stdoutParts.join(""), stderr: stderrParts.join(""), exitCode: lastResult.exitCode };
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
		return this.executeNode(node.body, stdin);
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

class BreakSignal extends Error {
	constructor(public levels: number = 1) {
		super("break");
		this.name = "BreakSignal";
	}
}

class ContinueSignal extends Error {
	constructor(public levels: number = 1) {
		super("continue");
		this.name = "ContinueSignal";
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

export { BreakSignal, ContinueSignal };
