import { command } from "../builder.js";

export const expand = command("expand")
	.description("Convert tabs to spaces")
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
				let result = "";
				let col = 0;
				for (let j = 0; j < line.length; j++) {
					if (line[j] === "\t") {
						const spaces = tabWidth - (col % tabWidth);
						result += " ".repeat(spaces);
						col += spaces;
					} else {
						result += line[j];
						col++;
					}
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
					ctx.stderr.writeln("expand: " + file + ": No such file or directory");
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();
