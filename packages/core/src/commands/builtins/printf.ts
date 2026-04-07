import { command } from "../builder.js";

export const printf = command("printf")
	.description("Format and print data")
	.argument("<format>", "Format string")
	.argument("[arguments...]", "Arguments for format string")
	.allowUnknownFlags()
	.stopAfterFirstPositional()
	.action((ctx, { args }) => {
		if (args.length === 0) {
			ctx.stderr.writeln("printf: usage: printf format [arguments]");
			return 1;
		}

		const format = args[0];
		const fmtArgs = args.slice(1);
		let argIdx = 0;

		const getArg = (): string => {
			if (argIdx < fmtArgs.length) {
				return fmtArgs[argIdx++];
			}
			return "";
		};

		let hasArgs = true;
		while (hasArgs) {
			const startArgIdx = argIdx;
			let result = "";
			let i = 0;

			while (i < format.length) {
				if (format[i] === "\\" && i + 1 < format.length) {
					const esc = parseEscape(format, i);
					result += esc.char;
					i = esc.next;
				} else if (format[i] === "%" && i + 1 < format.length) {
					if (format[i + 1] === "%") {
						result += "%";
						i += 2;
						continue;
					}
					const spec = parseFormatSpec(format, i + 1);
					const arg = getArg();
					result += formatValue(spec, arg);
					i = spec.next;
				} else {
					result += format[i];
					i++;
				}
			}

			ctx.stdout.write(result);
			hasArgs = argIdx > startArgIdx && argIdx < fmtArgs.length;
		}

		return 0;
	})
	.toHandler();

interface FormatSpec {
	flags: string;
	width: number;
	precision: number;
	conversion: string;
	next: number;
}

function parseEscape(s: string, i: number): { char: string; next: number } {
	const c = s[i + 1];
	switch (c) {
		case "n":
			return { char: "\n", next: i + 2 };
		case "t":
			return { char: "\t", next: i + 2 };
		case "r":
			return { char: "\r", next: i + 2 };
		case "\\":
			return { char: "\\", next: i + 2 };
		case "a":
			return { char: "\x07", next: i + 2 };
		case "b":
			return { char: "\b", next: i + 2 };
		case "f":
			return { char: "\f", next: i + 2 };
		case "v":
			return { char: "\v", next: i + 2 };
		case "e":
		case "E":
			return { char: "\x1b", next: i + 2 };
		case "0": {
			let octal = "";
			let j = i + 2;
			while (j < s.length && j < i + 5 && s[j] >= "0" && s[j] <= "7") {
				octal += s[j];
				j++;
			}
			return {
				char: String.fromCharCode(octal.length > 0 ? Number.parseInt(octal, 8) : 0),
				next: j,
			};
		}
		case "x": {
			let hex = "";
			let j = i + 2;
			while (j < s.length && j < i + 4 && /[0-9a-fA-F]/.test(s[j])) {
				hex += s[j];
				j++;
			}
			if (hex.length > 0) {
				return {
					char: String.fromCharCode(Number.parseInt(hex, 16)),
					next: j,
				};
			}
			return { char: "\\x", next: i + 2 };
		}
		default:
			return { char: "\\" + c, next: i + 2 };
	}
}

function parseFormatSpec(s: string, start: number): FormatSpec {
	let i = start;
	let flags = "";
	while (i < s.length && "-+ #0".includes(s[i])) {
		flags += s[i];
		i++;
	}
	let width = 0;
	while (i < s.length && s[i] >= "0" && s[i] <= "9") {
		width = width * 10 + Number.parseInt(s[i], 10);
		i++;
	}
	let precision = -1;
	if (i < s.length && s[i] === ".") {
		i++;
		precision = 0;
		while (i < s.length && s[i] >= "0" && s[i] <= "9") {
			precision = precision * 10 + Number.parseInt(s[i], 10);
			i++;
		}
	}
	const conversion = i < s.length ? s[i] : "s";
	return { flags, width, precision, conversion, next: i + 1 };
}

