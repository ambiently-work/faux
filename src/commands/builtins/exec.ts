import { command } from "../builder.js";

export const exec = command("exec")
	.description("Replace the shell with the given command")
	.allowUnknownFlags()
	.argument("[args...]", "Command and arguments")
	.action(async (ctx, { raw }) => {
		if (raw.length === 0) {
			return 0;
		}

		// Check for redirections (exec > file, exec >> file, etc.)
		const args = [...raw];
		let i = 0;
		while (i < args.length) {
			const arg = args[i];

			if (arg === ">" && i + 1 < args.length) {
				const file = ctx.resolve(args[i + 1]);
				ctx.fs.writeFile(file, "");
				args.splice(i, 2);
				continue;
			}

			if (arg === ">>" && i + 1 < args.length) {
				const file = ctx.resolve(args[i + 1]);
				if (!ctx.fs.exists(file)) {
					ctx.fs.writeFile(file, "");
				}
				args.splice(i, 2);
				continue;
			}

			if (arg === "<" && i + 1 < args.length) {
				args.splice(i, 2);
				continue;
			}

			if (arg.startsWith(">>") && arg.length > 2) {
				const file = ctx.resolve(arg.slice(2));
				if (!ctx.fs.exists(file)) {
					ctx.fs.writeFile(file, "");
				}
				args.splice(i, 1);
				continue;
			}

			if (arg.startsWith(">") && arg.length > 1) {
				const file = ctx.resolve(arg.slice(1));
				ctx.fs.writeFile(file, "");
				args.splice(i, 1);
				continue;
			}

			i++;
		}

		if (args.length === 0) {
			return 0;
		}

		// In our virtual shell, exec just runs the command and returns its exit code
		// A real shell would replace the process
		const cmd = args.join(" ");
		const result = await ctx.subExec(cmd);
		ctx.stdout.write(result.stdout);
		if (result.stderr) {
			ctx.stderr.write(result.stderr);
		}
		return result.exitCode;
	})
	.toHandler();
