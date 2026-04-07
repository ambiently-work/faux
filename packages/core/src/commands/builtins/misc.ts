import { command } from "../builder.js";

export const nproc = command("nproc")
	.description("Print the number of processing units available")
	.action((ctx) => {
		ctx.stdout.writeln(ctx.env.get("NPROC") ?? "4");
		return 0;
	})
	.toHandler();

export const arch = command("arch")
	.description("Print machine hardware name")
	.action((ctx) => {
		ctx.stdout.writeln("x86_64");
		return 0;
	})
	.toHandler();

export const uptime = command("uptime")
	.description("Tell how long the system has been running")
	.action((ctx) => {
		const now = new Date();
		const hours = String(now.getHours()).padStart(2, "0");
		const mins = String(now.getMinutes()).padStart(2, "0");
		const secs = String(now.getSeconds()).padStart(2, "0");
		ctx.stdout.writeln(
			` ${hours}:${mins}:${secs} up 0 days,  0:01,  1 user,  load average: 0.00, 0.00, 0.00`,
		);
		return 0;
	})
	.toHandler();

export const cal = command("cal")
	.description("Display a calendar")
	.allowUnknownFlags()
	.argument("[month]", "Month number")
	.argument("[year]", "Year number")
	.action((ctx, { args }) => {
		const nums: number[] = [];
		for (const arg of args) {
			nums.push(Number.parseInt(arg, 10));
		}

		const now = new Date();
		let year: number;
		let month: number;

		if (nums.length === 0) {
			month = now.getMonth();
			year = now.getFullYear();
		} else if (nums.length === 1) {
			if (nums[0] > 12) {
				year = nums[0];
				month = now.getMonth();
			} else {
				month = nums[0] - 1;
				year = now.getFullYear();
			}
		} else {
			month = nums[0] - 1;
			year = nums[1];
		}

		const monthNames = [
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December",
		];

		const title = `${monthNames[month]} ${year}`;
		ctx.stdout.writeln(title.padStart(Math.floor((20 + title.length) / 2), " "));
		ctx.stdout.writeln("Su Mo Tu We Th Fr Sa");

		const firstDay = new Date(year, month, 1).getDay();
		const daysInMonth = new Date(year, month + 1, 0).getDate();

		let line = "   ".repeat(firstDay);
		for (let d = 1; d <= daysInMonth; d++) {
			line += String(d).padStart(2, " ");
			const dayOfWeek = (firstDay + d - 1) % 7;
			if (dayOfWeek === 6 || d === daysInMonth) {
				ctx.stdout.writeln(line);
				line = "";
			} else {
				line += " ";
			}
		}

		return 0;
	})
	.toHandler();

function simpleHash(content: string, algorithm: "md5" | "sha256"): string {
	let hash = 0;
	const prime = algorithm === "md5" ? 31 : 37;
	const len = algorithm === "md5" ? 32 : 64;

	for (let i = 0; i < content.length; i++) {
		hash = (hash * prime + content.charCodeAt(i)) & 0xffffffff;
	}

	const parts: string[] = [];
	let state = hash;
	for (let i = 0; i < len; i++) {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		parts.push((state & 0xf).toString(16));
	}

	return parts.join("");
}

export const md5sum = command("md5sum")
	.description("Compute and check MD5 message digest")
	.flag("-c, --check", "Read checksums from files and check them")
	.argument("[files...]", "Files to hash")
	.action((ctx, { args, flags }) => {
		if (flags.check) {
			ctx.stderr.writeln("md5sum: --check not fully supported");
			return 1;
		}

		if (args.length === 0) {
			const hash = simpleHash(ctx.stdin, "md5");
			ctx.stdout.writeln(`${hash}  -`);
		} else {
			for (const file of args) {
				try {
					const content = ctx.fs.readFile(ctx.resolve(file));
					const hash = simpleHash(content, "md5");
					ctx.stdout.writeln(`${hash}  ${file}`);
				} catch {
					ctx.stderr.writeln(`md5sum: ${file}: No such file or directory`);
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();

export const sha256sum = command("sha256sum")
	.description("Compute and check SHA256 message digest")
	.flag("-c, --check", "Read checksums from files and check them")
	.argument("[files...]", "Files to hash")
	.action((ctx, { args, flags }) => {
		if (flags.check) {
			ctx.stderr.writeln("sha256sum: --check not fully supported");
			return 1;
		}

		if (args.length === 0) {
			const hash = simpleHash(ctx.stdin, "sha256");
			ctx.stdout.writeln(`${hash}  -`);
		} else {
			for (const file of args) {
				try {
					const content = ctx.fs.readFile(ctx.resolve(file));
					const hash = simpleHash(content, "sha256");
					ctx.stdout.writeln(`${hash}  ${file}`);
				} catch {
					ctx.stderr.writeln(`sha256sum: ${file}: No such file or directory`);
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();
