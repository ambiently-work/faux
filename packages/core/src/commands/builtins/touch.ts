import { command } from "../builder.js";

export const touch = command("touch")
	.description("Change file timestamps or create empty files")
	.flag("-a", "Change only access time")
	.flag("-m", "Change only modification time")
	.flag("-c", "Do not create any files")
	.argument("<files...>", "Files to touch")
	.action((ctx, { args: files }) => {
		if (files.length === 0) {
			ctx.stderr.writeln("touch: missing file operand");
			return 1;
		}

		let exitCode = 0;

		for (const file of files) {
			const resolved = ctx.resolve(file);
			try {
				if (ctx.fs.exists(resolved)) {
					// Update mtime by reading and rewriting the file
					const st = ctx.fs.stat(resolved);
					if (st.isFile()) {
						const content = ctx.fs.readFile(resolved);
						ctx.fs.writeFile(resolved, content);
					} else if (st.isDirectory()) {
						// For directories, chmod to same mode triggers ctime update
						ctx.fs.chmod(resolved, st.mode);
					}
				} else {
					ctx.fs.writeFile(resolved, "");
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.stderr.writeln(`touch: cannot touch '${file}': ${msg}`);
				exitCode = 1;
			}
		}

		return exitCode;
	})
	.toHandler();