function formatValue(spec: FormatSpec, arg: string): string {
	let result: string;

	switch (spec.conversion) {
		case "s": {
			result = arg;
			if (spec.precision >= 0) {
				result = result.slice(0, spec.precision);
			}
			break;
		}
		case "d":
		case "i": {
			const num = parseNumericArg(arg);
			result = Math.trunc(num).toString();
			if (spec.flags.includes("+") && num >= 0) {
				result = "+" + result;
			} else if (spec.flags.includes(" ") && num >= 0) {
				result = " " + result;
			}
			break;
		}
		case "o": {
			const num = Math.trunc(parseNumericArg(arg));
			result = (num >>> 0).toString(8);
			if (spec.flags.includes("#") && result !== "0") {
				result = "0" + result;
			}
			break;
		}
		case "x": {
			const num = Math.trunc(parseNumericArg(arg));
			result = (num >>> 0).toString(16);
			if (spec.flags.includes("#") && num !== 0) {
				result = "0x" + result;
			}
			break;
		}
		case "X": {
			const num = Math.trunc(parseNumericArg(arg));
			result = (num >>> 0).toString(16).toUpperCase();
			if (spec.flags.includes("#") && num !== 0) {
				result = "0X" + result;
			}
			break;
		}
		case "f":
		case "F": {
			const num = parseNumericArg(arg);
			const prec = spec.precision >= 0 ? spec.precision : 6;
			result = num.toFixed(prec);
			if (spec.flags.includes("+") && num >= 0) {
				result = "+" + result;
			}
			if (spec.conversion === "F") {
				result = result.toUpperCase();
			}
			break;
		}
		case "e":
		case "E": {
			const num = parseNumericArg(arg);
			const prec = spec.precision >= 0 ? spec.precision : 6;
			result = num.toExponential(prec);
			if (spec.conversion === "E") {
				result = result.toUpperCase();
			}
			break;
		}
		case "g":
		case "G": {
			const num = parseNumericArg(arg);
			const prec = spec.precision >= 0 ? spec.precision : 6;
			result = num.toPrecision(prec);
			if (spec.conversion === "G") {
				result = result.toUpperCase();
			}
			break;
		}
		case "c": {
			result = arg.length > 0 ? arg[0] : "";
			break;
		}
		case "b": {
			result = interpretBPrintfEscapes(arg);
			break;
		}
		case "q": {
			result = "'" + arg.replace(/'/g, "'\\''") + "'";
			break;
		}
		default:
			result = "%" + spec.conversion;
			break;
	}

	if (spec.width > 0 && result.length < spec.width) {
		if (spec.flags.includes("-")) {
			result = result.padEnd(spec.width, " ");
		} else if (spec.flags.includes("0")) {
			// Zero-pad after the sign/prefix so -42 becomes -0042, not 00-42
			const prefixMatch = result.match(/^([+-\s]|0[xX])?/);
			const prefix = prefixMatch?.[0] ?? "";
			const body = result.slice(prefix.length);
			result = prefix + body.padStart(spec.width - prefix.length, "0");
		} else {
			result = result.padStart(spec.width, " ");
		}
	}

	return result;
}

function parseNumericArg(arg: string): number {
	if (arg === "") return 0;
	if (arg.startsWith("'") || arg.startsWith('"')) {
		return arg.length > 1 ? arg.charCodeAt(1) : 0;
	}
	const num = Number(arg);
	return Number.isNaN(num) ? 0 : num;
}

function interpretBPrintfEscapes(s: string): string {
	let result = "";
	let i = 0;
	while (i < s.length) {
		if (s[i] === "\\" && i + 1 < s.length) {
			const esc = parseEscape(s, i);
			result += esc.char;
			i = esc.next;
		} else {
			result += s[i];
			i++;
		}
	}
	return result;
}
