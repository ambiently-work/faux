import { command } from "../builder.js";

export const source = command("source")
	.description("Execute commands from a file in the current shell")
	.allowUnknownFlags()
	.argument("[args...]", "Filename and optional arguments")
	.action(async (ctx, { raw }) => {
		if (raw.length === 0) {
			ctx.stderr.writeln("source: filename argument required");
			return 2;
		}

		const filename = raw[0];
		let resolved: string;

		if (filename.includes("/")) {
			resolved = ctx.resolve(filename);
		} else {
			// Search in PATH-like locations
			resolved = ctx.resolve(filename);
			if (!ctx.fs.exists(resolved)) {
				const pathStr = ctx.env.get("PATH") ?? "";
				const dirs = pathStr.split(":");
				let found = false;
				for (const dir of dirs) {
					if (!dir) continue;
					const candidate = dir.endsWith("/") ? `${dir}${filename}` : `${dir}/${filename}`;
					if (ctx.fs.exists(candidate)) {
						resolved = candidate;
						found = true;
						break;
					}
				}
				if (!found) {
					resolved = ctx.resolve(filename);
				}
			}
		}

		let content: string;
		try {
			content = ctx.fs.readFile(resolved);
		} catch {
			ctx.stderr.writeln(`source: ${filename}: No such file or directory`);
			return 1;
		}

		// Set positional args if extra arguments were passed
		const oldArgs = ctx.env.positionalArgs;
		if (raw.length > 1) {
			ctx.env.positionalArgs = raw.slice(1);
		}

		const result = await ctx.subExec(content);
		ctx.stdout.write(result.stdout);
		if (result.stderr) {
			ctx.stderr.write(result.stderr);
		}

		// Restore positional args
		ctx.env.positionalArgs = oldArgs;

		return result.exitCode;
	})
	.toHandler();

export const dot = command(".")
	.description("Execute commands from a file in the current shell")
	.allowUnknownFlags()
	.argument("[args...]", "Filename and optional arguments")
	.action(async (ctx) => {
		return source.execute(ctx);
	})
	.toHandler();
