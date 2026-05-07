import { command } from "../builder.js";
import type { CommandContext } from "../types.js";

const CLEAR = "\x1b[2J\x1b[H";
const RESET = "\x1bc";

export const tty = command("tty")
	.description("Print the terminal connected to standard input")
	.action((ctx) => {
		if (ctx.isatty.stdin) {
			ctx.stdout.writeln("/dev/tty");
			return 0;
		}
		ctx.stdout.writeln("not a tty");
		return 1;
	})
	.toHandler();

export const clear = command("clear")
	.description("Clear the terminal screen")
	.action((ctx) => {
		ctx.stdout.write(CLEAR);
		return 0;
	})
	.toHandler();

export const reset = command("reset")
	.description("Reset the terminal")
	.action((ctx) => {
		ctx.stdout.write(RESET);
		return 0;
	})
	.toHandler();

export const stty = command("stty")
	.description("Display or change terminal settings")
	.allowUnknownFlags()
	.argument("[args...]", "Terminal settings")
	.action((ctx, { raw }) => {
		if (raw.length === 0 || raw[0] === "-a") {
			ctx.stdout.writeln(
				`speed 38400 baud; rows ${ctx.term.rows}; columns ${ctx.term.cols}; ${ctx.term.name}`,
			);
			return 0;
		}

		if (raw[0] === "size") {
			ctx.stdout.writeln(`${ctx.term.rows} ${ctx.term.cols}`);
			return 0;
		}

		for (let i = 0; i < raw.length; i++) {
			const arg = raw[i];
			if (arg !== "cols" && arg !== "columns" && arg !== "rows") {
				ctx.stderr.writeln(`stty: unsupported setting '${arg}'`);
				return 1;
			}

			const value = Number.parseInt(raw[++i] ?? "", 10);
			if (!Number.isFinite(value) || value <= 0) {
				ctx.stderr.writeln(`stty: invalid value for ${arg}`);
				return 1;
			}

			if (arg === "rows") {
				ctx.term.rows = value;
				ctx.env.set("LINES", String(value));
			} else {
				ctx.term.cols = value;
				ctx.env.set("COLUMNS", String(value));
			}
		}

		return 0;
	})
	.toHandler();

export const tput = command("tput")
	.description("Emit common terminal capabilities")
	.allowUnknownFlags()
	.argument("[capability]", "Capability name")
	.argument("[args...]", "Capability arguments")
	.action((ctx, { raw }) => {
		const cap = raw[0];
		switch (cap) {
			case "cols":
				ctx.stdout.writeln(String(ctx.term.cols));
				return 0;
			case "lines":
				ctx.stdout.writeln(String(ctx.term.rows));
				return 0;
			case "clear":
				ctx.stdout.write(CLEAR);
				return 0;
			case "cup": {
				const row = Number.parseInt(raw[1] ?? "", 10);
				const col = Number.parseInt(raw[2] ?? "", 10);
				if (!Number.isFinite(row) || !Number.isFinite(col) || row < 0 || col < 0) {
					ctx.stderr.writeln("tput: cup requires row and column");
					return 1;
				}
				ctx.stdout.write(`\x1b[${row + 1};${col + 1}H`);
				return 0;
			}
			case "bold":
				ctx.stdout.write("\x1b[1m");
				return 0;
			case "sgr0":
				ctx.stdout.write("\x1b[0m");
				return 0;
			case "setaf":
				return writeAnsiColor(ctx, raw[1], 30);
			case "setab":
				return writeAnsiColor(ctx, raw[1], 40);
			case "smcup":
				ctx.stdout.write("\x1b[?1049h");
				return 0;
			case "rmcup":
				ctx.stdout.write("\x1b[?1049l");
				return 0;
			default:
				ctx.stderr.writeln(cap ? `tput: unknown capability '${cap}'` : "tput: missing operand");
				return 1;
		}
	})
	.toHandler();

function writeAnsiColor(ctx: CommandContext, value: string | undefined, base: number): number {
	const color = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(color) || color < 0) {
		ctx.stderr.writeln("tput: color capability requires a non-negative number");
		return 1;
	}
	ctx.stdout.write(`\x1b[${base + (color % 8)}m`);
	return 0;
}
