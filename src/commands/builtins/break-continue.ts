import { ShellBreak, ShellContinue } from "../../executor/pipeline.js";
import { command } from "../builder.js";

function parseLevels(
	name: string,
	raw: string | undefined,
	stderr: { writeln: (s: string) => void },
): number | null {
	if (raw === undefined) return 1;
	const parsed = Number.parseInt(raw, 10);
	if (Number.isNaN(parsed) || parsed < 1 || String(parsed) !== raw) {
		stderr.writeln(`${name}: ${raw}: numeric argument required`);
		return null;
	}
	return parsed;
}

export const breakCmd = command("break")
	.description("Exit from enclosing for, while, until, or select loop")
	.allowUnknownFlags()
	.argument("[n]", "Number of enclosing loops to exit")
	.action((ctx, { args }) => {
		const levels = parseLevels("break", args[0], ctx.stderr);
		if (levels === null) return 2;
		throw new ShellBreak(levels);
	})
	.toHandler();

export const continueCmd = command("continue")
	.description("Resume next iteration of enclosing for, while, until, or select loop")
	.allowUnknownFlags()
	.argument("[n]", "Number of enclosing loops to skip")
	.action((ctx, { args }) => {
		const levels = parseLevels("continue", args[0], ctx.stderr);
		if (levels === null) return 2;
		throw new ShellContinue(levels);
	})
	.toHandler();
