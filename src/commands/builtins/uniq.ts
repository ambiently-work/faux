import { command } from "../builder.js";

export const uniq = command("uniq")
	.description("Report or omit repeated lines")
	.flag("-c, --count", "Prefix lines by the number of occurrences")
	.flag("-d, --repeated", "Only print duplicate lines")
	.flag("-u, --unique", "Only print unique lines")
	.flag("-i, --ignore-case", "Ignore differences in case when comparing")
	.argument("[input]", "Input file")
	.argument("[output]", "Output file")
	.action((ctx, { args, flags }) => {
		const showCount = flags.count as boolean;
		const onlyDuplicates = flags.repeated as boolean;
		const onlyUnique = flags.unique as boolean;
		const caseInsensitive = flags.ignoreCase as boolean;

		let content: string;
		if (args.length === 0) {
			content = ctx.stdin;
		} else {
			const resolved = ctx.resolve(args[0]);
			try {
				content = ctx.fs.readFile(resolved);
			} catch {
				ctx.stderr.writeln(`uniq: ${args[0]}: No such file or directory`);
				return 1;
			}
		}

		const hasTrailing = content.endsWith("\n") && content.length > 0;
		const lines = content.split("\n");
		if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
			lines.pop();
		}

		const compare = (a: string, b: string): boolean => {
			if (caseInsensitive) {
				return a.toLowerCase() === b.toLowerCase();
			}
			return a === b;
		};

		// Group adjacent lines
		const groups: { line: string; count: number }[] = [];
		for (const line of lines) {
			if (groups.length > 0 && compare(groups[groups.length - 1].line, line)) {
				groups[groups.length - 1].count++;
			} else {
				groups.push({ line, count: 1 });
			}
		}

		// Output file (second arg)
		const outputFile = args.length > 1 ? args[1] : null;

		const outputLines: string[] = [];

		for (const group of groups) {
			if (onlyDuplicates && group.count < 2) continue;
			if (onlyUnique && group.count > 1) continue;

			if (showCount) {
				outputLines.push(`${String(group.count).padStart(7, " ")} ${group.line}`);
			} else {
				outputLines.push(group.line);
			}
		}

		const output = outputLines.length > 0 ? `${outputLines.join("\n")}\n` : "";

		if (outputFile) {
			const resolved = ctx.resolve(outputFile);
			ctx.fs.writeFile(resolved, output);
		} else {
			ctx.stdout.write(output);
		}

		return 0;
	})
	.toHandler();
