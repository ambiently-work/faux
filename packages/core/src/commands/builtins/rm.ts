import { command } from "../builder.js";

export const rm = command("rm")
	.description("Remove files or directories")
	.flag("-r, --recursive", "Remove directories and their contents recursively")
	.flag("-R", "Remove directories and their contents recursively")
	.flag("-f, --force", "Ignore nonexistent files, never prompt")
	.argument("[targets...]", "Files or directories to remove")
	.action((ctx, { args: targets, flags }) => {
		const recursive = !!flags.recursive || !!flags.R;
		const force = !!flags.force;

		if (targets.length === 0) {
			if (force) return 0;
			ctx.stderr.writeln("rm: missing operand");
			return 1;
		}

		let exitCode = 0;

		for (const target of targets) {
			const resolved = ctx.resolve(target);
			try {
				ctx.fs.rm(resolved, { recursive, force });
			} catch (err) {
				if (force) continue;
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("ENOENT")) {
					ctx.stderr.writeln(`rm: cannot remove '${target}': No such file or directory`);
				} else if (msg.includes("EISDIR")) {
					ctx.stderr.writeln(`rm: cannot remove '${target}': Is a directory`);
				} else {
					ctx.stderr.writeln(`rm: cannot remove '${target}': ${msg}`);
				}
				exitCode = 1;
			}
		}

		return exitCode;
	})
	.toHandler();
