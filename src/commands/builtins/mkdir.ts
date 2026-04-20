import { command } from "../builder.js";

export const mkdir = command("mkdir")
	.description("Create directories")
	.flag("-p", "Create parent directories as needed")
	.option("-m <mode>", "Set file mode (as in chmod)")
	.argument("<dirs...>", "Directories to create")
	.action((ctx, { args: dirs, flags }) => {
		const parents = !!flags.p;
		const mode = flags.m ? Number.parseInt(flags.m as string, 8) : null;

		if (dirs.length === 0) {
			ctx.stderr.writeln("mkdir: missing operand");
			return 1;
		}

		let exitCode = 0;

		for (const dir of dirs) {
			const resolved = ctx.resolve(dir);
			try {
				ctx.fs.mkdir(resolved, { recursive: parents });
				if (mode !== null) {
					ctx.fs.chmod(resolved, mode);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("EEXIST")) {
					if (!parents) {
						ctx.stderr.writeln(`mkdir: cannot create directory '${dir}': File exists`);
						exitCode = 1;
					}
				} else if (msg.includes("ENOENT")) {
					ctx.stderr.writeln(`mkdir: cannot create directory '${dir}': No such file or directory`);
					exitCode = 1;
				} else {
					ctx.stderr.writeln(`mkdir: ${dir}: ${msg}`);
					exitCode = 1;
				}
			}
		}

		return exitCode;
	})
	.toHandler();
