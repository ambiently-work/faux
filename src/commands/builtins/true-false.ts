import { command } from "../builder.js";

export const trueCmd = command("true")
	.description("Return a successful exit code")
	.action(() => 0)
	.toHandler();

export const falseCmd = command("false")
	.description("Return a failure exit code")
	.action(() => 1)
	.toHandler();

export const noop = command(":")
	.description("No-op command")
	.action(() => 0)
	.toHandler();
