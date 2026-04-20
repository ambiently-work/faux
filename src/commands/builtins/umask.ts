import { command } from "../builder.js";

export const umask = command("umask")
	.description("Set file mode creation mask")
	.allowUnknownFlags()
	.argument("[mode]", "New umask value")
	.action((ctx, { raw }) => {
		let symbolic = false;
		const args: string[] = [];

		for (const arg of raw) {
			if (arg === "-S") {
				symbolic = true;
			} else if (arg === "-p") {
				// Print in reusable format
			} else {
				args.push(arg);
			}
		}

		const currentStr = ctx.env.get("UMASK") ?? "0022";
		let current = Number.parseInt(currentStr, 8);
		if (Number.isNaN(current)) {
			current = 0o022;
		}

		if (args.length === 0) {
			if (symbolic) {
				const u = permToStr(~current & 0o777, 6);
				const g = permToStr(~current & 0o777, 3);
				const o = permToStr(~current & 0o777, 0);
				ctx.stdout.writeln(`u=${u},g=${g},o=${o}`);
			} else {
				ctx.stdout.writeln(current.toString(8).padStart(4, "0"));
			}
			return 0;
		}

		const newMask = args[0];
		if (/^[0-7]+$/.test(newMask)) {
			const val = Number.parseInt(newMask, 8);
			ctx.env.set("UMASK", val.toString(8).padStart(4, "0"));
			return 0;
		}

		// Symbolic mode parsing (simplified)
		const symbolicMatch = /^([ugoa]*)([+-=])([rwx]*)$/.exec(newMask);
		if (symbolicMatch) {
			const who = symbolicMatch[1] || "a";
			const op = symbolicMatch[2];
			const perms = symbolicMatch[3];

			let bits = 0;
			if (perms.includes("r")) bits |= 4;
			if (perms.includes("w")) bits |= 2;
			if (perms.includes("x")) bits |= 1;

			let mask = current;

			const applyShift = (shift: number): void => {
				const shifted = bits << shift;
				if (op === "+") {
					mask &= ~shifted;
				} else if (op === "-") {
					mask |= shifted;
				} else {
					mask = (mask & ~(7 << shift)) | ((~bits & 7) << shift);
				}
			};

			if (who.includes("u") || who.includes("a")) applyShift(6);
			if (who.includes("g") || who.includes("a")) applyShift(3);
			if (who.includes("o") || who.includes("a")) applyShift(0);

			ctx.env.set("UMASK", (mask & 0o777).toString(8).padStart(4, "0"));
			return 0;
		}

		ctx.stderr.writeln(`umask: '${newMask}': invalid symbolic mode`);
		return 1;
	})
	.toHandler();

function permToStr(mode: number, shift: number): string {
	const bits = (mode >> shift) & 7;
	let s = "";
	if (bits & 4) s += "r";
	if (bits & 2) s += "w";
	if (bits & 1) s += "x";
	return s;
}
