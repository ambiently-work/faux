import { command } from "../builder.js";

export const tree = command("tree")
	.description("List contents of directories in a tree-like format")
	.number("-L <n>", "Descend only n levels deep")
	.flag("-d", "List directories only")
	.argument("[path...]", "Directories to list")
	.action((ctx, { args, flags }) => {
		const maxDepth = flags.L !== undefined ? (flags.L as number) : -1;
		const dirsOnly = !!flags.d;
		const paths = args.length > 0 ? args : ["."];

		let dirCount = 0;
		let fileCount = 0;

		const walk = (dir: string, prefix: string, depth: number): void => {
			const resolved = ctx.resolve(dir);
			let entries: string[];
			try {
				entries = ctx.fs.readDir(resolved);
			} catch {
				return;
			}
			entries.sort();

			// Filter to dirs only if requested
			if (dirsOnly) {
				entries = entries.filter((e) => {
					try {
						return ctx.fs.stat(resolved + "/" + e).isDirectory();
					} catch {
						return false;
					}
				});
			}

			for (let j = 0; j < entries.length; j++) {
				const isLast = j === entries.length - 1;
				const connector = isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ";
				const entry = entries[j];
				const entryPath = resolved + "/" + entry;

				let isDir = false;
				try {
					isDir = ctx.fs.stat(entryPath).isDirectory();
				} catch {
					// treat as file
				}

				ctx.stdout.writeln(prefix + connector + entry);

				if (isDir) {
					dirCount++;
					if (maxDepth < 0 || depth + 1 < maxDepth) {
						const childPrefix = prefix + (isLast ? "    " : "\u2502   ");
						walk(dir + "/" + entry, childPrefix, depth + 1);
					}
				} else {
					fileCount++;
				}
			}
		};

		for (const path of paths) {
			ctx.stdout.writeln(path);
			walk(path, "", 0);
		}

		if (dirsOnly) {
			ctx.stdout.writeln(`\n${dirCount} director${dirCount === 1 ? "y" : "ies"}`);
		} else {
			ctx.stdout.writeln(
				`\n${dirCount} director${dirCount === 1 ? "y" : "ies"}, ${fileCount} file${fileCount === 1 ? "" : "s"}`,
			);
		}

		return 0;
	})
	.toHandler();
