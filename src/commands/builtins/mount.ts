import { ObjectFileSystem } from "@ambiently-work/mirage";
import { isMountable } from "../../io/umask-fs.js";
import { command } from "../builder.js";

/**
 * `mount` lists active mounts and creates new ones. Currently only `tmpfs` is
 * supported as a built-in type — it backs an empty `ObjectFileSystem` that
 * lives only as long as the mount.
 *
 * Output format mirrors Linux: `<source> on <path> type <fstype> (<options>)`.
 */
export const mount = command("mount")
	.description("Mount a filesystem or list active mounts")
	.allowUnknownFlags()
	.argument("[args...]", "Mount specification")
	.action((ctx, { raw }) => {
		if (!isMountable(ctx.fs)) {
			ctx.stderr.writeln("mount: filesystem does not support mounting");
			return 1;
		}

		// Parse flags. Bash `mount` accepts options in any order; we recognize
		// `-t TYPE` for the filesystem type and `-o OPTS` for a comma-separated
		// options string (passed through opaquely to the listing).
		let type: string | null = null;
		let options = "rw";
		const positional: string[] = [];

		for (let i = 0; i < raw.length; i++) {
			const arg = raw[i];
			if (arg === "-t" || arg === "--types") {
				const next = raw[i + 1];
				if (!next) {
					ctx.stderr.writeln("mount: option requires an argument -- 't'");
					return 1;
				}
				type = next;
				i++;
			} else if (arg === "-o" || arg === "--options") {
				const next = raw[i + 1];
				if (!next) {
					ctx.stderr.writeln("mount: option requires an argument -- 'o'");
					return 1;
				}
				options = next;
				i++;
			} else if (arg.startsWith("-")) {
				ctx.stderr.writeln(`mount: unrecognized option '${arg}'`);
				return 1;
			} else {
				positional.push(arg);
			}
		}

		// No positional args (and no -t requesting an action): list mounts.
		if (positional.length === 0 && type === null) {
			const mounts = ctx.fs.listMountInfo();
			for (const m of mounts) {
				ctx.stdout.writeln(`${m.source} on ${m.path} type ${m.type} (${m.options})`);
			}
			return 0;
		}

		if (positional.length !== 2) {
			ctx.stderr.writeln("mount: usage: mount [-t type] [-o opts] source target");
			return 1;
		}

		const [source, target] = positional;
		const resolvedTarget = ctx.resolve(target);
		const fsType = type ?? "auto";

		let mountFs: import("@ambiently-work/mirage").IFileSystem;
		switch (fsType) {
			case "tmpfs":
				mountFs = new ObjectFileSystem();
				break;
			default:
				ctx.stderr.writeln(`mount: unsupported type '${fsType}'`);
				return 1;
		}

		try {
			ctx.fs.mountAt(resolvedTarget, mountFs, { type: fsType, source, options });
			return 0;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			ctx.stderr.writeln(`mount: ${msg}`);
			return 1;
		}
	})
	.toHandler();

export const umount = command("umount")
	.description("Unmount a filesystem")
	.allowUnknownFlags()
	.argument("<target>", "Mount point to unmount")
	.action((ctx, { raw }) => {
		if (!isMountable(ctx.fs)) {
			ctx.stderr.writeln("umount: filesystem does not support unmounting");
			return 1;
		}

		const positional: string[] = [];
		for (const arg of raw) {
			if (arg.startsWith("-")) {
				// Accept and ignore common umount flags like -f, -l for now —
				// they have no meaningful analog in an in-memory VFS.
				continue;
			}
			positional.push(arg);
		}

		if (positional.length === 0) {
			ctx.stderr.writeln("umount: usage: umount target");
			return 1;
		}

		let exitCode = 0;
		for (const target of positional) {
			try {
				ctx.fs.unmountAt(ctx.resolve(target));
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				ctx.stderr.writeln(`umount: ${msg}`);
				exitCode = 1;
			}
		}
		return exitCode;
	})
	.toHandler();
