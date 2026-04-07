import { command } from "../builder.js";

export const ln = command("ln")
	.description("Make links between files")
	.flag("-s, --symbolic", "Create symbolic link")
	.flag("-f, --force", "Remove existing destination files")
	.argument("<target>", "Link target")
	.argument("<link>", "Link name")
	.action((ctx, { args, flags }) => {
		const force = !!flags.force;

		// Default to symlink since hard links don't make sense in VFS
		// symbolic = true;

		if (args.length < 1) {
			ctx.stderr.writeln("ln: missing file operand");
			return 1;
		}

		if (args.length === 1) {
			ctx.stderr.writeln("ln: missing destination file operand");
			return 1;
		}

		const target = args[0];
		const linkPath = ctx.resolve(args[1]);

		try {
			if (force) {
				try {
					ctx.fs.rm(linkPath, { force: true });
				} catch {
					// ignore
				}
			}
			ctx.fs.symlink(target, linkPath);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("EEXIST")) {
				ctx.stderr.writeln(`ln: failed to create symbolic link '${args[1]}': File exists`);
			} else {
				ctx.stderr.writeln(`ln: ${msg}`);
			}
			return 1;
		}

		return 0;
	})
	.toHandler();
