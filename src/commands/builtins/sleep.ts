import { command } from "../builder.js";

export function parseDurationSeconds(raw: string): number | null {
	const match = /^([0-9]+(?:\.[0-9]*)?|\.[0-9]+)([smhd]?)$/.exec(raw);
	if (!match) return null;

	const value = Number.parseFloat(match[1]);
	if (Number.isNaN(value) || value < 0) return null;

	const suffix = match[2];
	const multiplier = suffix === "m" ? 60 : suffix === "h" ? 3600 : suffix === "d" ? 86400 : 1;

	return value * multiplier;
}

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
			const seconds = parseDurationSeconds(arg);
			if (seconds === null) {
				ctx.stderr.writeln(`sleep: invalid time interval '${arg}'`);
				return 1;
			}

			totalSeconds += seconds;
		}

		const ms = Math.floor(totalSeconds * 1000);
		await new Promise<void>((resolve) => {
			setTimeout(resolve, ms);
		});

		return 0;
	})
	.toHandler();
