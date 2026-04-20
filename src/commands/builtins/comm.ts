import { command } from "../builder.js";

export const comm = command("comm")
	.description("Compare two sorted files line by line")
	.flag("-1, --suppress-col1", "Suppress column 1 (lines unique to file1)")
	.flag("-2, --suppress-col2", "Suppress column 2 (lines unique to file2)")
	.flag("-3, --suppress-col3", "Suppress column 3 (lines common to both)")
	.argument("<file1>", "First file")
	.argument("<file2>", "Second file")
	.action((ctx, { args, flags }) => {
		const suppress1 = flags.suppressCol1 as boolean;
		const suppress2 = flags.suppressCol2 as boolean;
		const suppress3 = flags.suppressCol3 as boolean;

		if (args.length < 2) {
			ctx.stderr.writeln("comm: missing operand");
			return 1;
		}

		let content1: string;
		let content2: string;

		try {
			content1 = ctx.fs.readFile(ctx.resolve(args[0]));
		} catch {
			ctx.stderr.writeln(`comm: ${args[0]}: No such file or directory`);
			return 1;
		}

		try {
			content2 = ctx.fs.readFile(ctx.resolve(args[1]));
		} catch {
			ctx.stderr.writeln(`comm: ${args[1]}: No such file or directory`);
			return 1;
		}

		const lines1 = splitLines(content1);
		const lines2 = splitLines(content2);

		let i1 = 0;
		let i2 = 0;

		const col1Prefix = "";
		const col2Prefix = suppress1 ? "" : "\t";
		const col3Prefix = (suppress1 ? "" : "\t") + (suppress2 ? "" : "\t");

		while (i1 < lines1.length || i2 < lines2.length) {
			if (i1 >= lines1.length) {
				// Only file2 lines left
				if (!suppress2) {
					ctx.stdout.writeln(col2Prefix + lines2[i2]);
				}
				i2++;
			} else if (i2 >= lines2.length) {
				// Only file1 lines left
				if (!suppress1) {
					ctx.stdout.writeln(col1Prefix + lines1[i1]);
				}
				i1++;
			} else if (lines1[i1] < lines2[i2]) {
				if (!suppress1) {
					ctx.stdout.writeln(col1Prefix + lines1[i1]);
				}
				i1++;
			} else if (lines1[i1] > lines2[i2]) {
				if (!suppress2) {
					ctx.stdout.writeln(col2Prefix + lines2[i2]);
				}
				i2++;
			} else {
				// Equal
				if (!suppress3) {
					ctx.stdout.writeln(col3Prefix + lines1[i1]);
				}
				i1++;
				i2++;
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
