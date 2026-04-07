import { command } from "../builder.js";

function expandSet(spec: string): string {
	let result = "";
	let i = 0;

	while (i < spec.length) {
		// Character classes
		if (spec[i] === "[" && spec[i + 1] === ":") {
			const end = spec.indexOf(":]", i + 2);
			if (end !== -1) {
				const className = spec.slice(i + 2, end);
				result += expandClass(className);
				i = end + 2;
				continue;
			}
		}

		// Ranges like a-z
		if (i + 2 < spec.length && spec[i + 1] === "-") {
			const start = spec.charCodeAt(i);
			const end = spec.charCodeAt(i + 2);
			if (start <= end) {
				for (let c = start; c <= end; c++) {
					result += String.fromCharCode(c);
				}
				i += 3;
				continue;
			}
		}

		// Escape sequences
		if (spec[i] === "\\" && i + 1 < spec.length) {
			switch (spec[i + 1]) {
				case "n":
					result += "\n";
					i += 2;
					continue;
				case "t":
					result += "\t";
					i += 2;
					continue;
				case "r":
					result += "\r";
					i += 2;
					continue;
				case "\\":
					result += "\\";
					i += 2;
					continue;
				default:
					result += spec[i + 1];
					i += 2;
					continue;
			}
		}

		result += spec[i];
		i++;
	}

	return result;
}

function expandClass(name: string): string {
	switch (name) {
		case "upper":
			return "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
		case "lower":
			return "abcdefghijklmnopqrstuvwxyz";
		case "digit":
			return "0123456789";
		case "alpha":
			return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
		case "alnum":
			return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		case "space":
			return " \t\n\r\x0b\x0c";
		case "blank":
			return " \t";
		case "print": {
			let s = "";
			for (let c = 32; c < 127; c++) {
				s += String.fromCharCode(c);
			}
			return s;
		}
		case "graph": {
			let s = "";
			for (let c = 33; c < 127; c++) {
				s += String.fromCharCode(c);
			}
			return s;
		}
		case "punct": {
			let s = "";
			for (let c = 33; c < 127; c++) {
				const ch = String.fromCharCode(c);
				if (!/[a-zA-Z0-9]/.test(ch)) {
					s += ch;
				}
			}
			return s;
		}
		default:
			return "";
	}
}

export const tr = command("tr")
	.description("Translate or delete characters")
	.flag("-d, --delete", "Delete characters in SET1")
	.flag("-s, --squeeze", "Squeeze repeated characters")
	.flag("-c, --complement", "Use complement of SET1")
	.flag("-C, --complement-alt", "Use complement of SET1")
	.argument("[set...]", "Character sets")
	.stopAfterFirstPositional()
	.action((ctx, { args: operands, flags: f }) => {
		const deleteMode = f.delete as boolean;
		const squeezeMode = f.squeeze as boolean;
		const complementMode = (f.complement as boolean) || (f.complementAlt as boolean);

		if (operands.length < 1) {
			ctx.stderr.writeln("tr: missing operand");
			return 1;
		}

		const set1 = expandSet(operands[0]);
		const set2 = operands.length > 1 ? expandSet(operands[1]) : "";

		const input = ctx.stdin;
		let output = "";

		if (deleteMode && !squeezeMode) {
			// Delete characters in set1
			const deleteSet = new Set(complementMode ? [] : [...set1]);
			if (complementMode) {
				const keepSet = new Set([...set1]);
				for (let j = 0; j < input.length; j++) {
					if (keepSet.has(input[j])) {
						output += input[j];
					}
				}
			} else {
				for (let j = 0; j < input.length; j++) {
					if (!deleteSet.has(input[j])) {
						output += input[j];
					}
				}
			}
		} else if (deleteMode && squeezeMode) {
			// Delete set1, squeeze set2
			const deleteChars = new Set(complementMode ? [] : [...set1]);
			const squeezeChars = new Set([...set2]);
			let temp = "";

			if (complementMode) {
				const keepSet = new Set([...set1]);
				for (let j = 0; j < input.length; j++) {
					if (keepSet.has(input[j])) {
						temp += input[j];
					}
				}
			} else {
				for (let j = 0; j < input.length; j++) {
					if (!deleteChars.has(input[j])) {
						temp += input[j];
					}
				}
			}

			// Squeeze
			let prevChar = "";
			for (let j = 0; j < temp.length; j++) {
				if (squeezeChars.has(temp[j]) && temp[j] === prevChar) {
					continue;
				}
				output += temp[j];
				prevChar = temp[j];
			}
		} else if (squeezeMode && operands.length === 1) {
			// Squeeze only set1
			const squeezeChars = new Set(complementMode ? [] : [...set1]);
			let prevChar = "";
			if (complementMode) {
				const keepRepeats = new Set([...set1]);
				for (let j = 0; j < input.length; j++) {
					if (!keepRepeats.has(input[j]) && input[j] === prevChar) {
						continue;
					}
					output += input[j];
					prevChar = input[j];
				}
			} else {
				for (let j = 0; j < input.length; j++) {
					if (squeezeChars.has(input[j]) && input[j] === prevChar) {
						continue;
					}
					output += input[j];
					prevChar = input[j];
				}
			}
		} else {
			// Translate mode (with optional squeeze)
			const translateMap = new Map<string, string>();

			if (complementMode) {
				// Complement of set1 maps to set2
				const set1Chars = new Set([...set1]);
				// Build a set of all characters in input that are NOT in set1
				const complementChars: string[] = [];
				for (let j = 0; j < input.length; j++) {
					if (!set1Chars.has(input[j]) && !complementChars.includes(input[j])) {
						complementChars.push(input[j]);
					}
				}
				for (let j = 0; j < complementChars.length; j++) {
					const replacement = j < set2.length ? set2[j] : set2[set2.length - 1] || "";
					translateMap.set(complementChars[j], replacement);
				}
			} else {
				for (let j = 0; j < set1.length; j++) {
					const replacement = j < set2.length ? set2[j] : set2[set2.length - 1] || "";
					translateMap.set(set1[j], replacement);
				}
			}

			const squeezeChars = squeezeMode ? new Set([...set2]) : null;
			let prevChar = "";

			for (let j = 0; j < input.length; j++) {
				const ch = translateMap.has(input[j]) ? translateMap.get(input[j])! : input[j];
				if (squeezeChars && squeezeChars.has(ch) && ch === prevChar) {
					continue;
				}
				output += ch;
				prevChar = ch;
			}
		}

		ctx.stdout.write(output);
		return 0;
	})
	.toHandler();
