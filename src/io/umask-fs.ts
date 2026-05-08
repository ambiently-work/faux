import type { IFileSystem, MirageStats } from "@ambiently-work/mirage";

export interface MountInfo {
	path: string;
	type: string;
	source: string;
	options: string;
}

/**
 * Optional mount-aware capability for filesystems. `UmaskFileSystem` implements
 * this when its inner fs (a `VirtualFileSystem`) exposes the underlying
 * `mount`/`unmount`/`listMounts` surface. Builtins (`mount`, `umount`) probe
 * for this with `isMountable()` rather than asserting the concrete class so
 * embedders can swap the wrapper for their own.
 */
export interface MountableFileSystem extends IFileSystem {
	mountAt(
		path: string,
		fs: IFileSystem,
		options: { type: string; source: string; options?: string },
	): void;
	unmountAt(path: string): void;
	listMountInfo(): MountInfo[];
}

/**
 * Runtime check for the mount capability — a builtin can use this to surface
 * a clean error message when the embedder has swapped in an FS that doesn't
 * support mounting, rather than crashing inside the call.
 */
export function isMountable(fs: IFileSystem): fs is MountableFileSystem {
	const candidate = fs as Partial<MountableFileSystem>;
	return (
		typeof candidate.mountAt === "function" &&
		typeof candidate.unmountAt === "function" &&
		typeof candidate.listMountInfo === "function"
	);
}

interface InnerWithMount extends IFileSystem {
	mount?(mountPoint: string, fs: IFileSystem): void;
	unmount?(mountPoint: string): void;
	listMounts?(): Map<string, IFileSystem>;
}

function normalizeMountPath(path: string): string {
	if (!path.startsWith("/")) return `/${path}`;
	if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "");
	return path;
}

/**
 * Wraps an `IFileSystem` so newly-created files and directories pick up a mode
 * derived from the current umask:
 *   - new files: `0o666 & ~umask`
 *   - new directories: `0o777 & ~umask`
 *
 * Existing entries keep their mode on subsequent writes — only the create path
 * applies the mask, matching POSIX semantics.
 *
 * Also forwards `mount`/`unmount`/`listMounts` to the inner FS (when it
 * supports them) and tracks the type/source metadata that the in-shell
 * `mount` builtin needs to render Linux-style listings.
 */
export class UmaskFileSystem implements IFileSystem, MountableFileSystem {
	private mountMeta: Map<string, { type: string; source: string; options: string }> = new Map();

	constructor(
		private readonly inner: IFileSystem,
		private readonly getUmask: () => number,
	) {}

	readFile(path: string): string {
		return this.inner.readFile(path);
	}

	readDir(path: string): string[] {
		return this.inner.readDir(path);
	}

	stat(path: string): MirageStats {
		return this.inner.stat(path);
	}

	lstat(path: string): MirageStats {
		return this.inner.lstat(path);
	}

	exists(path: string): boolean {
		return this.inner.exists(path);
	}

	writeFile(path: string, content: string): void {
		const existed = this.inner.exists(path);
		this.inner.writeFile(path, content);
		if (!existed) {
			this.applyMode(path, 0o666);
		}
	}

	appendFile(path: string, content: string): void {
		const existed = this.inner.exists(path);
		this.inner.appendFile(path, content);
		if (!existed) {
			this.applyMode(path, 0o666);
		}
	}

	mkdir(path: string, options?: { recursive?: boolean }): void {
		const created = collectMissingDirs(this.inner, path, options?.recursive ?? false);
		this.inner.mkdir(path, options);
		for (const dir of created) {
			this.applyMode(dir, 0o777);
		}
	}

	rm(path: string, options?: { recursive?: boolean; force?: boolean }): void {
		this.inner.rm(path, options);
	}

	cp(src: string, dest: string, options?: { recursive?: boolean }): void {
		const existed = this.inner.exists(dest);
		this.inner.cp(src, dest, options);
		if (!existed && this.inner.exists(dest)) {
			// cp preserves mode by default; we only apply umask if it created
			// something genuinely new and we have no source mode to copy from.
			// In practice the inner cp does the right thing — leave it alone.
		}
	}

	mv(src: string, dest: string): void {
		this.inner.mv(src, dest);
	}

	chmod(path: string, mode: number): void {
		this.inner.chmod(path, mode);
	}

	chown(path: string, uid: number, gid: number): void {
		this.inner.chown(path, uid, gid);
	}

	symlink(target: string, path: string): void {
		this.inner.symlink(target, path);
	}

	readlink(path: string): string {
		return this.inner.readlink(path);
	}

	realpath(path: string): string {
		return this.inner.realpath(path);
	}

	glob(pattern: string, options?: { cwd?: string }): string[] {
		return this.inner.glob(pattern, options);
	}

	mountAt(
		path: string,
		fs: IFileSystem,
		options: { type: string; source: string; options?: string },
	): void {
		const inner = this.inner as InnerWithMount;
		if (typeof inner.mount !== "function") {
			throw new Error("mount: underlying filesystem does not support mounting");
		}
		const normalized = normalizeMountPath(path);
		inner.mount(normalized, fs);
		this.mountMeta.set(normalized, {
			type: options.type,
			source: options.source,
			options: options.options ?? "rw",
		});
	}

	unmountAt(path: string): void {
		const inner = this.inner as InnerWithMount;
		if (typeof inner.unmount !== "function") {
			throw new Error("umount: underlying filesystem does not support unmounting");
		}
		const normalized = normalizeMountPath(path);
		const mounts = typeof inner.listMounts === "function" ? inner.listMounts() : null;
		if (mounts && !mounts.has(normalized)) {
			throw new Error(`umount: ${path}: not mounted`);
		}
		inner.unmount(normalized);
		this.mountMeta.delete(normalized);
	}

	listMountInfo(): MountInfo[] {
		const inner = this.inner as InnerWithMount;
		if (typeof inner.listMounts !== "function") return [];
		const mounts = inner.listMounts();
		const result: MountInfo[] = [];
		for (const [path] of mounts) {
			const meta = this.mountMeta.get(path) ?? {
				type: "unknown",
				source: "unknown",
				options: "rw",
			};
			result.push({ path, type: meta.type, source: meta.source, options: meta.options });
		}
		return result;
	}

	private applyMode(path: string, base: number): void {
		const umask = this.getUmask();
		const mode = base & ~umask & 0o777;
		try {
			this.inner.chmod(path, mode);
		} catch {
			// Some adapters might not implement chmod for synthetic paths — silently
			// skip. The default mode from the inner fs still stands.
		}
	}
}

function collectMissingDirs(fs: IFileSystem, path: string, recursive: boolean): string[] {
	if (!recursive) {
		return fs.exists(path) ? [] : [path];
	}
	const parts = path.split("/").filter((p) => p.length > 0);
	const missing: string[] = [];
	let cur = "";
	for (const part of parts) {
		cur = `${cur}/${part}`;
		if (!fs.exists(cur)) missing.push(cur);
	}
	return missing;
}

/**
 * Parse a umask value from the env (`UMASK` is stored as an octal string).
 * Falls back to the standard 0o022 when missing or malformed.
 */
export function parseUmaskEnv(value: string | undefined): number {
	if (!value) return 0o022;
	const n = Number.parseInt(value, 8);
	if (!Number.isFinite(n) || n < 0 || n > 0o777) return 0o022;
	return n;
}
