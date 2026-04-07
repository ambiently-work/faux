import { command } from "../builder.js";

export const rev = command("rev")
	.description("Reverse lines characterwise")
	.argument("[file...]", "Input files")
	.action((ctx, { args: files }) => {
		const processContent = (content: string): void => {
			const lines = content.split("\n");
			const hasTrailing = content.endsWith("\n") && content.length > 0;
			if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
				lines.pop();
			}
			for (const line of lines) {
				ctx.stdout.writeln([...line].reverse().join(""));
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
					ctx.stderr.writeln("rev: " + file + ": No such file or directory");
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();
