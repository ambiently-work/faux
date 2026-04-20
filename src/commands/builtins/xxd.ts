import { command } from "../builder.js";

export const xxd = command("xxd")
	.description("Make a hex dump or do the reverse")
	.flag("-r, --reverse", "Reverse operation: convert hex dump into binary")
	.number("-c, --cols <n>", "Format output per line with n octets", { default: 16 })
	.argument("[file]", "Input file")
	.action((ctx, { args, flags }) => {
		const reverse = flags.reverse as boolean;
		const cols = flags.cols as number;

		let input: string;
		if (args.length > 0) {
			try {
				input = ctx.fs.readFile(ctx.resolve(args[0]));
			} catch {
				ctx.stderr.writeln(`xxd: ${args[0]}: No such file or directory`);
				return 1;
			}
		} else {
			input = ctx.stdin;
		}

		if (reverse) {
			// Reverse hex dump to binary
			let result = "";
			const lines = input.split("\n");
			for (const line of lines) {
				if (line.trim() === "") continue;
				// Parse hex bytes after offset
				const match = line.match(/^[0-9a-f]+:\s*(.+?)(?:\s{2,}|$)/i);
				if (match) {
					const hexStr = match[1].replace(/\s/g, "");
					for (let j = 0; j < hexStr.length; j += 2) {
						const byte = Number.parseInt(hexStr.slice(j, j + 2), 16);
						result += String.fromCharCode(byte);
					}
				}
			}
			ctx.stdout.write(result);
		} else {
			// Forward hex dump
			let offset = 0;
			while (offset < input.length) {
				const chunk = input.slice(offset, offset + cols);
				const offsetHex = offset.toString(16).padStart(8, "0");

				let hexPart = "";
				for (let j = 0; j < cols; j++) {
					if (j < chunk.length) {
						hexPart += chunk.charCodeAt(j).toString(16).padStart(2, "0");
					} else {
						hexPart += "  ";
					}
					if (j % 2 === 1) hexPart += " ";
				}

				let asciiPart = "";
				for (let j = 0; j < chunk.length; j++) {
					const code = chunk.charCodeAt(j);
					asciiPart += code >= 32 && code < 127 ? chunk[j] : ".";
				}

				ctx.stdout.writeln(
					`${offsetHex}: ${hexPart.trimEnd().padEnd(cols * 2 + Math.floor(cols / 2), " ")}  ${asciiPart}`,
				);
				offset += cols;
			}
		}

		return 0;
	})
	.toHandler();
