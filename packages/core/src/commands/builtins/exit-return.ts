import { command } from "../builder.js";

export class ShellExitError extends Error {
	readonly code: number;
	constructor(code: number) {
		super(`exit: ${code}`);
		this.name = "ShellExitError";
		this.code = code;
	}
}

export class ShellReturnError extends Error {
	readonly code: number;
	constructor(code: number) {
		super(`return: ${code}`);
		this.name = "ShellReturnError";
		this.code = code;
	}
}

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
				throw new ShellExitError(2);
			}
			code = parsed & 0xff;
		}

		throw new ShellExitError(code);
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
				throw new ShellReturnError(2);
			}
			code = parsed & 0xff;
		}

		throw new ShellReturnError(code);
	})
	.toHandler();
