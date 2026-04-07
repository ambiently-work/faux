import { command } from "../builder.js";

export const evalCmd = command("eval")
	.description("Evaluate arguments as a shell command")
	.allowUnknownFlags()
	.argument("[args...]", "Command string to evaluate")
	.action(async (ctx, { raw }) => {
		if (raw.length === 0) {
			return 0;
		}

		const cmd = raw.join(" ");
		const result = await ctx.subExec(cmd);
		ctx.stdout.write(result.stdout);
		if (result.stderr) {
			ctx.stderr.write(result.stderr);
		}
		return result.exitCode;
	})
	.toHandler();
