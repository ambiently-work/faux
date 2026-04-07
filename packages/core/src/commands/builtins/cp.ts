import { command } from "../builder.js";

export const cp = command("cp")
	.description("Copy files and directories")
	.flag("-r, --recursive", "Copy directories recursively")
	.flag("-R", "Copy directories recursively")
	.flag("-f, --force", "Force overwrite")
	.argument("<operands...>", "Source(s) and destination")
	.action((ctx, { args: operands, flags }) => {
		const recursive = !!flags.recursive || !!flags.R;
		const force = !!flags.force;

		if (operands.length < 2) {
			ctx.stderr.writeln("cp: missing operand");
			return 1;
		}

		const dest = ctx.resolve(operands[operands.length - 1]);
		const sources = operands.slice(0, -1);

		let destIsDir = false;
		try {
			const destStat = ctx.fs.stat(dest);
			destIsDir = destStat.isDirectory();
		} catch {
			// dest doesn't exist
		}

		if (sources.length > 1 && !destIsDir) {
			ctx.stderr.writeln(`cp: target '${operands[operands.length - 1]}' is not a directory`);
			return 1;
		}

		let exitCode = 0;

		for (const src of sources) {
			const resolvedSrc = ctx.resolve(src);
			try {
				const srcStat = ctx.fs.stat(resolvedSrc);
				if (srcStat.isDirectory() && !recursive) {
					ctx.stderr.writeln(`cp: -r not specified; omitting directory '${src}'`);
					exitCode = 1;
					continue;
				}

				if (force) {
					// Remove dest if it exists (for overwrite)
					const finalDest = destIsDir ? dest + "/" + src.split("/").pop() : dest;
					try {
						ctx.fs.rm(finalDest, { force: true });
					} catch {
						// ignore
					}
				}

				ctx.fs.cp(resolvedSrc, dest, { recursive });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("ENOENT")) {
					ctx.stderr.writeln(`cp: cannot stat '${src}': No such file or directory`);
				} else {
					ctx.stderr.writeln(`cp: ${msg}`);
				}
				exitCode = 1;
			}
		}

		return exitCode;
	})
	.toHandler();
