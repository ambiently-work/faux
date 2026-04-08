import { command } from "../builder.js";

export const paste = command("paste")
	.description("Merge lines of files")
	.option("-d, --delimiters <list>", "Reuse characters from list instead of TABs", {
		default: "\t",
	})
	.flag("-s, --serial", "Paste one file at a time instead of in parallel")
	.argument("[file...]", "Input files")
	.action((ctx, { args: files, flags }) => {
		const delimiter = flags.delimiters as string;
		const serial = flags.serial as boolean;

		// Read all file contents
		const fileLines: string[][] = [];
		for (const file of files) {
			if (file === "-") {
				const lines = ctx.stdin.split("\n");
				if (lines.length > 0 && lines[lines.length - 1] === "" && ctx.stdin.endsWith("\n")) {
					lines.pop();
				}
				fileLines.push(lines);
			} else {
				const resolved = ctx.resolve(file);
				try {
					const content = ctx.fs.readFile(resolved);
					const lines = content.split("\n");
					if (lines.length > 0 && lines[lines.length - 1] === "" && content.endsWith("\n")) {
						lines.pop();
					}
					fileLines.push(lines);
				} catch {
					ctx.stderr.writeln("paste: " + file + ": No such file or directory");
					return 1;
				}
			}
		}

		if (files.length === 0) {
			// Read from stdin
			const lines = ctx.stdin.split("\n");
			if (lines.length > 0 && lines[lines.length - 1] === "" && ctx.stdin.endsWith("\n")) {
				lines.pop();
			}
			fileLines.push(lines);
		}

		const getDelim = (idx: number): string => {
			if (delimiter.length === 0) return "";
			return delimiter[idx % delimiter.length];
		};

		if (serial) {
			for (let f = 0; f < fileLines.length; f++) {
				const lines = fileLines[f];
				if (lines.length === 0) {
					ctx.stdout.writeln("");
					continue;
				}
				let result = lines[0];
				for (let j = 1; j < lines.length; j++) {
					result += getDelim(j - 1) + lines[j];
				}
				ctx.stdout.writeln(result);
			}
		} else {
			// Merge line by line
			let maxLines = 0;
			for (const lines of fileLines) {
				if (lines.length > maxLines) maxLines = lines.length;
			}

			for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
				const parts: string[] = [];
				for (let f = 0; f < fileLines.length; f++) {
					parts.push(fileLines[f][lineIdx] ?? "");
				}
				// Join with cycling delimiters
				let result = parts[0];
				for (let f = 1; f < parts.length; f++) {
					result += getDelim(f - 1) + parts[f];
				}
				ctx.stdout.writeln(result);
			}
		}

		return 0;
	})
	.toHandler();
