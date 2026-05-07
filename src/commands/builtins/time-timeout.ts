import type { CommandHandler } from "../types.js";
import { parseDurationSeconds } from "./sleep.js";

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

const formatShellDuration = (ms: number): string => {
	const minutes = Math.floor(ms / 60_000);
	const seconds = ((ms - minutes * 60_000) / 1000).toFixed(3);
	return `${minutes}m${seconds}s`;
};

const formatPosixDuration = (ms: number): string => (ms / 1000).toFixed(2);

export const timeCmd: CommandHandler = {
	name: "time",
	async execute(ctx) {
		if (ctx.args[0] === "--help" || ctx.args[0] === "-h") {
			ctx.stdout.write("Usage: time [-p] command [args...]\n");
			return 0;
		}

		const posix = ctx.args[0] === "-p";
		const commandArgs = posix ? ctx.args.slice(1) : ctx.args;

		if (commandArgs.length === 0) {
			ctx.stderr.writeln("time: missing command");
			return 1;
		}

		const startedAt = performance.now();
		const result = await ctx.subExec(commandArgs.map(shellQuote).join(" "));
		const elapsedMs = performance.now() - startedAt;

		ctx.stdout.write(result.stdout);
		ctx.stderr.write(result.stderr);

		if (posix) {
			ctx.stderr.write(`real ${formatPosixDuration(elapsedMs)}\n`);
			ctx.stderr.write("user 0.00\n");
			ctx.stderr.write("sys 0.00\n");
		} else {
			ctx.stderr.write(`real ${formatShellDuration(elapsedMs)}\n`);
			ctx.stderr.write("user 0m0.000s\n");
			ctx.stderr.write("sys 0m0.000s\n");
		}

		return result.exitCode;
	},
};

export const timeout: CommandHandler = {
	name: "timeout",
	async execute(ctx) {
		if (ctx.args[0] === "--help" || ctx.args[0] === "-h") {
			ctx.stdout.write("Usage: timeout [-s signal] duration command [args...]\n");
			return 0;
		}

		let i = 0;
		if (ctx.args[i] === "-s" || ctx.args[i] === "--signal") {
			i += 2;
		} else if (ctx.args[i]?.startsWith("--signal=")) {
			i += 1;
		}

		const durationArg = ctx.args[i];
		if (durationArg === undefined) {
			ctx.stderr.writeln("timeout: missing duration");
			return 125;
		}

		const seconds = parseDurationSeconds(durationArg);
		if (seconds === null) {
			ctx.stderr.writeln(`timeout: invalid time interval '${durationArg}'`);
			return 125;
		}

		const commandArgs = ctx.args.slice(i + 1);
		if (commandArgs.length === 0) {
			ctx.stderr.writeln("timeout: missing command");
			return 125;
		}

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), Math.floor(seconds * 1000));
		});

		const command = ctx.subExec(commandArgs.map(shellQuote).join(" "));
		const result = await Promise.race([command, timedOut]);

		if (timer) clearTimeout(timer);

		if (result === "timeout") {
			return 124;
		}

		ctx.stdout.write(result.stdout);
		ctx.stderr.write(result.stderr);
		return result.exitCode;
	},
};
