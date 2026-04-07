import { command } from "../builder.js";

interface SedAddress {
	type: "line" | "regex" | "last";
	line?: number;
	regex?: RegExp;
}

interface SedCommand {
	addr1: SedAddress | null;
	addr2: SedAddress | null;
	cmd: string;
	args: string;
}

function parseAddress(s: string, pos: number): { addr: SedAddress | null; pos: number } {
	if (pos >= s.length) return { addr: null, pos };

	if (s[pos] === "$") {
		return { addr: { type: "last" }, pos: pos + 1 };
	}

	if (s[pos] >= "0" && s[pos] <= "9") {
		let num = "";
		let p = pos;
		while (p < s.length && s[p] >= "0" && s[p] <= "9") {
			num += s[p];
			p++;
		}
		return { addr: { type: "line", line: Number.parseInt(num, 10) }, pos: p };
	}

	if (s[pos] === "/") {
		let p = pos + 1;
		let pattern = "";
		while (p < s.length && s[p] !== "/") {
			if (s[p] === "\\" && p + 1 < s.length) {
				pattern += s[p + 1];
				p += 2;
			} else {
				pattern += s[p];
				p++;
			}
		}
		if (p < s.length) p++; // skip closing /
		return { addr: { type: "regex", regex: new RegExp(pattern) }, pos: p };
	}

	return { addr: null, pos };
}

function parseSedExpression(expr: string): SedCommand[] {
	const commands: SedCommand[] = [];
	const parts = expr.split(";");

	for (const part of parts) {
		const trimmed = part.trim();
		if (trimmed === "") continue;

		let pos = 0;

		// Parse first address
		const a1 = parseAddress(trimmed, pos);
		const addr1 = a1.addr;
		pos = a1.pos;

		// Check for comma (address range)
		let addr2: SedAddress | null = null;
		if (pos < trimmed.length && trimmed[pos] === ",") {
			pos++;
			const a2 = parseAddress(trimmed, pos);
			addr2 = a2.addr;
			pos = a2.pos;
		}

		// Skip whitespace
		while (pos < trimmed.length && trimmed[pos] === " ") pos++;

		if (pos >= trimmed.length) continue;

		const cmd = trimmed[pos];
		const args = trimmed.slice(pos + 1);
		commands.push({ addr1, addr2, cmd, args });
	}

	return commands;
}

function parseSubstitution(args: string): {
	pattern: RegExp;
	replacement: string;
	global: boolean;
	caseInsensitive: boolean;
	print: boolean;
} | null {
	if (args.length === 0) return null;

	const delim = args[0];
	let i = 1;
	let pattern = "";
	let replacement = "";

	// Parse pattern
	while (i < args.length && args[i] !== delim) {
		if (args[i] === "\\" && i + 1 < args.length) {
			pattern += args[i] + args[i + 1];
			i += 2;
		} else {
			pattern += args[i];
			i++;
		}
	}
	i++; // skip delimiter

	// Parse replacement
	while (i < args.length && args[i] !== delim) {
		if (args[i] === "\\" && i + 1 < args.length) {
			replacement += args[i] + args[i + 1];
			i += 2;
		} else {
			replacement += args[i];
			i++;
		}
	}
	i++; // skip delimiter

	// Parse flags
	let global = false;
	let caseInsensitive = false;
	let print = false;
	while (i < args.length) {
		switch (args[i]) {
			case "g":
				global = true;
				break;
			case "i":
			case "I":
				caseInsensitive = true;
				break;
			case "p":
				print = true;
				break;
		}
		i++;
	}

	let regexFlags = "";
	if (caseInsensitive) regexFlags += "i";
	if (global) regexFlags += "g";

	try {
		const regex = new RegExp(pattern, regexFlags);
		return { pattern: regex, replacement, global, caseInsensitive, print };
	} catch {
		return null;
	}
}

function applyReplacement(line: string, pattern: RegExp, replacement: string): string {
	return line.replace(pattern, (...args) => {
		let result = "";
		let i = 0;
		while (i < replacement.length) {
			if (replacement[i] === "&") {
				result += args[0];
				i++;
			} else if (replacement[i] === "\\" && i + 1 < replacement.length) {
				const next = replacement[i + 1];
				if (next >= "1" && next <= "9") {
					const groupIdx = Number.parseInt(next, 10);
					result += args[groupIdx] ?? "";
					i += 2;
				} else if (next === "n") {
					result += "\n";
					i += 2;
				} else if (next === "t") {
					result += "\t";
					i += 2;
				} else {
					result += next;
					i += 2;
				}
			} else {
				result += replacement[i];
				i++;
			}
		}
		return result;
	});
}

function matchesAddress(
	addr: SedAddress,
	lineNum: number,
	line: string,
	lastLine: number,
): boolean {
	switch (addr.type) {
		case "line":
			return lineNum === addr.line;
		case "last":
			return lineNum === lastLine;
		case "regex":
			return addr.regex!.test(line);
	}
}

