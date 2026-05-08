import type { CommandTracker } from "../../tracker.js";
import { command } from "../builder.js";
import type { CommandHandler } from "../types.js";

/**
 * Create the `history` builtin bound to the shell's command tracker.
 *
 * `getTracker` returns the live tracker — null when tracking has been disabled
 * since some shells run non-interactive without it. The builtin no-ops with a
 * descriptive error in that case.
 */
export function createHistoryCommand(getTracker: () => CommandTracker | null): CommandHandler {
	return command("history")
		.description("Display or manipulate the command history list")
		.allowUnknownFlags()
		.argument("[args...]", "Optional count, mode flag, and filename")
		.action(async (ctx, { raw }) => {
			const tracker = getTracker();
			if (!tracker) {
				ctx.stderr.writeln("history: history is not enabled (use an interactive shell)");
				return 1;
			}

			let mode: "list" | "clear" | "delete" | "read" | "write" | "append" = "list";
			let modeArg: string | undefined;
			const positional: string[] = [];

			for (let i = 0; i < raw.length; i++) {
				const arg = raw[i] ?? "";
				if (arg === "-c") {
					mode = "clear";
				} else if (arg === "-d") {
					mode = "delete";
					modeArg = raw[++i];
				} else if (arg === "-r") {
					mode = "read";
					modeArg = raw[++i];
				} else if (arg === "-w") {
					mode = "write";
					modeArg = raw[++i];
				} else if (arg === "-a") {
					mode = "append";
					modeArg = raw[++i];
				} else if (arg.startsWith("-")) {
					ctx.stderr.writeln(`history: ${arg}: invalid option`);
					return 2;
				} else {
					positional.push(arg);
				}
			}

			const home = ctx.env.get("HOME") ?? "/root";
			const defaultFile = `${home}/.bash_history`;
			const histfile = ctx.env.get("HISTFILE") ?? defaultFile;
			const resolvePath = (p: string): string => {
				if (p === "~") return home;
				if (p.startsWith("~/")) return `${home}${p.slice(1)}`;
				return ctx.resolve(p);
			};

			switch (mode) {
				case "list": {
					const entries = tracker.history;
					const count = positional[0] ? Number.parseInt(positional[0], 10) : entries.length;
					if (Number.isNaN(count) || count < 0) {
						ctx.stderr.writeln(`history: ${positional[0]}: numeric argument required`);
						return 1;
					}
					const start = Math.max(0, entries.length - count);
					const width = String(entries.length).length;
					for (let i = start; i < entries.length; i++) {
						const entry = entries[i];
						if (!entry) continue;
						const num = String(i + 1).padStart(width, " ");
						ctx.stdout.writeln(`${num}  ${entry.command}`);
					}
					return 0;
				}

				case "clear": {
					tracker.clear();
					return 0;
				}

				case "delete": {
					if (modeArg === undefined) {
						ctx.stderr.writeln("history: -d: option requires an argument");
						return 2;
					}
					const idx = Number.parseInt(modeArg, 10);
					if (Number.isNaN(idx) || idx < 1) {
						ctx.stderr.writeln(`history: ${modeArg}: numeric argument required`);
						return 1;
					}
					const entries = [...tracker.history];
					if (idx > entries.length) {
						ctx.stderr.writeln(`history: ${modeArg}: history position out of range`);
						return 1;
					}
					entries.splice(idx - 1, 1);
					tracker.replaceHistory(entries);
					return 0;
				}

				case "write": {
					const file = modeArg ? resolvePath(modeArg) : resolvePath(histfile);
					const content = `${tracker.history.map((e) => e.command).join("\n")}\n`;
					try {
						ensureParentDir(ctx, file);
						ctx.fs.writeFile(file, content === "\n" ? "" : content);
						return 0;
					} catch (err) {
						ctx.stderr.writeln(
							`history: ${file}: ${err instanceof Error ? err.message : String(err)}`,
						);
						return 1;
					}
				}

				case "append": {
					const file = modeArg ? resolvePath(modeArg) : resolvePath(histfile);
					const content = tracker.history.map((e) => e.command).join("\n");
					if (!content) return 0;
					try {
						ensureParentDir(ctx, file);
						const existing = ctx.fs.exists(file) ? ctx.fs.readFile(file) : "";
						const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
						ctx.fs.writeFile(file, `${existing}${sep}${content}\n`);
						return 0;
					} catch (err) {
						ctx.stderr.writeln(
							`history: ${file}: ${err instanceof Error ? err.message : String(err)}`,
						);
						return 1;
					}
				}

				case "read": {
					const file = modeArg ? resolvePath(modeArg) : resolvePath(histfile);
					if (!ctx.fs.exists(file)) {
						ctx.stderr.writeln(`history: ${file}: cannot open file`);
						return 1;
					}
					try {
						const text = ctx.fs.readFile(file);
						const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
						for (const line of lines) {
							tracker.recordCommand(line);
						}
						return 0;
					} catch (err) {
						ctx.stderr.writeln(
							`history: ${file}: ${err instanceof Error ? err.message : String(err)}`,
						);
						return 1;
					}
				}
			}

			return 0;
		})
		.toHandler();
}

function ensureParentDir(
	ctx: { fs: { exists(p: string): boolean; mkdir?(p: string, opts?: unknown): void } },
	file: string,
): void {
	const lastSlash = file.lastIndexOf("/");
	if (lastSlash <= 0) return;
	const dir = file.slice(0, lastSlash);
	if (!ctx.fs.exists(dir) && typeof ctx.fs.mkdir === "function") {
		ctx.fs.mkdir(dir, { recursive: true });
	}
}
