import { command } from "../builder.js";
import type { CommandContext } from "../types.js";

interface LsFlags {
	long: boolean;
	all: boolean;
	almostAll: boolean;
	onePerLine: boolean;
	recursive: boolean;
	reverse: boolean;
	sortByTime: boolean;
	sortBySize: boolean;
	humanReadable: boolean;
	dirItself: boolean;
	classify: boolean;
}

function formatMode(mode: number, isDir: boolean, isLink: boolean): string {
	const type = isLink ? "l" : isDir ? "d" : "-";
	const perms = [
		mode & 0o400 ? "r" : "-",
		mode & 0o200 ? "w" : "-",
		mode & 0o100 ? "x" : "-",
		mode & 0o040 ? "r" : "-",
		mode & 0o020 ? "w" : "-",
		mode & 0o010 ? "x" : "-",
		mode & 0o004 ? "r" : "-",
		mode & 0o002 ? "w" : "-",
		mode & 0o001 ? "x" : "-",
	];
	return type + perms.join("");
}

function humanSize(bytes: number): string {
	if (bytes < 1024) return String(bytes);
	const units = ["K", "M", "G", "T"];
	let size = bytes;
	let unitIdx = -1;
	while (size >= 1024 && unitIdx < units.length - 1) {
		size /= 1024;
		unitIdx++;
	}
	if (size >= 10) {
		return Math.round(size) + units[unitIdx];
	}
	return size.toFixed(1) + units[unitIdx];
}

function formatDate(mtime: number): string {
	const d = new Date(mtime);
	const now = Date.now();
	const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;
	const months = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	const mon = months[d.getMonth()];
	const day = String(d.getDate()).padStart(2, " ");
	if (Math.abs(now - mtime) > sixMonthsMs) {
		// Older than 6 months: show year instead of time
		return `${mon} ${day}  ${d.getFullYear()}`;
	}
	const hours = String(d.getHours()).padStart(2, "0");
	const mins = String(d.getMinutes()).padStart(2, "0");
	return `${mon} ${day} ${hours}:${mins}`;
}

function classifySuffix(ctx: CommandContext, path: string): string {
	try {
		const st = ctx.fs.lstat(path);
		if (st.isDirectory()) return "/";
		if (st.isSymlink()) return "@";
		if (st.mode & 0o111) return "*";
	} catch {
		// ignore
	}
	return "";
}

interface EntryInfo {
	name: string;
	fullPath: string;
}

function listEntries(
	ctx: CommandContext,
	flags: LsFlags,
	dirPath: string,
	showHeader: boolean,
): number {
	const resolved = ctx.resolve(dirPath);

	if (flags.dirItself) {
		return printEntry(ctx, flags, resolved, dirPath);
	}

	let st;
	try {
		st = ctx.fs.stat(resolved);
	} catch {
		ctx.stderr.writeln(`ls: cannot access '${dirPath}': No such file or directory`);
		return 1;
	}

	if (!st.isDirectory()) {
		return printEntry(ctx, flags, resolved, dirPath);
	}

	if (showHeader) {
		ctx.stdout.writeln(`${dirPath}:`);
	}

	let names: string[];
	try {
		names = ctx.fs.readDir(resolved);
	} catch {
		ctx.stderr.writeln(`ls: cannot open directory '${dirPath}': Permission denied`);
		return 1;
	}

	if (flags.all) {
		names = [".", "..", ...names];
	} else if (flags.almostAll) {
		// include dotfiles but not . and ..
	} else {
		names = names.filter((n) => !n.startsWith("."));
	}

	// Build entry info
	const entries: EntryInfo[] = names.map((name) => {
		const fp = resolved === "/" ? "/" + name : resolved + "/" + name;
		return { name, fullPath: fp };
	});

	// Sort
	sortEntries(ctx, flags, entries);

	if (flags.long) {
		printLong(ctx, flags, entries);
	} else {
		for (const entry of entries) {
			let display = entry.name;
			if (flags.classify) {
				display += classifySuffix(ctx, entry.fullPath);
			}
			ctx.stdout.writeln(display);
		}
	}

	// Recursive
	if (flags.recursive) {
		for (const entry of entries) {
			if (entry.name === "." || entry.name === "..") continue;
			try {
				const childStat = ctx.fs.stat(entry.fullPath);
				if (childStat.isDirectory()) {
					ctx.stdout.write("\n");
					const childDir = dirPath === "." ? entry.name : dirPath + "/" + entry.name;
					listEntries(ctx, flags, childDir, true);
				}
			} catch {
				// skip
			}
		}
	}

	return 0;
}

