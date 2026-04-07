import { command } from "../builder.js";

function formatSize(bytes: number, human: boolean): string {
	if (!human) return String(Math.ceil(bytes / 1024));
	if (bytes < 1024) return bytes + "B";
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "K";
	if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + "M";
	return (bytes / (1024 * 1024 * 1024)).toFixed(1) + "G";
}

export const du = command("du")
	.description("Estimate file space usage")
	.flag("-s", "Display only a total for each argument")
	.flag("-h, --human-readable", "Print sizes in human-readable format")
	.argument("[path...]", "Paths to examine")
	.action((ctx, { args, flags }) => {
		const summaryOnly = !!flags.s;
		const humanReadable = !!flags.humanReadable;
		const paths = args.length > 0 ? args : ["."];

		const calcSize = (path: string): number => {
			const resolved = ctx.resolve(path);
			try {
				const s = ctx.fs.stat(resolved);
				if (s.isFile()) {
					return s.size;
				}
				if (s.isDirectory()) {
					let total = 4096; // directory entry itself
					const entries = ctx.fs.readDir(resolved);
					for (const entry of entries) {
						total += calcSize(path + "/" + entry);
					}
					return total;
				}
			} catch {
				// ignore
			}
			return 0;
		};

		for (const path of paths) {
			if (summaryOnly) {
				const size = calcSize(path);
				ctx.stdout.writeln(`${formatSize(size, humanReadable)}\t${path}`);
			} else {
				const walk = (p: string, display: string): number => {
					try {
						const s = ctx.fs.stat(ctx.resolve(p));
						if (s.isFile()) return s.size;
						if (s.isDirectory()) {
							let total = 4096;
							const entries = ctx.fs.readDir(ctx.resolve(p));
							for (const entry of entries) {
								total += walk(p + "/" + entry, display + "/" + entry);
							}
							ctx.stdout.writeln(`${formatSize(total, humanReadable)}\t${display}`);
							return total;
						}
					} catch {
						// ignore
					}
					return 0;
				};
				walk(path, path);
			}
		}

		return 0;
	})
	.toHandler();
