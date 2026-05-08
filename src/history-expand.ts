import type { CommandTracker } from "./tracker.js";

/**
 * Expand bash-style history references in `input` against `tracker`.
 *
 * Supported forms:
 *   `!!`       — the most recent command
 *   `!N`       — entry N (1-based)
 *   `!-N`      — N commands back from now
 *   `!string`  — most recent command starting with `string` (alphanumeric/underscore)
 *
 * Single-quoted regions are passed through literally, matching bash. Returns the
 * expanded string, or `null` if a reference couldn't be resolved (caller should
 * surface an "event not found" error instead of running the original line).
 */
export function expandHistory(input: string, tracker: CommandTracker): string | null {
	const entries = tracker.history;
	if (entries.length === 0 && input.includes("!")) {
		// Quick path: no history yet, but check if there are any references at all.
		if (!hasUnquotedBang(input)) return input;
	}

	let out = "";
	let i = 0;
	let inSingleQuote = false;
	let inDoubleQuote = false;

	while (i < input.length) {
		const ch = input[i] ?? "";

		if (ch === "\\" && i + 1 < input.length) {
			out += ch + input[i + 1];
			i += 2;
			continue;
		}

		if (ch === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
			out += ch;
			i++;
			continue;
		}

		if (ch === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
			out += ch;
			i++;
			continue;
		}

		if (ch !== "!" || inSingleQuote) {
			out += ch;
			i++;
			continue;
		}

		// We have a `!` outside single quotes. Try to interpret the reference.
		const next = input[i + 1] ?? "";

		// `! ` or `!` at end is literal (no ref to expand)
		if (next === "" || next === " " || next === "\t" || next === "=" || next === "(") {
			out += ch;
			i++;
			continue;
		}

		if (next === "!") {
			const last = entries[entries.length - 1];
			if (!last) return null;
			out += last.command;
			i += 2;
			continue;
		}

		// `!-N`
		if (next === "-") {
			let j = i + 2;
			let digits = "";
			while (j < input.length && isDigit(input[j] ?? "")) {
				digits += input[j];
				j++;
			}
			if (digits.length === 0) {
				out += ch;
				i++;
				continue;
			}
			const back = Number.parseInt(digits, 10);
			const target = entries[entries.length - back];
			if (!target) return null;
			out += target.command;
			i = j;
			continue;
		}

		// `!N`
		if (isDigit(next)) {
			let j = i + 1;
			let digits = "";
			while (j < input.length && isDigit(input[j] ?? "")) {
				digits += input[j];
				j++;
			}
			const idx = Number.parseInt(digits, 10);
			const target = entries[idx - 1];
			if (!target) return null;
			out += target.command;
			i = j;
			continue;
		}

		// `!string`
		if (isWordChar(next)) {
			let j = i + 1;
			let prefix = "";
			while (j < input.length && isWordChar(input[j] ?? "")) {
				prefix += input[j];
				j++;
			}
			const target = findLastByPrefix(entries, prefix);
			if (!target) return null;
			out += target.command;
			i = j;
			continue;
		}

		// Unrecognized form — emit literally.
		out += ch;
		i++;
	}

	return out;
}

function isDigit(ch: string): boolean {
	return ch >= "0" && ch <= "9";
}

function isWordChar(ch: string): boolean {
	return (
		(ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_"
	);
}

function findLastByPrefix(
	entries: ReadonlyArray<{ command: string }>,
	prefix: string,
): { command: string } | undefined {
	for (let k = entries.length - 1; k >= 0; k--) {
		const entry = entries[k];
		if (entry?.command.startsWith(prefix)) return entry;
	}
	return undefined;
}

function hasUnquotedBang(input: string): boolean {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i] ?? "";
		if (ch === "\\" && i + 1 < input.length) {
			i++;
			continue;
		}
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (ch === "!" && !inSingle) return true;
	}
	return false;
}
