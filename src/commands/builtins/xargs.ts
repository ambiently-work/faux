import { command } from "../builder.js";

export const xargs = command("xargs")
	.description("Build and execute command lines from standard input")
	.number("-n, --max-args <n>", "Use at most n arguments per command line")
	.option("-d, --delimiter <delim>", "Use delim as delimiter instead of whitespace")
	.option("-I, --replace <replstr>", "Replace occurrences of replstr in command with input")
	.flag("-0, --null", "Input items are terminated by null character")
	.stopAfterFirstPositional()
	.action(async (ctx, { raw }) => {
		// xargs needs custom parsing: flags come first, then once we see a
		// non-flag token everything after is the command + its args
		let maxArgs = -1;
		let delimiter: string | null = null;
		let nullDelimiter = false;
		let replaceStr: string | null = null;
		let commandArgs: string[] = [];
		let commandFound = false;

		let i = 0;
		while (i < raw.length) {
			const arg = raw[i];
			if (!commandFound) {
				if (arg === "-n" && i + 1 < raw.length) {
					i++;
					maxArgs = Number.parseInt(raw[i], 10);
				} else if (arg === "-d" && i + 1 < raw.length) {
					i++;
					delimiter = raw[i];
				} else if (arg === "-0") {
					nullDelimiter = true;
				} else if (arg === "-I" && i + 1 < raw.length) {
					i++;
					replaceStr = raw[i];
				} else if (!arg.startsWith("-")) {
					commandFound = true;
					commandArgs.push(arg);
				}
			} else {
				commandArgs.push(arg);
			}
			i++;
		}

		if (commandArgs.length === 0) {
			commandArgs = ["echo"];
		}

		const input = ctx.stdin;
		let items: string[];

		if (nullDelimiter) {
			items = input.split("\0").filter((s) => s.length > 0);
		} else if (delimiter !== null) {
			items = input.split(delimiter).filter((s) => s.length > 0);
		} else {
			items = input.split(/\s+/).filter((s) => s.length > 0);
		}

		if (items.length === 0) {
			return 0;
		}

		let lastExitCode = 0;
		const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

		if (replaceStr) {
			const needle = replaceStr;
			for (const item of items) {
				const cmd = commandArgs.map((a) => shellQuote(a.split(needle).join(item))).join(" ");
				const result = await ctx.subExec(cmd);
				ctx.stdout.write(result.stdout);
				if (result.stderr) {
					ctx.stderr.write(result.stderr);
				}
				lastExitCode = result.exitCode;
			}
		} else if (maxArgs > 0) {
			for (let j = 0; j < items.length; j += maxArgs) {
				const batch = items.slice(j, j + maxArgs);
				const cmd = [...commandArgs, ...batch].map(shellQuote).join(" ");
				const result = await ctx.subExec(cmd);
				ctx.stdout.write(result.stdout);
				if (result.stderr) {
					ctx.stderr.write(result.stderr);
				}
				lastExitCode = result.exitCode;
			}
		} else {
			const cmd = [...commandArgs, ...items].map(shellQuote).join(" ");
			const result = await ctx.subExec(cmd);
			ctx.stdout.write(result.stdout);
			if (result.stderr) {
				ctx.stderr.write(result.stderr);
			}
			lastExitCode = result.exitCode;
		}

		return lastExitCode;
	})
	.toHandler();
