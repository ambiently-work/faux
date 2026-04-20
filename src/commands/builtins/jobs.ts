import { command } from "../builder.js";

interface VirtualJob {
	id: number;
	pid: number;
	status: "Running" | "Stopped" | "Done";
	command: string;
}

const virtualJobs: VirtualJob[] = [];
const _nextJobId = 1;

export const jobs = command("jobs")
	.description("Display status of jobs")
	.flag("-l, --long", "Long format with PIDs")
	.flag("-p, --pids", "List only PIDs")
	.action((ctx, { flags }) => {
		for (const job of virtualJobs) {
			if (flags.pids) {
				ctx.stdout.writeln(String(job.pid));
			} else if (flags.long) {
				ctx.stdout.writeln(`[${job.id}]+  ${job.pid} ${job.status.padEnd(10)} ${job.command}`);
			} else {
				ctx.stdout.writeln(`[${job.id}]+  ${job.status.padEnd(10)} ${job.command}`);
			}
		}
		return 0;
	})
	.toHandler();

export const fg = command("fg")
	.description("Move job to foreground")
	.argument("[jobspec]", "Job ID (optionally prefixed with %)")
	.action((ctx, { args }) => {
		if (virtualJobs.length === 0) {
			ctx.stderr.writeln("fg: no current job");
			return 1;
		}

		let jobId: number;
		if (args.length > 0) {
			const arg = args[0].replace(/^%/, "");
			jobId = Number.parseInt(arg, 10);
		} else {
			jobId = virtualJobs[virtualJobs.length - 1].id;
		}

		const job = virtualJobs.find((j) => j.id === jobId);
		if (!job) {
			ctx.stderr.writeln(`fg: %${jobId}: no such job`);
			return 1;
		}

		job.status = "Running";
		ctx.stdout.writeln(job.command);
		// In virtual shell, mark as done immediately
		job.status = "Done";
		const idx = virtualJobs.indexOf(job);
		if (idx >= 0) {
			virtualJobs.splice(idx, 1);
		}
		return 0;
	})
	.toHandler();

export const bg = command("bg")
	.description("Move job to background")
	.argument("[jobspec]", "Job ID (optionally prefixed with %)")
	.action((ctx, { args }) => {
		if (virtualJobs.length === 0) {
			ctx.stderr.writeln("bg: no current job");
			return 1;
		}

		let jobId: number;
		if (args.length > 0) {
			const arg = args[0].replace(/^%/, "");
			jobId = Number.parseInt(arg, 10);
		} else {
			jobId = virtualJobs[virtualJobs.length - 1].id;
		}

		const job = virtualJobs.find((j) => j.id === jobId);
		if (!job) {
			ctx.stderr.writeln(`bg: %${jobId}: no such job`);
			return 1;
		}

		job.status = "Running";
		ctx.stdout.writeln(`[${job.id}]+ ${job.command} &`);
		return 0;
	})
	.toHandler();

export const kill = command("kill")
	.description("Send signal to a job or process")
	.flag("-l, --list", "List signal names")
	.option("-s, --signal <sigspec>", "Specify signal to send")
	.option("-n, --signum <signum>", "Specify signal number")
	.allowUnknownFlags()
	.argument("[targets...]", "PIDs or job specs to signal")
	.action((ctx, { args, flags }) => {
		if (flags.list) {
			const signals = [
				"HUP",
				"INT",
				"QUIT",
				"ILL",
				"TRAP",
				"ABRT",
				"BUS",
				"FPE",
				"KILL",
				"USR1",
				"SEGV",
				"USR2",
				"PIPE",
				"ALRM",
				"TERM",
			];
			for (let j = 0; j < signals.length; j++) {
				ctx.stdout.write(`${j + 1}) SIG${signals[j]}\t`);
				if ((j + 1) % 5 === 0) {
					ctx.stdout.write("\n");
				}
			}
			ctx.stdout.write("\n");
			return 0;
		}

		if (args.length === 0) {
			ctx.stderr.writeln("kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ...");
			return 1;
		}

		for (const target of args) {
			if (target.startsWith("%")) {
				const jobId = Number.parseInt(target.slice(1), 10);
				const job = virtualJobs.find((j) => j.id === jobId);
				if (!job) {
					ctx.stderr.writeln(`kill: %${jobId}: no such job`);
					return 1;
				}
				job.status = "Done";
				const idx = virtualJobs.indexOf(job);
				if (idx >= 0) {
					virtualJobs.splice(idx, 1);
				}
			}
			// For PIDs, we just acknowledge the kill in our virtual shell
		}

		return 0;
	})
	.toHandler();

export const wait = command("wait")
	.description("Wait for job completion")
	.argument("[ids...]", "Job IDs or PIDs to wait for")
	.action((_ctx) => {
		// In virtual shell, all jobs complete immediately
		// Clean up done jobs
		for (let i = virtualJobs.length - 1; i >= 0; i--) {
			if (virtualJobs[i].status === "Done") {
				virtualJobs.splice(i, 1);
			}
		}
		return 0;
	})
	.toHandler();

export const suspend = command("suspend")
	.description("Suspend shell execution")
	.action((ctx) => {
		ctx.stderr.writeln("suspend: cannot suspend a login shell");
		return 1;
	})
	.toHandler();

export const times = command("times")
	.description("Display process times")
	.action((ctx) => {
		ctx.stdout.writeln("0m0.000s 0m0.000s");
		ctx.stdout.writeln("0m0.000s 0m0.000s");
		return 0;
	})
	.toHandler();
