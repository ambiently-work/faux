import { command } from "../builder.js";

export const tee = command("tee")
	.description("Read from stdin and write to stdout and files")
	.flag("-a, --append", "Append to the given files, do not overwrite")
	.argument("[file...]", "Output files")
	.action((ctx, { args: files, flags }) => {
		const append = flags.append as boolean;
		const content = ctx.stdin;

		// Write to stdout
		ctx.stdout.write(content);

		// Write to each file
		for (const file of files) {
			const resolved = ctx.resolve(file);
			try {
				if (append) {
					ctx.fs.appendFile(resolved, content);
				} else {
					ctx.fs.writeFile(resolved, content);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.stderr.writeln("tee: " + file + ": " + msg);
				return 1;
			}
		}

		return 0;
	})
	.toHandler();