export const sed = command("sed")
	.description("Stream editor for filtering and transforming text")
	.flag("-n, --quiet", "Suppress automatic printing of pattern space")
	.flag("-i, --in-place", "Edit files in place")
	.option("-e, --expression <script>", "Add the script to the commands to be executed", {
		multiple: true,
	})
	.flag("-E, --extended-regexp", "Use extended regular expressions")
	.argument("[files...]", "Input files")
	.stopAfterFirstPositional()
	.action((ctx, { raw }) => {
		// sed has complex arg parsing where the first non-flag arg is an expression
		// if no -e was given, so we parse raw args manually
		let quiet = false;
		let inPlace = false;
		const expressions: string[] = [];
		const files: string[] = [];
		let i = 0;

		while (i < raw.length) {
			const arg = raw[i];
			if (arg === "--") {
				i++;
				files.push(...raw.slice(i));
				break;
			}
			if (arg === "-n") {
				quiet = true;
			} else if (arg === "-i") {
				inPlace = true;
			} else if (arg === "-e" && i + 1 < raw.length) {
				i++;
				expressions.push(raw[i]);
			} else if (arg.startsWith("-e")) {
				expressions.push(arg.slice(2));
			} else if (arg === "-E") {
				// Extended regex flag - accepted but no special handling needed
			} else if (arg.startsWith("-") && arg.length > 1) {
				// Combined flags like -ni
				for (let j = 1; j < arg.length; j++) {
					switch (arg[j]) {
						case "n":
							quiet = true;
							break;
						case "i":
							inPlace = true;
							break;
						case "E":
							break;
						case "e":
							if (i + 1 < raw.length) {
								i++;
								expressions.push(raw[i]);
							}
							break;
						default:
							ctx.stderr.writeln("sed: invalid option -- '" + arg[j] + "'");
							return 1;
					}
				}
			} else if (expressions.length === 0 && files.length === 0) {
				// First non-flag arg is the expression if no -e given
				expressions.push(arg);
			} else {
				files.push(arg);
			}
			i++;
		}

		if (expressions.length === 0) {
			ctx.stderr.writeln("sed: missing script");
			return 1;
		}

		const allCommands: SedCommand[] = [];
		for (const expr of expressions) {
			allCommands.push(...parseSedExpression(expr));
		}

		const processContent = (content: string): string => {
			const lines = content.split("\n");
			const hasTrailing = content.endsWith("\n") && content.length > 0;
			if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
				lines.pop();
			}

			const lastLine = lines.length;
			const output: string[] = [];
			const inRange = new Map<number, boolean>();

			for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
				let line = lines[lineIdx];
				const lineNum = lineIdx + 1;
				let printLine = !quiet;
				let deleted = false;
				let shouldQuit = false;

				for (let cmdIdx = 0; cmdIdx < allCommands.length; cmdIdx++) {
					const cmd = allCommands[cmdIdx];

					// Check address matching
					let applies = false;

					if (!cmd.addr1 && !cmd.addr2) {
						applies = true;
					} else if (cmd.addr1 && !cmd.addr2) {
						applies = matchesAddress(cmd.addr1, lineNum, line, lastLine);
					} else if (cmd.addr1 && cmd.addr2) {
						const rangeActive = inRange.get(cmdIdx) ?? false;
						if (rangeActive) {
							applies = true;
							if (matchesAddress(cmd.addr2, lineNum, line, lastLine)) {
								inRange.set(cmdIdx, false);
							}
						} else if (matchesAddress(cmd.addr1, lineNum, line, lastLine)) {
							applies = true;
							inRange.set(cmdIdx, true);
						}
					}

					if (!applies) continue;

					switch (cmd.cmd) {
						case "s": {
							const sub = parseSubstitution(cmd.args);
							if (sub) {
								const newLine = applyReplacement(line, sub.pattern, sub.replacement);
								const changed = newLine !== line;
								line = newLine;
								if (sub.print && changed) {
									output.push(line);
								}
							}
							break;
						}
						case "d":
							deleted = true;
							break;
						case "p":
							output.push(line);
							break;
						case "q":
							if (printLine && !deleted) {
								output.push(line);
							}
							shouldQuit = true;
							break;
						case "a": {
							// append: the text follows the command
							const text = cmd.args.startsWith("\\")
								? cmd.args.slice(1).trimStart()
								: cmd.args.trimStart();
							if (printLine && !deleted) {
								output.push(line);
								printLine = false;
							}
							output.push(text);
							break;
						}
						case "i": {
							// insert: text before current line
							const text = cmd.args.startsWith("\\")
								? cmd.args.slice(1).trimStart()
								: cmd.args.trimStart();
							output.push(text);
							break;
						}
						case "c": {
							// change: replace the line
							const text = cmd.args.startsWith("\\")
								? cmd.args.slice(1).trimStart()
								: cmd.args.trimStart();
							deleted = true;
							output.push(text);
							break;
						}
					}

					if (deleted || shouldQuit) break;
				}

				if (!deleted && printLine) {
					output.push(line);
				}

				if (shouldQuit) break;
			}

			if (output.length === 0) return "";
			return output.join("\n") + "\n";
		};

		if (files.length === 0) {
			const result = processContent(ctx.stdin);
			ctx.stdout.write(result);
		} else {
			for (const file of files) {
				const resolved = ctx.resolve(file);
				try {
					const content = ctx.fs.readFile(resolved);
					const result = processContent(content);
					if (inPlace) {
						ctx.fs.writeFile(resolved, result);
					} else {
						ctx.stdout.write(result);
					}
				} catch {
					ctx.stderr.writeln("sed: " + file + ": No such file or directory");
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();
