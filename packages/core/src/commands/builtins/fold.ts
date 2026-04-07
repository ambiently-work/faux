import { command } from "../builder.js";

export const fold = command("fold")
	.description("Wrap each input line to fit in specified width")
	.number("-w, --width <n>", "Use width columns", { default: 80 })
	.flag("-s, --spaces", "Break at spaces")
	.argument("[file...]", "Input files")
	.action((ctx, { args: files, flags }) => {
		const width = flags.width as number;
		const breakAtSpaces = flags.spaces as boolean;

		const processContent = (content: string): void => {
			const lines = content.split("\n");
			const hasTrailing = content.endsWith("\n") && content.length > 0;
			if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
				lines.pop();
			}

			for (const line of lines) {
				if (line.length <= width) {
					ctx.stdout.writeln(line);
					continue;
				}

				let remaining = line;
				while (remaining.length > width) {
					if (breakAtSpaces) {
						// Find last space within width
						let breakPos = remaining.lastIndexOf(" ", width);
						if (breakPos <= 0) {
							breakPos = width;
						}
						ctx.stdout.writeln(remaining.slice(0, breakPos));
						remaining = remaining.slice(breakPos === width ? breakPos : breakPos + 1);
					} else {
						ctx.stdout.writeln(remaining.slice(0, width));
						remaining = remaining.slice(width);
					}
				}
				if (remaining.length > 0) {
					ctx.stdout.writeln(remaining);
				}
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
					ctx.stderr.writeln("fold: " + file + ": No such file or directory");
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();
