import { command } from "../builder.js";

const LIMITS: Record<string, { name: string; value: string }> = {
	"-c": { name: "core file size", value: "0" },
	"-d": { name: "data seg size", value: "unlimited" },
	"-e": { name: "scheduling priority", value: "0" },
	"-f": { name: "file size", value: "unlimited" },
	"-i": { name: "pending signals", value: "15423" },
	"-l": { name: "max locked memory", value: "65536" },
	"-m": { name: "max memory size", value: "unlimited" },
	"-n": { name: "open files", value: "1024" },
	"-p": { name: "pipe size", value: "8" },
	"-q": { name: "POSIX message queues", value: "819200" },
	"-r": { name: "real-time priority", value: "0" },
	"-s": { name: "stack size", value: "8192" },
	"-t": { name: "cpu time", value: "unlimited" },
	"-u": { name: "max user processes", value: "15423" },
	"-v": { name: "virtual memory", value: "unlimited" },
	"-x": { name: "file locks", value: "unlimited" },
};

export const ulimit = command("ulimit")
	.description("Get and set user limits")
	.allowUnknownFlags()
	.argument("[limit]", "New limit value")
	.action((ctx, { raw }) => {
		let hard = false;
		let soft = true;
		let showAll = false;
		let selectedFlag = "-f";

		const values: string[] = [];

		for (let i = 0; i < raw.length; i++) {
			const arg = raw[i];
			if (arg === "-H") {
				hard = true;
				soft = false;
			} else if (arg === "-S") {
				soft = true;
				hard = false;
			} else if (arg === "-a") {
				showAll = true;
			} else if (arg in LIMITS) {
				selectedFlag = arg;
			} else {
				values.push(arg);
			}
		}

		if (showAll) {
			for (const [flag, info] of Object.entries(LIMITS)) {
				const stored = ctx.env.get(`_ULIMIT${flag}`) ?? info.value;
				ctx.stdout.writeln(`${info.name.padEnd(30)} (${flag}) ${stored}`);
			}
			return 0;
		}

		if (values.length > 0) {
			// Set limit
			const newValue = values[0];
			if (newValue !== "unlimited" && Number.isNaN(Number.parseInt(newValue, 10))) {
				ctx.stderr.writeln(`ulimit: ${newValue}: invalid limit`);
				return 1;
			}
			ctx.env.set(`_ULIMIT${selectedFlag}`, newValue);
			return 0;
		}

		// Get limit
		const info = LIMITS[selectedFlag];
		if (!info) {
			ctx.stderr.writeln(`ulimit: invalid option: ${selectedFlag}`);
			return 1;
		}
		const stored = ctx.env.get(`_ULIMIT${selectedFlag}`) ?? info.value;
		ctx.stdout.writeln(stored);
		return 0;
	})
	.toHandler();
