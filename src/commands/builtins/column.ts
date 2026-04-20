import { command } from "../builder.js";

export const column = command("column")
	.description("Columnate lists")
	.flag("-t, --table", "Create a table")
	.option("-s, --separator <sep>", "Column separator", { default: " \t" })
	.argument("[file...]", "Input files")
	.action((ctx, { args: files, flags }) => {
		const tableMode = flags.table as boolean;
		const separator = flags.separator as string;

		let input: string;
		if (files.length > 0) {
			const parts: string[] = [];
			for (const file of files) {
				try {
					parts.push(ctx.fs.readFile(ctx.resolve(file)));
				} catch {
					ctx.stderr.writeln(`column: ${file}: No such file or directory`);
					return 1;
				}
			}
			input = parts.join("");
		} else {
			input = ctx.stdin;
		}

		const lines = input.split("\n");
		if (input.endsWith("\n") && lines.length > 0 && lines[lines.length - 1] === "") {
			lines.pop();
		}

		if (tableMode) {
			// Split each line into fields
			const sepRegex =
				separator.length === 1
					? new RegExp(`[${separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+`)
					: /[\s]+/;

			const rows: string[][] = [];
			const colWidths: number[] = [];

			for (const line of lines) {
				if (line.trim() === "") {
					rows.push([]);
					continue;
				}
				const fields = line.split(sepRegex).filter((f) => f.length > 0);
				rows.push(fields);
				for (let j = 0; j < fields.length; j++) {
					if (j >= colWidths.length) colWidths.push(0);
					colWidths[j] = Math.max(colWidths[j], fields[j].length);
				}
			}

			for (const row of rows) {
				if (row.length === 0) {
					ctx.stdout.writeln("");
					continue;
				}
				const parts: string[] = [];
				for (let j = 0; j < row.length; j++) {
					if (j === row.length - 1) {
						parts.push(row[j]);
					} else {
						parts.push(row[j].padEnd(colWidths[j] + 2, " "));
					}
				}
				ctx.stdout.writeln(parts.join(""));
			}
		} else {
			// Simple column fill
			for (const line of lines) {
				ctx.stdout.writeln(line);
			}
		}

		return 0;
	})
	.toHandler();
