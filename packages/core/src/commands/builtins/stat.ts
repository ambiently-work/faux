import { command } from "../builder.js";

export const stat = command("stat")
	.description("Display file status")
	.flag("-L", "Follow symlinks")
	.flag("-l", "Do not follow symlinks")
	.argument("<files...>", "Files to stat")
	.action((ctx, { args: files, flags }) => {
		let followSymlinks = true;
		if (flags.l) followSymlinks = false;
		if (flags.L) followSymlinks = true;

		if (files.length === 0) {
			ctx.stderr.writeln("stat: missing operand");
			return 1;
		}

		let exitCode = 0;
		for (const file of files) {
			const resolved = ctx.resolve(file);
			try {
				const s = followSymlinks ? ctx.fs.stat(resolved) : ctx.fs.lstat(resolved);
				const fileType = s.isDirectory()
					? "directory"
					: s.isSymlink()
						? "symbolic link"
						: "regular file";

				const modeOctal = "0" + (s.mode & 0o7777).toString(8).padStart(4, "0");

				ctx.stdout.writeln(`  File: ${file}`);
				ctx.stdout.writeln(
					`  Size: ${s.size}\tBlocks: ${Math.ceil(s.size / 512) * 8}\tIO Block: 4096\t${fileType}`,
				);
				ctx.stdout.writeln(`Access: (${modeOctal})\tUid: (${s.uid})\tGid: (${s.gid})`);
				ctx.stdout.writeln(`Access: ${new Date(s.atime).toISOString()}`);
				ctx.stdout.writeln(`Modify: ${new Date(s.mtime).toISOString()}`);
				ctx.stdout.writeln(`Change: ${new Date(s.ctime).toISOString()}`);
			} catch {
				ctx.stderr.writeln(`stat: cannot stat '${file}': No such file or directory`);
				exitCode = 1;
			}
		}

		return exitCode;
	})
	.toHandler();
