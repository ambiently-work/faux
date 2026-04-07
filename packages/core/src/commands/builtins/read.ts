import { command } from "../builder.js";

export const read = command("read")
	.description("Read a line from standard input")
	.allowUnknownFlags()
	.argument("[varnames...]", "Variable names to read into")
	.action(async (ctx, { raw }) => {
		let rawMode = false;
		let prompt = "";
		let arrayName = "";
		let delimiter = "\n";
		let nchars = -1;
		let silent = false;
		let timeout = -1;
		const varNames: string[] = [];

		let i = 0;
		while (i < raw.length) {
			const arg = raw[i];
			if (arg === "-r") {
				rawMode = true;
				i++;
			} else if (arg === "-p") {
				i++;
				prompt = raw[i] ?? "";
				i++;
			} else if (arg === "-a") {
				i++;
				arrayName = raw[i] ?? "MAPFILE";
				i++;
			} else if (arg === "-d") {
				i++;
				delimiter = raw[i] ?? "\n";
				i++;
			} else if (arg === "-n") {
				i++;
				nchars = Number.parseInt(raw[i] ?? "0", 10);
				i++;
			} else if (arg === "-s") {
				silent = true;
				i++;
			} else if (arg === "-t") {
				i++;
				timeout = Number.parseFloat(raw[i] ?? "0");
				i++;
			} else {
				varNames.push(arg);
				i++;
			}
		}

		if (prompt && !silent) {
			ctx.stdout.write(prompt);
		}

		let input = ctx.stdin;

		if (timeout > 0) {
			// In VFS context, stdin is already provided, so timeout is a no-op
			// but we respect the contract
			const timeoutMs = timeout * 1000;
			const result = await Promise.race([
				Promise.resolve(input),
				new Promise<null>((resolve) => {
					(globalThis as any).setTimeout(() => resolve(null), timeoutMs);
				}),
			]);
			if (result === null) {
				return 1;
			}
			input = result;
		}

		// Find the line based on delimiter
		let line: string;
		const delimIdx = input.indexOf(delimiter);
		if (delimIdx >= 0) {
			line = input.slice(0, delimIdx);
		} else {
			line = input;
		}

		// Limit to nchars if specified
		if (nchars >= 0) {
			line = line.slice(0, nchars);
		}

		// Handle backslash escapes unless -r
		if (!rawMode) {
			line = line.replace(/\\(.)/g, "$1");
		}

		// Handle -a (array mode)
		if (arrayName) {
			const words = splitWords(line);
			for (let j = 0; j < words.length; j++) {
				ctx.env.set(`${arrayName}_${j}`, words[j]);
			}
			ctx.env.set(arrayName, words.join(" "));
			return line.length === 0 && input.length === 0 ? 1 : 0;
		}

		// Split into variables
		if (varNames.length === 0) {
			varNames.push("REPLY");
		}

		const words = splitWords(line);

		for (let j = 0; j < varNames.length; j++) {
			if (j === varNames.length - 1) {
				// Last variable gets remainder
				ctx.env.set(varNames[j], words.slice(j).join(" "));
			} else {
				ctx.env.set(varNames[j], words[j] ?? "");
			}
		}

		// Return 1 if EOF (empty input)
		return line.length === 0 && input.length === 0 ? 1 : 0;
	})
	.toHandler();

function splitWords(line: string): string[] {
	const result: string[] = [];
	let current = "";
	let inWhitespace = true;

	for (const ch of line) {
		if (ch === " " || ch === "\t") {
			if (!inWhitespace && current.length > 0) {
				result.push(current);
				current = "";
			}
			inWhitespace = true;
		} else {
			inWhitespace = false;
			current += ch;
		}
	}

	if (current.length > 0) {
		result.push(current);
	}

	return result;
}
