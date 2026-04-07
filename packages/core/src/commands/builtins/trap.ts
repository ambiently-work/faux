import { command } from "../builder.js";

const SIGNAL_LIST = [
	"EXIT",
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
	"STKFLT",
	"CHLD",
	"CONT",
	"STOP",
	"TSTP",
	"TTIN",
	"TTOU",
	"URG",
	"XCPU",
	"XFSZ",
	"VTALRM",
	"PROF",
	"WINCH",
	"IO",
	"PWR",
	"SYS",
	"ERR",
	"DEBUG",
	"RETURN",
];

const SIGNAL_MAP: Record<string, number> = {};
for (let i = 0; i < SIGNAL_LIST.length; i++) {
	SIGNAL_MAP[SIGNAL_LIST[i]] = i;
	SIGNAL_MAP[`SIG${SIGNAL_LIST[i]}`] = i;
	SIGNAL_MAP[String(i)] = i;
}

export const trap = command("trap")
	.description("Trap signals and other events")
	.allowUnknownFlags()
	.argument("[args...]", "Handler and signal specifications")
	.action((ctx, { raw }) => {
		if (raw.length === 0) {
			// Print all traps
			const trapsStr = ctx.env.get("_TRAPS") ?? "";
			if (trapsStr) {
				const traps = parseTrapStore(trapsStr);
				for (const [signal, command] of Object.entries(traps)) {
					ctx.stdout.writeln(`trap -- '${command.replace(/'/g, "'\\''")}' ${signal}`);
				}
			}
			return 0;
		}

		let i = 0;
		while (i < raw.length) {
			const arg = raw[i];

			if (arg === "-l") {
				let line = "";
				for (let j = 0; j < SIGNAL_LIST.length; j++) {
					const entry = `${j + 1}) SIG${SIGNAL_LIST[j]}`;
					if (line.length > 0) {
						line += "\t";
					}
					line += entry;
					if ((j + 1) % 5 === 0) {
						ctx.stdout.writeln(line);
						line = "";
					}
				}
				if (line) {
					ctx.stdout.writeln(line);
				}
				return 0;
			}

			if (arg === "-p") {
				i++;
				const trapsStr = ctx.env.get("_TRAPS") ?? "";
				const traps = parseTrapStore(trapsStr);
				if (i >= raw.length) {
					for (const [signal, command] of Object.entries(traps)) {
						ctx.stdout.writeln(`trap -- '${command.replace(/'/g, "'\\''")}' ${signal}`);
					}
				} else {
					while (i < raw.length) {
						const sig = normalizeSignal(raw[i]);
						if (sig && traps[sig]) {
							ctx.stdout.writeln(`trap -- '${traps[sig].replace(/'/g, "'\\''")}' ${sig}`);
						}
						i++;
					}
				}
				return 0;
			}

			break;
		}

		if (raw.length - i < 1) {
			ctx.stderr.writeln("trap: usage: trap [-lp] [[arg] signal_spec ...]");
			return 1;
		}

		const trapsStr = ctx.env.get("_TRAPS") ?? "";
		const traps = parseTrapStore(trapsStr);

		const cmd = raw[i];
		i++;

		if (i >= raw.length) {
			// Single argument: treat as signal, reset to default
			const sig = normalizeSignal(cmd);
			if (!sig) {
				ctx.stderr.writeln(`trap: ${cmd}: invalid signal specification`);
				return 1;
			}
			delete traps[sig];
			ctx.env.set("_TRAPS", serializeTrapStore(traps));
			return 0;
		}

		while (i < raw.length) {
			const sig = normalizeSignal(raw[i]);
			if (!sig) {
				ctx.stderr.writeln(`trap: ${raw[i]}: invalid signal specification`);
				return 1;
			}

			if (cmd === "" || cmd === "-") {
				delete traps[sig];
			} else {
				traps[sig] = cmd;
			}
			i++;
		}

		ctx.env.set("_TRAPS", serializeTrapStore(traps));
		return 0;
	})
	.toHandler();

function normalizeSignal(spec: string): string | null {
	const upper = spec.toUpperCase();
	if (upper in SIGNAL_MAP) {
		const idx = SIGNAL_MAP[upper];
		return SIGNAL_LIST[idx];
	}
	const withSig = upper.startsWith("SIG") ? upper : `SIG${upper}`;
	if (withSig in SIGNAL_MAP) {
		const idx = SIGNAL_MAP[withSig];
		return SIGNAL_LIST[idx];
	}
	return null;
}

function parseTrapStore(s: string): Record<string, string> {
	if (!s) return {};
	try {
		return JSON.parse(s) as Record<string, string>;
	} catch {
		return {};
	}
}

function serializeTrapStore(traps: Record<string, string>): string {
	return JSON.stringify(traps);
}
