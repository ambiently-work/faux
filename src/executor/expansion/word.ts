import type { IFileSystem } from "@ambiently-work/mirage";
import type { Environment } from "../../env/environment.js";
import type { AstNode, Word, WordPart } from "../../parser/index.js";
import { evaluateArithmetic } from "./arithmetic.js";
import { expandVariable, expandVariableOp, UnboundVariableError } from "./parameter.js";

export type SubExecFn = (node: AstNode) => Promise<{ stdout: string; exitCode: number }>;

export async function expandWord(
	word: Word,
	env: Environment,
	fs: IFileSystem,
	subExec: SubExecFn,
): Promise<string> {
	// Fast path: single-part words (most common case) avoid array allocation
	if (word.length === 1) {
		return expandPart(word[0], env, fs, subExec);
	}
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
	const segments: Segment[] = [];
	for (const part of word) {
		segments.push(...(await expandPartToSegments(part, env, fs, subExec, false)));
	}
	const ifs = env.get("IFS");
	if (ifs === "") {
		// Empty IFS disables field splitting entirely.
		return [segments.map((s) => s.text).join("")];
	}
	return splitByIfs(segments, ifs ?? " \t\n");
}

/**
 * A single splittable/non-splittable segment of an expanded word. Segments
 * coming from quoted regions or literals carry their text through unchanged;
 * those from unquoted variable/command/arithmetic expansions are eligible for
 * IFS-based field splitting before being recombined into argv.
 */
interface Segment {
	text: string;
	splittable: boolean;
	/**
	 * If true, this segment starts a fresh field regardless of IFS — used to
	 * implement the `"$@"` rule, where each positional arg becomes its own
	 * field even when wrapped in double quotes.
	 */
	fieldBreak?: boolean;
}

async function expandPartToSegments(
	part: WordPart,
	env: Environment,
	fs: IFileSystem,
	subExec: SubExecFn,
	inDoubleQuoted: boolean,
): Promise<Segment[]> {
	switch (part.type) {
		case "literal":
		case "singleQuoted":
			return [{ text: part.value, splittable: false }];

		case "doubleQuoted": {
			// Special case: `"$@"` (or `"${@}"`) expands to one field per positional
			// arg — each is non-splittable but field-broken from the others.
			if (
				part.parts.length === 1 &&
				part.parts[0] &&
				(part.parts[0].type === "variable" || part.parts[0].type === "variableExpansion") &&
				(part.parts[0] as { name?: string }).name === "@"
			) {
				const args = env.positionalArgs;
				if (args.length === 0) return [];
				return args.map((arg, i) => ({
					text: arg,
					splittable: false,
					fieldBreak: i > 0,
				}));
			}
			// Otherwise everything stays a single non-splittable run, even when an
			// expansion's value contains whitespace.
			const inner: string[] = [];
			for (const p of part.parts) {
				const segs = await expandPartToSegments(p, env, fs, subExec, true);
				for (const seg of segs) inner.push(seg.text);
			}
			return [{ text: inner.join(""), splittable: false }];
		}

		case "variable": {
			const value = expandVariable(part.name, env);
			return [{ text: value, splittable: !inDoubleQuoted }];
		}

		case "variableExpansion": {
			const value = await expandVariableOp(part.name, part.op, part.arg, env, fs, subExec);
			return [{ text: value, splittable: !inDoubleQuoted }];
		}

		case "variableLength": {
			const text = await expandPart(part, env, fs, subExec);
			return [{ text, splittable: !inDoubleQuoted }];
		}

		case "commandSubstitution":
		case "arithmeticExpansion": {
			const text = await expandPart(part, env, fs, subExec);
			return [{ text, splittable: !inDoubleQuoted }];
		}

		default: {
			const text = await expandPart(part, env, fs, subExec);
			return [{ text, splittable: false }];
		}
	}
}

