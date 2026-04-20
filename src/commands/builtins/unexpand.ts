import { command } from "../builder.js";

export const unexpand = command("unexpand")
	.description("Convert spaces to tabs")
	.number("-t, --tabs <n>", "Have tabs n characters apart", { default: 8 })
	.argument("[file...]", "Input files")
	.action((ctx, { args: files, flags }) => {
		const tabWidth = flags.tabs as number;

		const processContent = (content: string): void => {
			const lines = content.split("\n");
			const hasTrailing = content.endsWith("\n") && content.length > 0;
			if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
				lines.pop();
			}

			for (const line of lines) {
				// Only convert leading spaces
				let result = "";
				let col = 0;
				let inLeading = true;

				for (let j = 0; j < line.length; j++) {
					if (inLeading && line[j] === " ") {
						col++;
						if (col % tabWidth === 0) {
							result += "\t";
						}
					} else if (inLeading && line[j] === "\t") {
						result += "\t";
						col = ((col / tabWidth) | 0) * tabWidth + tabWidth;
					} else {
						if (inLeading) {
							// Flush remaining spaces
							const remaining = col % tabWidth;
							result += " ".repeat(remaining);
							inLeading = false;
						}
						result += line[j];
					}
				}
				if (inLeading) {
					const remaining = col % tabWidth;
					result += " ".repeat(remaining);
				}
				ctx.stdout.writeln(result);
			}
		};

		if (files.length === 0) {
			processContent(ctx.stdin);
		} else {
			for (const file of files) {
				const resolved = ctx.resolve(file);
				try {
					const content = ctx.fs.readFile(resolved);
					processContent(content);
				} catch {
					ctx.stderr.writeln(`unexpand: ${file}: No such file or directory`);
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();