function sortEntries(ctx: CommandContext, flags: LsFlags, entries: EntryInfo[]): void {
	if (flags.sortByTime) {
		entries.sort((a, b) => {
			try {
				const sa = ctx.fs.stat(a.fullPath);
				const sb = ctx.fs.stat(b.fullPath);
				return sb.mtime - sa.mtime;
			} catch {
				return 0;
			}
		});
	} else if (flags.sortBySize) {
		entries.sort((a, b) => {
			try {
				const sa = ctx.fs.stat(a.fullPath);
				const sb = ctx.fs.stat(b.fullPath);
				return sb.size - sa.size;
			} catch {
				return 0;
			}
		});
	}

	if (flags.reverse) {
		entries.reverse();
	}
}

function printLong(ctx: CommandContext, flags: LsFlags, entries: EntryInfo[]): void {
	for (const entry of entries) {
		let st;
		let lst;
		try {
			lst = ctx.fs.lstat(entry.fullPath);
			st = lst.isSymlink() ? ctx.fs.stat(entry.fullPath) : lst;
		} catch {
			try {
				lst = ctx.fs.lstat(entry.fullPath);
				st = lst;
			} catch {
				continue;
			}
		}

		const mode = formatMode(lst.mode, st.isDirectory(), lst.isSymlink());
		const nlinks = 1;
		const uid = st.uid;
		const gid = st.gid;
		const size = flags.humanReadable
			? humanSize(st.size).padStart(5, " ")
			: String(st.size).padStart(5, " ");
		const date = formatDate(st.mtime);
		let name = entry.name;

		if (lst.isSymlink()) {
			try {
				const target = ctx.fs.readlink(entry.fullPath);
				name = `${entry.name} -> ${target}`;
			} catch {
				// ignore
			}
		} else if (flags.classify) {
			name += classifySuffix(ctx, entry.fullPath);
		}

		ctx.stdout.writeln(`${mode} ${nlinks} ${uid} ${gid} ${size} ${date} ${name}`);
	}
}

function printEntry(
	ctx: CommandContext,
	flags: LsFlags,
	resolved: string,
	displayName: string,
): number {
	try {
		if (flags.long) {
			const lst = ctx.fs.lstat(resolved);
			const st = lst.isSymlink() ? ctx.fs.stat(resolved) : lst;
			const mode = formatMode(lst.mode, st.isDirectory(), lst.isSymlink());
			const size = flags.humanReadable
				? humanSize(st.size).padStart(5, " ")
				: String(st.size).padStart(5, " ");
			const date = formatDate(st.mtime);
			let name = displayName;
			if (lst.isSymlink()) {
				try {
					const target = ctx.fs.readlink(resolved);
					name = `${displayName} -> ${target}`;
				} catch {
					// ignore
				}
			} else if (flags.classify) {
				name += classifySuffix(ctx, resolved);
			}
			ctx.stdout.writeln(`${mode} 1 ${st.uid} ${st.gid} ${size} ${date} ${name}`);
		} else {
			let display = displayName;
			if (flags.classify) {
				display += classifySuffix(ctx, resolved);
			}
			ctx.stdout.writeln(display);
		}
		return 0;
	} catch {
		ctx.stderr.writeln(`ls: cannot access '${displayName}': No such file or directory`);
		return 1;
	}
}

export const ls = command("ls")
	.description("List directory contents")
	.flag("-l", "Use long listing format")
	.flag("-a, --all", "Show hidden entries including . and ..")
	.flag("-A", "Show hidden entries but not . and ..")
	.flag("-1", "One entry per line")
	.flag("-R", "List subdirectories recursively")
	.flag("-r", "Reverse sort order")
	.flag("-t", "Sort by modification time")
	.flag("-S", "Sort by file size")
	.flag("-h, --human-readable", "Print sizes in human-readable format")
	.flag("-d", "List directories themselves, not their contents")
	.flag("-F", "Append indicator to entries")
	.argument("[path...]", "Paths to list")
	.action((ctx, { args, flags }) => {
		const lsFlags: LsFlags = {
			long: !!flags.l,
			all: !!flags.all,
			almostAll: !!flags.A,
			onePerLine: !!flags["1"],
			recursive: !!flags.R,
			reverse: !!flags.r,
			sortByTime: !!flags.t,
			sortBySize: !!flags.S,
			humanReadable: !!flags.humanReadable,
			dirItself: !!flags.d,
			classify: !!flags.F,
		};

		const paths = args.length > 0 ? args : ["."];
		const showHeader = paths.length > 1 || lsFlags.recursive;
		let exitCode = 0;

		for (let i = 0; i < paths.length; i++) {
			if (i > 0 && showHeader) {
				ctx.stdout.write("\n");
			}
			const result = listEntries(ctx, lsFlags, paths[i], showHeader);
			if (result !== 0) exitCode = result;
		}

		return exitCode;
	})
	.toHandler();
