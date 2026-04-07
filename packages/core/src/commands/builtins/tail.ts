import { command } from "../builder.js";

export const tail = command("tail")
	.description("Output the last part of files")
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
				ctx.stdout.write(content.slice(-byteCount));
			} else {
				const n = lineCount!;
				// Split preserving the trailing newline behavior
				const hasTrailing = content.endsWith("\n");
				let lines = content.split("\n");
				if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
					lines = lines.slice(0, -1);
				}
				const output = lines.slice(-n);
				if (output.length > 0) {
					ctx.stdout.write(output.join("\n") + "\n");
				}
			}
		};

		if (files.length === 0) {
			processContent(ctx.stdin, null);
		} else {
			for (let idx = 0; idx < files.length; idx++) {
				const file = files[idx];
				const resolved = ctx.resolve(file);
				try {
					const content = ctx.fs.readFile(resolved);
					if (idx > 0) ctx.stdout.write("\n");
					processContent(content, multiFile ? file : null);
				} catch {
					ctx.stderr.writeln(`tail: cannot open '${file}' for reading: No such file or directory`);
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();
