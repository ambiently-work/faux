import { command } from "../builder.js";

export const cd = command("cd")
	.description("Change the current working directory")
	.allowUnknownFlags()
	.action((ctx, { args }) => {
		let target: string;

		if (args.length === 0 || args[0] === "~") {
			target = ctx.env.get("HOME") ?? "/";
		} else if (args[0] === "-") {
			const oldpwd = ctx.env.get("OLDPWD");
			if (!oldpwd) {
				ctx.stderr.writeln("cd: OLDPWD not set");
				return 1;
			}
			target = oldpwd;
			ctx.stdout.writeln(target);
		} else {
			target = args[0];
			if (target.startsWith("~")) {
				const home = ctx.env.get("HOME") ?? "/";
				target = home + target.slice(1);
			}
		}

		const resolved = ctx.resolve(target);

		if (!ctx.fs.exists(resolved)) {
			ctx.stderr.writeln(`cd: ${target}: No such file or directory`);
			return 1;
		}

		try {
			const stat = ctx.fs.stat(resolved);
			if (!stat.isDirectory()) {
				ctx.stderr.writeln(`cd: ${target}: Not a directory`);
				return 1;
			}
		} catch {
			ctx.stderr.writeln(`cd: ${target}: No such file or directory`);
			return 1;
		}

		const oldpwd = ctx.env.cwd;
		ctx.env.set("OLDPWD", oldpwd);
		ctx.env.cwd = resolved;
		ctx.env.set("PWD", resolved);

		return 0;
	})
	.toHandler();
