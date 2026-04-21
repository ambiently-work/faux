import { command } from "../builder.js";

export const sleep = command("sleep")
	.description("Delay for a specified amount of time")
	.argument("<duration...>", "Time to sleep (e.g. 1, 2s, 3m, 1h, 0.5d)")
	.action(async (ctx, { args }) => {
		if (args.length === 0) {
			ctx.stderr.writeln("sleep: missing operand");
			return 1;
		}

		let totalSeconds = 0;

		for (const arg of args) {
			let multiplier = 1;
			let numStr = arg;

			if (arg.endsWith("s")) {
				numStr = arg.slice(0, -1);
				multiplier = 1;
			} else if (arg.endsWith("m")) {
				numStr = arg.slice(0, -1);
				multiplier = 60;
			} else if (arg.endsWith("h")) {
				numStr = arg.slice(0, -1);
				multiplier = 3600;
			} else if (arg.endsWith("d")) {
				numStr = arg.slice(0, -1);
				multiplier = 86400;
			}

			const n = Number.parseFloat(numStr);
			if (Number.isNaN(n) || n < 0) {
				ctx.stderr.writeln(`sleep: invalid time interval '${arg}'`);
				return 1;
			}

			totalSeconds += n * multiplier;
		}

		const ms = Math.floor(totalSeconds * 1000);
		await new Promise<void>((resolve) => {
			setTimeout(resolve, ms);
		});

		return 0;
	})
	.toHandler();
