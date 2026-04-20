import { command } from "../builder.js";

function parseRanges(spec: string): { start: number; end: number }[] {
	const ranges: { start: number; end: number }[] = [];
	const parts = spec.split(",");

	for (const part of parts) {
		if (part.includes("-")) {
			const [a, b] = part.split("-");
			const start = a === "" ? 1 : Number.parseInt(a, 10);
			const end = b === "" ? Number.MAX_SAFE_INTEGER : Number.parseInt(b, 10);
			ranges.push({ start, end });
		} else {
			const n = Number.parseInt(part, 10);
			ranges.push({ start: n, end: n });
		}
	}

	return ranges;
}

function inRange(pos: number, ranges: { start: number; end: number }[]): boolean {
	for (const r of ranges) {
		if (pos >= r.start && pos <= r.end) return true;
	}
	return false;
}

export const cut = command("cut")
	.description("Remove sections from each line of files")
	.option("-d, --delimiter <delim>", "Use delim as field delimiter", { default: "\t" })
	.option("-f, --fields <list>", "Select only these fields")
	.option("-c, --characters <list>", "Select only these characters")
	.argument("[file...]", "Input files")
	.action((ctx, { args: files, flags }) => {
		const delimiter = flags.delimiter as string;
		const fieldSpec = (flags.fields as string | undefined) ?? null;
		const charSpec = (flags.characters as string | undefined) ?? null;

		if (!fieldSpec && !charSpec) {
			ctx.stderr.writeln("cut: you must specify a list of bytes, characters, or fields");
			return 1;
		}

		const ranges = parseRanges(fieldSpec ?? charSpec!);

		const processLine = (line: string): string => {
			if (charSpec) {
				let result = "";
				for (let j = 0; j < line.length; j++) {
					if (inRange(j + 1, ranges)) {
						result += line[j];
					}
				}
				return result;
			}

			// Field mode
			const fields = line.split(delimiter);
			if (fields.length === 1 && !line.includes(delimiter)) {
				// No delimiter found, output entire line
				return line;
			}

			const selected: string[] = [];
			for (let j = 0; j < fields.length; j++) {
				if (inRange(j + 1, ranges)) {
					selected.push(fields[j]);
				}
			}
			return selected.join(delimiter);
		};

		const processContent = (content: string): void => {
			const lines = content.split("\n");
			const hasTrailing = content.endsWith("\n") && content.length > 0;
			if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
				lines.pop();
			}
			for (const line of lines) {
				ctx.stdout.writeln(processLine(line));
			}
		};

		if (files.length === 0) {
			processContent(ctx.stdin);
		} else {
			let exitCode = 0;
			for (const file of files) {
				const resolved = ctx.resolve(file);
				try {
					const content = ctx.fs.readFile(resolved);
					processContent(content);
				} catch {
					ctx.stderr.writeln(`cut: ${file}: No such file or directory`);
					exitCode = 1;
				}
			}
			return exitCode;
		}

		return 0;
	})
	.toHandler();
