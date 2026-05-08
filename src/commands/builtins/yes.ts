import { command } from "../builder.js";

export const yes = command("yes")
	.description("Repeatedly output a line with all specified strings, or 'y'")
	.allowUnknownFlags()
	.action((ctx, { args }) => {
		const text = args.length > 0 ? args.join(" ") : "y";
		const maxLines = 1000;
		const signal = ctx.signal;
		for (let i = 0; i < maxLines; i++) {
			if (signal?.aborted) return 130;
			ctx.stdout.writeln(text);
		}
		return 0;
	})
	.toHandler();
