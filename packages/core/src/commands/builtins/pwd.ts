import { command } from "../builder.js";

export const pwd = command("pwd")
	.description("Print the current working directory")
	.action((ctx) => {
		ctx.stdout.writeln(ctx.cwd);
		return 0;
	})
	.toHandler();
