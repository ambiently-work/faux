import { command } from "../builder.js";

export const nl = command("nl")
	.description("Number lines of files")
	.option("-b, --body-numbering <style>", "Body line numbering style", { default: "t" })
	.option("-s, --number-separator <sep>", "Add string after line number", { default: "\t" })
	.argument("[file...]", "Input files")
	.action((ctx, { args: files, flags }) => {
		const bodyNumbering = flags.bodyNumbering as string;
		const separator = flags.numberSeparator as string;

		const processContent = (content: string): void => {
			const hasTrailing = content.endsWith("\n") && content.length > 0;
			const lines = content.split("\n");
			if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
				lines.pop();
			}

			let lineNum = 1;
			for (const line of lines) {
				const isEmpty = line === "";
				let shouldNumber = false;

				if (bodyNumbering === "a") {
					shouldNumber = true;
				} else if (bodyNumbering === "t") {
					shouldNumber = !isEmpty;
				}
				// "n" means no numbering

				if (shouldNumber) {
					const num = String(lineNum).padStart(6, " ");
					ctx.stdout.writeln(num + separator + line);
					lineNum++;
				} else {
					ctx.stdout.writeln("      " + separator + line);
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
					ctx.stderr.writeln("nl: " + file + ": No such file or directory");
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();
