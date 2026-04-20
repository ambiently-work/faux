import { command } from "../builder.js";

export const mv = command("mv")
	.description("Move or rename files")
	.flag("-f", "Force move without prompting")
	.flag("-n", "Do not overwrite existing file")
	.flag("-v, --verbose", "Explain what is being done")
	.argument("<operands...>", "Source(s) and destination")
	.action((ctx, { args: operands }) => {
		if (operands.length < 2) {
			ctx.stderr.writeln("mv: missing operand");
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
			ctx.stderr.writeln(`mv: target '${operands[operands.length - 1]}' is not a directory`);
			return 1;
		}

		let exitCode = 0;

		for (const src of sources) {
			const resolvedSrc = ctx.resolve(src);
			try {
				const basename = resolvedSrc.split("/").pop() ?? "";
				const finalDest = destIsDir ? `${dest}/${basename}` : dest;
				ctx.fs.mv(resolvedSrc, finalDest);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("ENOENT")) {
					ctx.stderr.writeln(`mv: cannot stat '${src}': No such file or directory`);
				} else {
					ctx.stderr.writeln(`mv: ${msg}`);
				}
				exitCode = 1;
			}
		}

		return exitCode;
	})
	.toHandler();
