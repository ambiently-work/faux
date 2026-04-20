import { command } from "../builder.js";

export const realpath = command("realpath")
	.description("Print the resolved absolute file name")
	.flag("-q, --quiet", "Suppress error messages")
	.flag("-s, --no-symlinks", "Do not follow symlinks, just normalize")
	.stopAfterFirstPositional()
	.action((ctx, { args, flags }) => {
		if (args.length === 0) {
			ctx.stderr.writeln("realpath: missing operand");
			return 1;
		}

		const quiet = flags.quiet as boolean;
		const noSymlinks = flags.noSymlinks as boolean;

		let exitCode = 0;
		for (const p of args) {
			const resolved = ctx.resolve(p);
			try {
				if (noSymlinks) {
					ctx.stdout.writeln(resolved);
				} else {
					const real = ctx.fs.realpath(resolved);
					ctx.stdout.writeln(real);
				}
			} catch {
				if (!quiet) {
					ctx.stderr.writeln(`realpath: ${p}: No such file or directory`);
				}
				exitCode = 1;
			}
		}

		return exitCode;
	})
	.toHandler();
