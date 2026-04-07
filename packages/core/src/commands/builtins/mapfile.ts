import { command } from "../builder.js";

export const mapfile = command("mapfile")
	.description("Read lines from standard input into an array variable")
	.allowUnknownFlags()
	.argument("[array]", "Array variable name")
	.action((ctx, { raw }) => {
		let trimTrailing = false;
		let maxCount = -1;
		let skipCount = 0;
		let arrayName = "MAPFILE";

		let i = 0;
		while (i < raw.length) {
			const arg = raw[i];
			if (arg === "-t") {
				trimTrailing = true;
			} else if (arg === "-n" && i + 1 < raw.length) {
				i++;
				maxCount = Number.parseInt(raw[i], 10);
			} else if (arg === "-s" && i + 1 < raw.length) {
				i++;
				skipCount = Number.parseInt(raw[i], 10);
			} else if (!arg.startsWith("-")) {
				arrayName = arg;
			}
			i++;
		}

		const input = ctx.stdin;
		let lines = input.split("\n");

		// Remove trailing empty element from split if input ends with newline
		if (lines.length > 0 && lines[lines.length - 1] === "" && input.endsWith("\n")) {
			lines.pop();
		}

		// Skip lines
		if (skipCount > 0) {
			lines = lines.slice(skipCount);
		}

		// Limit count
		if (maxCount >= 0) {
			lines = lines.slice(0, maxCount);
		}

		// Store lines
		for (let j = 0; j < lines.length; j++) {
			let line = lines[j];
			if (trimTrailing) {
				// Remove trailing newline (already split, so just trim \n)
				line = line.replace(/\n$/, "");
			}
			ctx.env.set(`${arrayName}_${j}`, line);
		}

		// Store count
		ctx.env.set(arrayName, String(lines.length));

		return 0;
	})
	.toHandler();

export const readarray = command("readarray")
	.description("Read lines from standard input into an array variable")
	.allowUnknownFlags()
	.argument("[array]", "Array variable name")
	.action((ctx) => {
		return mapfile.execute(ctx);
	})
	.toHandler();
