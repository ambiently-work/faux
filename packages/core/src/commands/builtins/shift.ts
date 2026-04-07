import { command } from "../builder.js";

export const shift = command("shift")
	.description("Shift positional parameters")
	.argument("[n]", "Number of positions to shift")
	.action((ctx, { args }) => {
		const n = args.length > 0 ? Number.parseInt(args[0], 10) : 1;

		if (Number.isNaN(n) || n < 0) {
			ctx.stderr.writeln(`shift: ${args[0]}: numeric argument required`);
			return 1;
		}

		const current = ctx.env.positionalArgs;
		if (n > current.length) {
			ctx.stderr.writeln(`shift: shift count out of range`);
			return 1;
		}

		ctx.env.positionalArgs = current.slice(n);
		return 0;
	})
	.toHandler();
