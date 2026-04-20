import { command } from "../builder.js";

export const tac = command("tac")
	.description("Concatenate and print files in reverse")
	.argument("[file...]", "Input files")
	.action((ctx, { args: files }) => {
		const processContent = (content: string): void => {
			const hasTrailing = content.endsWith("\n") && content.length > 0;
			const lines = content.split("\n");
			if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
				lines.pop();
			}
			lines.reverse();
			for (const line of lines) {
				ctx.stdout.writeln(line);
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
					ctx.stderr.writeln(`tac: ${file}: No such file or directory`);
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();
