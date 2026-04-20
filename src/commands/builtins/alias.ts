import { command } from "../builder.js";

export const alias = command("alias")
	.description("Define or display aliases")
	.flag("-p, --print", "Print all aliases")
	.allowUnknownFlags()
	.argument("[names...]", "Alias definitions (name=value) or names to display")
	.action((ctx, { args, flags }) => {
		if (args.length === 0 || flags.print) {
			const aliases = ctx.env.aliases();
			for (const [name, value] of aliases) {
				ctx.stdout.writeln(`alias ${name}='${value.replace(/'/g, "'\\''")}'`);
			}
			return 0;
		}

		let exitCode = 0;

		for (const arg of args) {
			const eqIdx = arg.indexOf("=");
			if (eqIdx >= 0) {
				const name = arg.slice(0, eqIdx);
				const value = arg.slice(eqIdx + 1);
				ctx.env.setAlias(name, value);
			} else {
				const value = ctx.env.getAlias(arg);
				if (value !== undefined) {
					ctx.stdout.writeln(`alias ${arg}='${value.replace(/'/g, "'\\''")}'`);
				} else {
					ctx.stderr.writeln(`alias: ${arg}: not found`);
					exitCode = 1;
				}
			}
		}

		return exitCode;
	})
	.toHandler();

export const unalias = command("unalias")
	.description("Remove alias definitions")
	.flag("-a, --all", "Remove all aliases")
	.argument("[names...]", "Alias names to remove")
	.action((ctx, { args, flags }) => {
		if (args.length === 0 && !flags.all) {
			ctx.stderr.writeln("unalias: usage: unalias [-a] name [name ...]");
			return 1;
		}

		if (flags.all) {
			const aliases = ctx.env.aliases();
			for (const [name] of aliases) {
				ctx.env.removeAlias(name);
			}
			return 0;
		}

		let exitCode = 0;
		for (const arg of args) {
			const existing = ctx.env.getAlias(arg);
			if (existing === undefined) {
				ctx.stderr.writeln(`unalias: ${arg}: not found`);
				exitCode = 1;
			} else {
				ctx.env.removeAlias(arg);
			}
		}

		return exitCode;
	})
	.toHandler();
