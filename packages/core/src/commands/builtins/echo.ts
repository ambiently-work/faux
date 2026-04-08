import { command } from "../builder.js";

export const echo = command("echo")
	.description("Display a line of text")
	.flag("-n", "Do not output trailing newline")
	.flag("-e", "Enable interpretation of backslash escapes")
	.flag("-E", "Disable interpretation of backslash escapes")
	.allowUnknownFlags()
	.stopAfterFirstPositional()
	.action((ctx, { args, flags }) => {
		const newline = !flags.n;
		let interpretEscapes = !!flags.e;
		if (flags.E) interpretEscapes = false;

		let output = args.join(" ");

		if (interpretEscapes) {
			output = interpretEscapeSequences(output);
		}

		ctx.stdout.write(output);
		if (newline) {
			ctx.stdout.write("\n");
		}
		return 0;
	})
	.toHandler();

function interpretEscapeSequences(s: string): string {
	let result = "";
	let i = 0;
	while (i < s.length) {
		if (s[i] === "\\" && i + 1 < s.length) {
			const next = s[i + 1];
			switch (next) {
				case "n":
					result += "\n";
					i += 2;
					break;
				case "t":
					result += "\t";
					i += 2;
					break;
				case "r":
					result += "\r";
					i += 2;
					break;
				case "\\":
					result += "\\";
					i += 2;
					break;
				case "a":
					result += "\x07";
					i += 2;
					break;
				case "b":
					result += "\b";
					i += 2;
					break;
				case "f":
					result += "\f";
					i += 2;
					break;
				case "v":
					result += "\v";
					i += 2;
					break;
				case "e":
				case "E":
					result += "\x1b";
					i += 2;
					break;
				case "0": {
					let octal = "";
					let j = i + 2;
					while (j < s.length && j < i + 5 && s[j] >= "0" && s[j] <= "7") {
						octal += s[j];
						j++;
					}
					result += String.fromCharCode(octal.length > 0 ? Number.parseInt(octal, 8) : 0);
					i = j;
					break;
				}
				case "x": {
					let hex = "";
					let j = i + 2;
					while (j < s.length && j < i + 4 && /[0-9a-fA-F]/.test(s[j])) {
						hex += s[j];
						j++;
					}
					if (hex.length > 0) {
						result += String.fromCharCode(Number.parseInt(hex, 16));
						i = j;
					} else {
						result += "\\x";
						i += 2;
					}
					break;
				}
				case "c":
					return result;
				default:
					result += "\\";
					result += next;
					i += 2;
					break;
			}
		} else {
			result += s[i];
			i++;
		}
	}
	return result;
}
