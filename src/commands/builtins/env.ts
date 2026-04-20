import { command } from "../builder.js";

export const env = command("env")
	.description("Run a program in a modified environment")
	.allowUnknownFlags()
	.stopAfterFirstPositional()
	.argument("[args...]", "Environment settings and command")
	.action(async (ctx, { raw }) => {
		const modifiedEnv: Array<{ key: string; value: string }> = [];
		const unsetVars = new Set<string>();
		let clearEnv = false;
		let cmdStart = -1;

		let i = 0;
		while (i < raw.length) {
			const arg = raw[i];
			if (arg === "-i" || arg === "--ignore-environment") {
				clearEnv = true;
				i++;
			} else if (arg === "-u" || arg === "--unset") {
				i++;
				if (i < raw.length) {
					unsetVars.add(raw[i]);
				}
				i++;
			} else if (arg.includes("=")) {
				const eqIdx = arg.indexOf("=");
				modifiedEnv.push({ key: arg.slice(0, eqIdx), value: arg.slice(eqIdx + 1) });
				i++;
			} else {
				cmdStart = i;
				break;
			}
		}

		if (cmdStart >= 0) {
			const childEnv = ctx.env.fork();
			if (clearEnv) {
				for (const [key] of childEnv.all()) {
					childEnv.unset(key);
				}
			}
			for (const name of unsetVars) {
				childEnv.unset(name);
			}
			for (const { key, value } of modifiedEnv) {
				childEnv.set(key, value);
				childEnv.export(key);
			}
			const cmdStr = raw.slice(cmdStart).join(" ");
			const result = await ctx.subExec(cmdStr);
			ctx.stdout.write(result.stdout);
			if (result.stderr) {
				ctx.stderr.write(result.stderr);
			}
			return result.exitCode;
		}

		// No command — print environment (excluding unset vars)
		for (const [key, value] of ctx.env.all()) {
			if (ctx.env.isExported(key) && !unsetVars.has(key)) {
				ctx.stdout.writeln(`${key}=${value}`);
			}
		}
		return 0;
	})
	.toHandler();

export const printenv = command("printenv")
	.description("Print environment variables")
	.flag("-0, --null", "End each line with NUL instead of newline")
	.argument("[name...]", "Variable names to print")
	.action((ctx, { args: names, flags }) => {
		const nullTerminate = flags.null as boolean;

		if (names.length === 0) {
			for (const [key, value] of ctx.env.all()) {
				if (ctx.env.isExported(key)) {
					ctx.stdout.write(`${key}=${value}${nullTerminate ? "\0" : "\n"}`);
				}
			}
			return 0;
		}

		let exitCode = 0;
		for (const name of names) {
			const value = ctx.env.get(name);
			if (value !== undefined && ctx.env.isExported(name)) {
				ctx.stdout.write(`${value}${nullTerminate ? "\0" : "\n"}`);
			} else {
				exitCode = 1;
			}
		}
		return exitCode;
	})
	.toHandler();
