import { ShellExit, ShellReturn } from "../../executor/pipeline.js";
import { command } from "../builder.js";

export const exit = command("exit")
	.description("Exit the shell")
	.allowUnknownFlags()
	.argument("[code]", "Exit status code")
	.action((ctx, { args }) => {
		let code = ctx.env.lastExitCode;

		if (args.length > 0) {
			const parsed = Number.parseInt(args[0], 10);
			if (Number.isNaN(parsed)) {
				ctx.stderr.writeln(`exit: ${args[0]}: numeric argument required`);
				throw new ShellExit(2);
			}
			code = parsed & 0xff;
		}

		throw new ShellExit(code);
	})
	.toHandler();

export const returnCmd = command("return")
	.description("Return from a function")
	.allowUnknownFlags()
	.argument("[code]", "Return status code")
	.action((ctx, { args }) => {
		let code = ctx.env.lastExitCode;

		if (args.length > 0) {
			const parsed = Number.parseInt(args[0], 10);
			if (Number.isNaN(parsed)) {
				ctx.stderr.writeln(`return: ${args[0]}: numeric argument required`);
				throw new ShellReturn(2);
			}
			code = parsed & 0xff;
		}

		throw new ShellReturn(code);
	})
	.toHandler();
