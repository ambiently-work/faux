import { command } from "../builder.js";

export const seq = command("seq")
	.description("Print a sequence of numbers")
	.option("-s <separator>", "Separator between numbers", { default: "\n" })
	.flag("-w", "Equalize width by padding with leading zeroes")
	.stopAfterFirstPositional()
	.action((ctx, { args, flags }) => {
		const separator = flags.s as string;
		const padWidth = flags.w as boolean;

		let first = 1;
		let increment = 1;
		let last: number;

		if (args.length === 1) {
			last = Number.parseFloat(args[0]);
		} else if (args.length === 2) {
			first = Number.parseFloat(args[0]);
			last = Number.parseFloat(args[1]);
		} else if (args.length >= 3) {
			first = Number.parseFloat(args[0]);
			increment = Number.parseFloat(args[1]);
			last = Number.parseFloat(args[2]);
		} else {
			ctx.stderr.writeln("seq: missing operand");
			return 1;
		}

		if (Number.isNaN(first) || Number.isNaN(increment) || Number.isNaN(last) || increment === 0) {
			ctx.stderr.writeln("seq: invalid argument");
			return 1;
		}

		// Determine width for padding
		let width = 0;
		if (padWidth) {
			const firstStr = String(first);
			const lastStr = String(last);
			width = Math.max(firstStr.length, lastStr.length);
		}

		const results: string[] = [];
		if (increment > 0) {
			for (let n = first; n <= last + 1e-10; n += increment) {
				const rounded = Math.round(n * 1e10) / 1e10;
				let s = Number.isInteger(rounded)
					? String(rounded)
					: rounded.toFixed(
							Math.max(
								(String(first).split(".")[1] ?? "").length,
								(String(increment).split(".")[1] ?? "").length,
							) || 0,
						);
				if (padWidth) {
					s = s.padStart(width, "0");
				}
				results.push(s);
			}
		} else {
			for (let n = first; n >= last - 1e-10; n += increment) {
				const rounded = Math.round(n * 1e10) / 1e10;
				let s = Number.isInteger(rounded)
					? String(rounded)
					: rounded.toFixed(
							Math.max(
								(String(first).split(".")[1] ?? "").length,
								(String(Math.abs(increment)).split(".")[1] ?? "").length,
							) || 0,
						);
				if (padWidth) {
					s = s.padStart(width, "0");
				}
				results.push(s);
			}
		}

		ctx.stdout.write(results.join(separator) + "\n");
		return 0;
	})
	.toHandler();
