import { command } from "../builder.js";

function parseSymbolicMode(spec: string, currentMode: number, isDirectory = false): number {
	let mode = currentMode;
	// Split on comma for multiple specs: u+r,g+w
	const parts = spec.split(",");

	for (const part of parts) {
		const match = part.match(/^([ugoa]*)([+\-=])([rwxXst]*)$/);
		if (!match) return -1;

		const who = match[1] || "a";
		const op = match[2];
		const perms = match[3];

		let bits = 0;
		for (const p of perms) {
			switch (p) {
				case "r":
					bits |= 4;
					break;
				case "w":
					bits |= 2;
					break;
				case "x":
					bits |= 1;
					break;
				case "X":
					// Execute only if directory or already has execute
					if (isDirectory || currentMode & 0o111) bits |= 1;
					break;
				case "s":
					break; // setuid/setgid - simplified
				case "t":
					break; // sticky - simplified
			}
		}

		const shifts: number[] = [];
		for (const w of who) {
			switch (w) {
				case "u":
					shifts.push(6);
					break;
				case "g":
					shifts.push(3);
					break;
				case "o":
					shifts.push(0);
					break;
				case "a":
					shifts.push(6, 3, 0);
					break;
			}
		}

		for (const shift of shifts) {
			const shifted = bits << shift;
			switch (op) {
				case "+":
					mode |= shifted;
					break;
				case "-":
					mode &= ~shifted;
					break;
				case "=":
					mode &= ~(7 << shift);
					mode |= shifted;
					break;
			}
		}
	}

	return mode;
}

export const chmod = command("chmod")
	.description("Change file mode bits")
	.flag("-R, --recursive", "Change files and directories recursively")
	.argument("<mode>", "File mode to set")
	.argument("<files...>", "Files to change")
	.stopAfterFirstPositional()
	.action((ctx, { args: operands, flags }) => {
		const recursive = !!flags.recursive;

		if (operands.length < 2) {
			ctx.stderr.writeln("chmod: missing operand");
			return 1;
		}

		const modeSpec = operands[0];
		const files = operands.slice(1);

		let exitCode = 0;

		const applyChmod = (path: string, display: string): boolean => {
			try {
				const st = ctx.fs.stat(path);
				let newMode: number;

				if (/^[0-7]+$/.test(modeSpec)) {
					newMode = Number.parseInt(modeSpec, 8);
				} else {
					newMode = parseSymbolicMode(modeSpec, st.mode, st.isDirectory());
					if (newMode === -1) {
						ctx.stderr.writeln(`chmod: invalid mode: '${modeSpec}'`);
						return false;
					}
				}

				ctx.fs.chmod(path, newMode);

				if (recursive && st.isDirectory()) {
					const children = ctx.fs.readDir(path);
					for (const child of children) {
						const childPath = path === "/" ? `/${child}` : `${path}/${child}`;
						if (!applyChmod(childPath, `${display}/${child}`)) {
							return false;
						}
					}
				}

				return true;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("ENOENT")) {
					ctx.stderr.writeln(`chmod: cannot access '${display}': No such file or directory`);
				} else {
					ctx.stderr.writeln(`chmod: '${display}': ${msg}`);
				}
				return false;
			}
		};

		for (const file of files) {
			const resolved = ctx.resolve(file);
			if (!applyChmod(resolved, file)) {
				exitCode = 1;
			}
		}

		return exitCode;
	})
	.toHandler();
