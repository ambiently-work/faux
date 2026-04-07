import { command } from "../builder.js";

export const join = command("join")
	.description("Join lines of two files on a common field")
	.option("-t, --separator <sep>", "Field separator", { default: " " })
	.number("-1, --field1 <n>", "Join on this field of file 1", { default: 1 })
	.number("-2, --field2 <n>", "Join on this field of file 2", { default: 1 })
	.argument("<file1>", "First file")
	.argument("<file2>", "Second file")
	.action((ctx, { args: files, flags }) => {
		const separator = flags.separator as string;
		const field1 = flags.field1 as number;
		const field2 = flags.field2 as number;

		let content1: string;
		let content2: string;

		try {
			content1 = ctx.fs.readFile(ctx.resolve(files[0]));
		} catch {
			ctx.stderr.writeln("join: " + files[0] + ": No such file or directory");
			return 1;
		}

		try {
			content2 = ctx.fs.readFile(ctx.resolve(files[1]));
		} catch {
			ctx.stderr.writeln("join: " + files[1] + ": No such file or directory");
			return 1;
		}

		const lines1 = splitLines(content1);
		const lines2 = splitLines(content2);

		const getField = (line: string, fieldNum: number): string => {
			const fields = line.split(separator);
			return fields[fieldNum - 1] ?? "";
		};

		const getOtherFields = (line: string, fieldNum: number): string[] => {
			const fields = line.split(separator);
			const result: string[] = [];
			for (let j = 0; j < fields.length; j++) {
				if (j !== fieldNum - 1) {
					result.push(fields[j]);
				}
			}
			return result;
		};

		// Build index for file2
		const file2Map = new Map<string, string[][]>();
		for (const line of lines2) {
			const key = getField(line, field2);
			if (!file2Map.has(key)) {
				file2Map.set(key, []);
			}
			file2Map.get(key)!.push(getOtherFields(line, field2));
		}

		// Join
		for (const line1 of lines1) {
			const key = getField(line1, field1);
			const matches = file2Map.get(key);
			if (matches) {
				const otherFields1 = getOtherFields(line1, field1);
				for (const otherFields2 of matches) {
					const parts = [key, ...otherFields1, ...otherFields2];
					ctx.stdout.writeln(parts.join(separator));
				}
			}
		}

		return 0;
	})
	.toHandler();

function splitLines(content: string): string[] {
	const lines = content.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "" && content.endsWith("\n")) {
		lines.pop();
	}
	return lines;
}