/**
 * Split a sequence of segments into fields using POSIX IFS rules:
 *   - Whitespace IFS chars (space/tab/newline) are *folding* — runs collapse,
 *     leading/trailing runs are trimmed.
 *   - Non-whitespace IFS chars each delimit exactly one empty field if doubled
 *     (`a::b` with `IFS=:` → ["a", "", "b"]).
 *   - Non-splittable segments are emitted into the current field as glue and
 *     never start a new field.
 *
 * Empty input with no segments returns a single empty field, matching what
 * commands like `printf` expect.
 */
function splitByIfs(segments: Segment[], ifs: string): string[] {
	if (segments.length === 0) return [""];

	const ifsWhitespace = new Set<string>();
	const ifsOther = new Set<string>();
	for (const ch of ifs) {
		if (ch === " " || ch === "\t" || ch === "\n") ifsWhitespace.add(ch);
		else ifsOther.add(ch);
	}

	const fields: string[] = [];
	let current = "";
	let hasContent = false;
	// Quoted/literal segments contribute "presence" even when their text is
	// empty: a quoted `""` argument must survive as a single empty field rather
	// than collapse out of argv.
	let sawAnchored = false;

	const flush = (): void => {
		fields.push(current);
		current = "";
		hasContent = false;
		sawAnchored = false;
	};

	for (const seg of segments) {
		if (seg.fieldBreak && (hasContent || sawAnchored)) {
			flush();
		}
		if (!seg.splittable) {
			current += seg.text;
			sawAnchored = true;
			if (seg.text.length > 0) hasContent = true;
			continue;
		}
		for (const ch of seg.text) {
			if (ifsOther.has(ch)) {
				flush();
				continue;
			}
			if (ifsWhitespace.has(ch)) {
				if (hasContent) flush();
				continue;
			}
			current += ch;
			hasContent = true;
		}
	}

	if (hasContent || current.length > 0 || sawAnchored) {
		fields.push(current);
	}

	if (fields.length === 0) {
		// Pure-whitespace expansion of an unquoted empty value yields no fields.
		return [];
	}
	return fields;
}

function ensureParentDir(fs: IFileSystem, path: string): void {
	const idx = path.lastIndexOf("/");
	if (idx <= 0) return;
	const dir = path.slice(0, idx);
	if (!fs.exists(dir)) {
		fs.mkdir(dir, { recursive: true });
	}
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
			const value = env.get(part.name) ?? env.getSpecial(part.name);
			if (value === undefined) {
				if (env.hasOption("nounset")) {
					throw new UnboundVariableError(part.name);
				}
				return "0";
			}
			return value.length.toString();
		}

		case "commandSubstitution": {
			const result = await subExec(part.body);
			// Remove trailing newlines like bash does
			return result.stdout.replace(/\n+$/, "");
		}

		case "arithmeticExpansion":
			return evaluateArithmetic(part.expression, env).toString();

		case "processSubstitution": {
			if (part.direction === "in") {
				// Materialize <(cmd) by running cmd, capturing stdout, and writing
				// it to a freshly-allocated VFS temp path. The executor cleans the
				// path up after the surrounding command finishes.
				const result = await subExec(part.body);
				const path = env.allocProcSubPath();
				try {
					ensureParentDir(fs, path);
					fs.writeFile(path, result.stdout);
					env.pendingProcSubFiles.push(path);
				} catch {
					// Best-effort — fall through to the placeholder if the FS rejects
					// the write so the consuming command at least sees a path.
				}
				return path;
			}
			// Output process substitution `>(cmd)` — synthesizing a write-trigger
			// sink isn't supported yet; emit a placeholder path that exists so
			// downstream commands at least don't crash on missing files.
			const path = env.allocProcSubPath();
			try {
				ensureParentDir(fs, path);
				fs.writeFile(path, "");
				env.pendingProcSubFiles.push(path);
			} catch {
				// ignore
			}
			return path;
		}

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
