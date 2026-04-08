import { command } from "../builder.js";

export const head = command("head")
	.description("Output the first part of files")
	.option("-n, --lines <n>", "Number of lines")
	.option("-c, --bytes <n>", "Number of bytes")
	.argument("[file...]", "Input files")
	.allowUnknownFlags()
	.action((ctx, { args, flags }) => {
		let lineCount: number | null = null;
		let byteCount: number | null = null;
		const files: string[] = [];

		// Parse flags from builder
		if (flags.lines !== undefined && flags.lines !== false) {
			lineCount = Number.parseInt(flags.lines as string, 10);
		}
		if (flags.bytes !== undefined && flags.bytes !== false) {
			byteCount = Number.parseInt(flags.bytes as string, 10);
		}

		// Separate bare -N patterns from file args
		for (const arg of args) {
			if (/^-\d+$/.test(arg)) {
				lineCount = Number.parseInt(arg.slice(1), 10);
			} else {
				files.push(arg);
			}
		}

		if (lineCount === null && byteCount === null) {
			lineCount = 10;
		}

		const multiFile = files.length > 1;

		const processContent = (content: string, header: string | null): void => {
			if (header !== null) {
				ctx.stdout.writeln(`==> ${header} <==`);
			}
			if (byteCount !== null) {
				ctx.stdout.write(content.slice(0, byteCount));
			} else {
				const lines = content.split("\n");
				const n = lineCount!;
				const output = lines.slice(0, n);
				// Rejoin and preserve the fact that split produces an extra element
				if (output.length > 0) {
					if (output.length < lines.length) {
						ctx.stdout.write(output.join("\n") + "\n");
					} else {
						// We have all lines including potentially trailing
						ctx.stdout.write(output.join("\n"));
					}
				}
			}
		};

		if (files.length === 0) {
			processContent(ctx.stdin, null);
		} else {
			let exitCode = 0;
			for (let idx = 0; idx < files.length; idx++) {
				const file = files[idx];
				const resolved = ctx.resolve(file);
				try {
					const content = ctx.fs.readFile(resolved);
					if (idx > 0) ctx.stdout.write("\n");
					processContent(content, multiFile ? file : null);
				} catch {
					ctx.stderr.writeln(`head: cannot open '${file}' for reading: No such file or directory`);
					exitCode = 1;
				}
			}
			return exitCode;
		}

		return 0;
	})
	.toHandler();
