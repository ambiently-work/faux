import type { AstNode, Word, WordPart } from "@faux-shell/parser";
import type { Environment } from "../../env/environment.js";
import type { IFileSystem } from "../../vfs/types.js";
import { evaluateArithmetic } from "./arithmetic.js";
import { expandVariable, expandVariableOp } from "./parameter.js";

export type SubExecFn = (node: AstNode) => Promise<{ stdout: string; exitCode: number }>;

export async function expandWord(
	word: Word,
	env: Environment,
	fs: IFileSystem,
	subExec: SubExecFn,
): Promise<string> {
	const parts: string[] = [];
	for (const part of word) {
		parts.push(await expandPart(part, env, fs, subExec));
	}
	return parts.join("");
}

export async function expandWordToFields(
	word: Word,
	env: Environment,
	fs: IFileSystem,
	subExec: SubExecFn,
): Promise<string[]> {
	const expanded = await expandWord(word, env, fs, subExec);
	// For now, no field splitting — return as single field
	// TODO: IFS-based field splitting for unquoted expansions
	return [expanded];
}

async function expandPart(
	part: WordPart,
	env: Environment,
	fs: IFileSystem,
	subExec: SubExecFn,
): Promise<string> {
	switch (part.type) {
		case "literal":
			return part.value;

		case "singleQuoted":
			return part.value;

		case "doubleQuoted": {
			const parts: string[] = [];
			for (const p of part.parts) {
				parts.push(await expandPart(p, env, fs, subExec));
			}
			return parts.join("");
		}

		case "variable":
			return expandVariable(part.name, env);

		case "variableExpansion":
			return expandVariableOp(part.name, part.op, part.arg, env, fs, subExec);

		case "variableLength": {
			const val = env.get(part.name) ?? env.getSpecial(part.name) ?? "";
			return val.length.toString();
		}

		case "commandSubstitution": {
			const result = await subExec(part.body);
			// Remove trailing newlines like bash does
			return result.stdout.replace(/\n+$/, "");
		}

		case "arithmeticExpansion":
			return evaluateArithmetic(part.expression, env).toString();

		case "processSubstitution":
			// Process substitution creates a temp file in VFS
			return "/dev/fd/63"; // simplified

		case "glob":
			return part.pattern; // Glob expansion happens at command level

		case "tilde": {
			if (part.user === "+") {
				return env.get("PWD") ?? env.cwd;
			}
			if (part.user === "-") {
				return env.get("OLDPWD") ?? "";
			}
			if (part.user === "" || part.user === env.get("USER")) {
				return env.get("HOME") ?? "/root";
			}
			return `/home/${part.user}`;
		}

		case "braceExpansion": {
			// Brace expansion is handled before other expansions
			const results: string[] = [];
			for (const w of part.parts) {
				results.push(await expandWord(w, env, fs, subExec));
			}
			return results.join(" "); // simplified
		}

		default:
			return "";
	}
}
