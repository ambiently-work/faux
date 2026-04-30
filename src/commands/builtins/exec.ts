import { command } from "../builder.js";

export const exec = command("exec")
	.description("Replace the shell with the given command")
	.allowUnknownFlags()
	.argument("[args...]", "Command and arguments")
	.action(async (_ctx, _opts) => {
		// exec is intercepted by the executor before reaching this builtin:
		// - exec REDIRS (no command): executor persists fd overrides, returns 0.
		// - exec CMD args: executor runs CMD then throws ShellExit.
		// This handler is only reached when exec is invoked in a context where the
		// executor cannot intercept it (e.g. via subExec string path), which should
		// not happen in normal use.
		return 0;
	})
	.toHandler();
