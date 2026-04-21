import type { QuickJSContext, QuickJSHandle, QuickJSWASMModule } from "quickjs-emscripten";
import { command } from "../builder.js";
import type { CommandContext, CommandHandler } from "../types.js";

/**
 * Options for the node command.
 *
 * The command runs JavaScript inside an isolated QuickJS runtime — no host
 * filesystem, no `child_process`, no network access. All I/O flows through
 * `ctx.fs`, `ctx.env`, `ctx.stdout`, `ctx.stderr`.
 */
export interface NodeCommandOptions {
	/**
	 * Hard memory cap per script, in bytes. Passed to
	 * `runtime.setMemoryLimit`. Defaults to no limit.
	 */
	memoryLimitBytes?: number;
	/**
	 * Wall-clock timeout per script, in milliseconds. Implemented via
	 * `runtime.setInterruptHandler`. Defaults to no timeout.
	 */
	timeoutMs?: number;
	/**
	 * Max number of pending microtasks/macrotasks to drain per invocation.
	 * Guards against infinite async loops. Defaults to 10000.
	 */
	maxPendingJobs?: number;
}

const PROCESS_EXIT_MARKER = "__faux_process_exit__";

/**
 * Creates a `node` shell command backed by the given QuickJS instance.
 *
 * The caller is responsible for loading QuickJS:
 *
 * ```ts
 * import { getQuickJS } from "quickjs-emscripten";
 * const QuickJS = await getQuickJS();
 * const shell = new Shell({ commands: [createNodeCommand(QuickJS)] });
 * ```
 *
 * Supports:
 *   - `node script.js [args...]`            — run a file
 *   - `node -e "code"`                      — evaluate a one-liner
 *   - `node -p "expr"`                      — evaluate and print the result
 *   - `some-cmd | node -e "..."`            — `process.stdin` holds piped input
 *
 * Guest scripts get `console`, `process`, and a minimal CommonJS
 * `require()` exposing stubs for `fs`, `path`, `os`, `util`.
 *
 * Designed for browser/worker environments — QuickJS runs entirely in WASM.
 */
export function createNodeCommand(
	quickjs: QuickJSWASMModule,
	options: NodeCommandOptions = {},
): CommandHandler {
	const maxJobs = options.maxPendingJobs ?? 10_000;

	return command("node")
		.description("Execute JavaScript in a sandboxed QuickJS runtime")
		.option("-e, --eval <code>", "Evaluate code and exit")
		.option("-p, --print <expr>", "Evaluate expression and print the result")
		.stopAfterFirstPositional()
		.argument("[script]", "Path to a JavaScript file")
		.argument("[args...]", "Arguments passed to the script")
		.action(async (ctx, { args, flags }) => {
			const evalCode = (flags.eval as string | undefined) || undefined;
			const printExpr = (flags.print as string | undefined) || undefined;

			let source: string;
			let filename: string;
			let scriptArgs: string[] = [];

			if (printExpr) {
				source = `console.log(${printExpr})`;
				filename = "<print>";
				scriptArgs = args;
			} else if (evalCode) {
				source = evalCode;
				filename = "<eval>";
				scriptArgs = args;
			} else if (args.length > 0) {
				const resolved = ctx.resolve(args[0]);
				if (!ctx.fs.exists(resolved)) {
					ctx.stderr.write(`node: ${args[0]}: No such file or directory\n`);
					return 1;
				}
				const stat = ctx.fs.stat(resolved);
				if (!stat.isFile()) {
					ctx.stderr.write(`node: ${args[0]}: Not a file\n`);
					return 1;
				}
				source = ctx.fs.readFile(resolved);
				filename = resolved;
				scriptArgs = args.slice(1);
			} else {
				ctx.stderr.write("node: missing script — pass a file, -e <code>, or -p <expr>\n");
				return 1;
			}

			const runtime = quickjs.newRuntime();
			const vm = runtime.newContext();

			if (options.memoryLimitBytes) {
				runtime.setMemoryLimit(options.memoryLimitBytes);
			}
			let interruptAt = 0;
			if (options.timeoutMs) {
				interruptAt = Date.now() + options.timeoutMs;
				runtime.setInterruptHandler(() => Date.now() > interruptAt);
			}

			const host = new HostContext(vm, ctx, filename, scriptArgs);

			try {
				host.install();

				const result = vm.evalCode(source, filename);
				if (result.error) {
					if (host.exitRequested) {
						result.error.dispose();
						return host.exitCode;
					}
					writeError(vm, ctx, result.error);
					result.error.dispose();
					return 1;
				}
				result.value.dispose();

				let drained = 0;
				while (runtime.hasPendingJob()) {
					if (drained++ >= maxJobs) {
						ctx.stderr.write(`node: exceeded max pending jobs (${maxJobs})\n`);
						return 1;
					}
					const jr = runtime.executePendingJobs(1);
					if (jr.error) {
						if (host.exitRequested) {
							jr.error.dispose();
							return host.exitCode;
						}
						writeError(vm, ctx, jr.error);
						jr.error.dispose();
						return 1;
					}
				}

				return host.exitRequested ? host.exitCode : 0;
			} catch (e) {
				ctx.stderr.write(`node: ${e instanceof Error ? e.message : String(e)}\n`);
				return 1;
			} finally {
				host.dispose();
				vm.dispose();
				runtime.dispose();
			}
		})
		.toHandler();
}

// ─── host context ──────────────────────────────────────────────────

class HostContext {
	private readonly disposables: QuickJSHandle[] = [];
	exitRequested = false;
	exitCode = 0;

	constructor(
		private readonly vm: QuickJSContext,
		private readonly ctx: CommandContext,
		private readonly filename: string,
		private readonly scriptArgs: string[],
	) {}

	install(): void {
		this.installConsole();
		this.installProcess();
		this.installRequire();
	}

	dispose(): void {
		for (const h of this.disposables.reverse()) {
			try {
				h.dispose();
			} catch {
				// already disposed
			}
		}
		this.disposables.length = 0;
	}

	private track<T extends QuickJSHandle>(h: T): T {
		this.disposables.push(h);
		return h;
	}

	// ─── console ───────────────────────────────────────────────────

	private installConsole(): void {
		const obj = this.track(this.vm.newObject());
		this.addLogFn(obj, "log", "stdout");
		this.addLogFn(obj, "info", "stdout");
		this.addLogFn(obj, "debug", "stdout");
		this.addLogFn(obj, "warn", "stderr");
		this.addLogFn(obj, "error", "stderr");
		this.vm.setProp(this.vm.global, "console", obj);
	}

	private addLogFn(obj: QuickJSHandle, name: string, sink: "stdout" | "stderr"): void {
		const fn = this.track(
			this.vm.newFunction(name, (...args) => {
				const parts = args.map((h) => formatGuestValue(this.vm, h));
				(sink === "stdout" ? this.ctx.stdout : this.ctx.stderr).write(`${parts.join(" ")}\n`);
				return this.vm.undefined;
			}),
		);
		this.vm.setProp(obj, name, fn);
	}

	// ─── process ───────────────────────────────────────────────────

	private installProcess(): void {
		const proc = this.track(this.vm.newObject());

		const argv = this.track(this.vm.newArray());
		const nodeH = this.track(this.vm.newString("node"));
		const scriptH = this.track(this.vm.newString(this.filename));
		this.vm.setProp(argv, 0, nodeH);
		this.vm.setProp(argv, 1, scriptH);
		this.scriptArgs.forEach((a, i) => {
			const s = this.track(this.vm.newString(a));
			this.vm.setProp(argv, i + 2, s);
		});
		this.vm.setProp(proc, "argv", argv);

		const envObj = this.track(this.vm.newObject());
		// Expose every shell variable — not just exported ones — so scripts see
		// what the user passed to `new Shell({ env })` without needing `export`.
		for (const [k, v] of this.ctx.env.all()) {
			const s = this.track(this.vm.newString(v));
			this.vm.setProp(envObj, k, s);
		}
		this.vm.setProp(proc, "env", envObj);

		this.vm.setProp(proc, "platform", this.track(this.vm.newString("linux")));
		this.vm.setProp(proc, "version", this.track(this.vm.newString("v0.0.0-faux")));

		this.vm.setProp(
			proc,
			"cwd",
			this.track(this.vm.newFunction("cwd", () => this.vm.newString(this.ctx.cwd))),
		);

		this.vm.setProp(
			proc,
			"exit",
			this.track(
				this.vm.newFunction("exit", (codeH) => {
					const code = codeH ? numberFromHandle(this.vm, codeH, 0) : 0;
					this.exitRequested = true;
					this.exitCode = Math.trunc(code);
					return {
						error: this.vm.newError({
							name: "ProcessExit",
							message: PROCESS_EXIT_MARKER,
						}),
					};
				}),
			),
		);

		this.vm.setProp(proc, "stdout", this.buildWritableStream("stdout"));
		this.vm.setProp(proc, "stderr", this.buildWritableStream("stderr"));
		this.vm.setProp(proc, "stdin", this.buildStdin());

		this.vm.setProp(this.vm.global, "process", proc);
	}

	private buildWritableStream(sink: "stdout" | "stderr"): QuickJSHandle {
		const s = this.track(this.vm.newObject());
		this.vm.setProp(
			s,
			"write",
			this.track(
				this.vm.newFunction(`${sink}.write`, (dataH) => {
					const data = dataH ? this.vm.getString(dataH) : "";
					(sink === "stdout" ? this.ctx.stdout : this.ctx.stderr).write(data);
					return this.vm.true;
				}),
			),
		);
		this.vm.setProp(s, "isTTY", this.vm.false);
		return s;
	}

	private buildStdin(): QuickJSHandle {
		const s = this.track(this.vm.newObject());
		this.vm.setProp(
			s,
			"read",
			this.track(this.vm.newFunction("stdin.read", () => this.vm.newString(this.ctx.stdin))),
		);
		this.vm.setProp(
			s,
			"toString",
			this.track(this.vm.newFunction("stdin.toString", () => this.vm.newString(this.ctx.stdin))),
		);
		return s;
	}

	// ─── require ───────────────────────────────────────────────────

	private installRequire(): void {
		const modules = new Map<string, QuickJSHandle>();
		modules.set("fs", this.buildFsModule());
		modules.set("path", this.buildPathModule());
		modules.set("os", this.buildOsModule());
		modules.set("util", this.buildUtilModule());
		for (const h of modules.values()) this.track(h);

		const requireFn = this.track(
			this.vm.newFunction("require", (nameH) => {
				if (!nameH) {
					return {
						error: this.vm.newError({
							name: "TypeError",
							message: "require: module name is required",
						}),
					};
				}
				const name = this.vm.getString(nameH);
				const bare = name.replace(/^node:/, "");
				const mod = modules.get(bare);
				if (mod) return mod.dup();
				return {
					error: this.vm.newError({
						name: "Error",
						message: `Cannot find module '${name}'`,
					}),
				};
			}),
		);
		this.vm.setProp(this.vm.global, "require", requireFn);
	}

	private buildFsModule(): QuickJSHandle {
		const mod = this.vm.newObject();
		const addFn = (name: string, impl: (args: QuickJSHandle[]) => unknown) => {
			const fn = this.track(
				this.vm.newFunction(`fs.${name}`, (...args) => {
					try {
						const result = impl(args);
						return jsValueToHandle(this.vm, result);
					} catch (e) {
						return {
							error: this.vm.newError({
								name: "Error",
								message: e instanceof Error ? e.message : String(e),
							}),
						};
					}
				}),
			);
			this.vm.setProp(mod, name, fn);
		};

		addFn("readFileSync", ([pathH]) => {
			const p = this.ctx.resolve(this.vm.getString(pathH));
			if (!this.ctx.fs.exists(p)) {
				throw new Error(`ENOENT: no such file or directory, open '${p}'`);
			}
			return this.ctx.fs.readFile(p);
		});

		addFn("writeFileSync", ([pathH, dataH]) => {
			const p = this.ctx.resolve(this.vm.getString(pathH));
			const data = this.vm.getString(dataH);
			this.ctx.fs.writeFile(p, data);
			return undefined;
		});

		addFn("existsSync", ([pathH]) => {
			return this.ctx.fs.exists(this.ctx.resolve(this.vm.getString(pathH)));
		});

		addFn("readdirSync", ([pathH]) => {
			const p = this.ctx.resolve(this.vm.getString(pathH));
			if (!this.ctx.fs.exists(p)) {
				throw new Error(`ENOENT: no such file or directory, scandir '${p}'`);
			}
			return this.ctx.fs.readDir(p);
		});

		addFn("statSync", ([pathH]) => {
			const p = this.ctx.resolve(this.vm.getString(pathH));
			if (!this.ctx.fs.exists(p)) {
				throw new Error(`ENOENT: no such file or directory, stat '${p}'`);
			}
			const st = this.ctx.fs.stat(p);
			const isFile = st.isFile();
			const isDirectory = st.isDirectory();
			return {
				isFile: () => isFile,
				isDirectory: () => isDirectory,
				size: typeof st.size === "number" ? st.size : 0,
			};
		});

		addFn("mkdirSync", ([pathH, optsH]) => {
			const p = this.ctx.resolve(this.vm.getString(pathH));
			const opts = optsH ? (this.vm.dump(optsH) as Record<string, unknown>) : {};
			const recursive = opts?.recursive === true;
			this.ctx.fs.mkdir(p, { recursive });
			return undefined;
		});

		addFn("unlinkSync", ([pathH]) => {
			const p = this.ctx.resolve(this.vm.getString(pathH));
			this.ctx.fs.rm(p);
			return undefined;
		});

		addFn("rmSync", ([pathH, optsH]) => {
			const p = this.ctx.resolve(this.vm.getString(pathH));
			const opts = optsH ? (this.vm.dump(optsH) as Record<string, unknown>) : {};
			this.ctx.fs.rm(p, {
				recursive: opts?.recursive === true,
				force: opts?.force === true,
			});
			return undefined;
		});

		addFn("appendFileSync", ([pathH, dataH]) => {
			const p = this.ctx.resolve(this.vm.getString(pathH));
			const data = this.vm.getString(dataH);
			this.ctx.fs.appendFile(p, data);
			return undefined;
		});

		return mod;
	}

	private buildPathModule(): QuickJSHandle {
		const mod = this.vm.newObject();
		const addFn = (name: string, impl: (args: string[]) => unknown) => {
			const fn = this.track(
				this.vm.newFunction(`path.${name}`, (...args) => {
					const strs = args.map((a) => this.vm.getString(a));
					try {
						return jsValueToHandle(this.vm, impl(strs));
					} catch (e) {
						return {
							error: this.vm.newError({
								name: "Error",
								message: e instanceof Error ? e.message : String(e),
							}),
						};
					}
				}),
			);
			this.vm.setProp(mod, name, fn);
		};

		addFn("basename", ([p, ext]) => {
			const slash = p.lastIndexOf("/");
			let base = slash === -1 ? p : p.slice(slash + 1);
			if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length);
			return base;
		});
		addFn("dirname", ([p]) => {
			const slash = p.lastIndexOf("/");
			if (slash === -1) return ".";
			if (slash === 0) return "/";
			return p.slice(0, slash);
		});
		addFn("extname", ([p]) => {
			const slash = p.lastIndexOf("/");
			const base = slash === -1 ? p : p.slice(slash + 1);
			const dot = base.lastIndexOf(".");
			if (dot <= 0) return "";
			return base.slice(dot);
		});
		addFn("join", (parts) => joinPath(parts));
		addFn("resolve", (parts) => this.resolvePath(parts));
		addFn("normalize", ([p]) => normalizePath(p));
		addFn("isAbsolute", ([p]) => p.startsWith("/"));
		addFn("relative", ([from, to]) => relativePath(from, to));

		this.vm.setProp(mod, "sep", this.track(this.vm.newString("/")));
		this.vm.setProp(mod, "delimiter", this.track(this.vm.newString(":")));
		return mod;
	}

	private buildOsModule(): QuickJSHandle {
		const mod = this.vm.newObject();
		this.vm.setProp(mod, "EOL", this.track(this.vm.newString("\n")));
		this.vm.setProp(
			mod,
			"platform",
			this.track(this.vm.newFunction("platform", () => this.vm.newString("linux"))),
		);
		this.vm.setProp(
			mod,
			"homedir",
			this.track(
				this.vm.newFunction("homedir", () => this.vm.newString(this.ctx.env.get("HOME") || "/")),
			),
		);
		this.vm.setProp(
			mod,
			"tmpdir",
			this.track(this.vm.newFunction("tmpdir", () => this.vm.newString("/tmp"))),
		);
		this.vm.setProp(
			mod,
			"arch",
			this.track(this.vm.newFunction("arch", () => this.vm.newString("wasm32"))),
		);
		return mod;
	}

	private buildUtilModule(): QuickJSHandle {
		const mod = this.vm.newObject();
		this.vm.setProp(
			mod,
			"inspect",
			this.track(
				this.vm.newFunction("inspect", (valueH) => {
					if (!valueH) return this.vm.newString("undefined");
					return this.vm.newString(formatGuestValue(this.vm, valueH));
				}),
			),
		);
		this.vm.setProp(
			mod,
			"format",
			this.track(
				this.vm.newFunction("format", (...args) => {
					const parts = args.map((h) => formatGuestValue(this.vm, h));
					return this.vm.newString(parts.join(" "));
				}),
			),
		);
		return mod;
	}

	private resolvePath(parts: string[]): string {
		let out = this.ctx.cwd;
		for (const p of parts) {
			if (!p) continue;
			out = p.startsWith("/") ? p : `${out}/${p}`;
		}
		return normalizePath(out);
	}
}

// ─── helpers ───────────────────────────────────────────────────────

function numberFromHandle(vm: QuickJSContext, h: QuickJSHandle, fallback: number): number {
	try {
		return vm.getNumber(h);
	} catch {
		return fallback;
	}
}

function formatGuestValue(vm: QuickJSContext, h: QuickJSHandle): string {
	return formatValue(vm.dump(h));
}

function formatValue(v: unknown, seen: WeakSet<object> = new WeakSet()): string {
	if (v === null) return "null";
	if (v === undefined) return "undefined";
	if (typeof v === "string") return v;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	if (typeof v === "function") return "[Function]";
	if (typeof v === "object") {
		if (seen.has(v as object)) return "[Circular]";
		seen.add(v as object);
		if (Array.isArray(v)) {
			return `[ ${v.map((x) => formatValue(x, seen)).join(", ")} ]`;
		}
		const rec = v as Record<string, unknown>;
		if (rec.name && rec.message) {
			return `${rec.name}: ${rec.message}`;
		}
		const entries = Object.entries(rec).map(([k, val]) => `${k}: ${formatValue(val, seen)}`);
		return `{ ${entries.join(", ")} }`;
	}
	return String(v);
}

function jsValueToHandle(vm: QuickJSContext, v: unknown): QuickJSHandle {
	if (v === undefined) return vm.undefined;
	if (v === null) return vm.null;
	if (typeof v === "boolean") return v ? vm.true : vm.false;
	if (typeof v === "number") return vm.newNumber(v);
	if (typeof v === "string") return vm.newString(v);
	if (Array.isArray(v)) {
		const arr = vm.newArray();
		v.forEach((item, i) => {
			const h = jsValueToHandle(vm, item);
			vm.setProp(arr, i, h);
			if (!isPrimitiveHandle(vm, h)) h.dispose();
		});
		return arr;
	}
	if (typeof v === "object") {
		const obj = vm.newObject();
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
			if (typeof val === "function") {
				const fn = vm.newFunction(k, () => jsValueToHandle(vm, (val as () => unknown)()));
				vm.setProp(obj, k, fn);
				fn.dispose();
			} else {
				const h = jsValueToHandle(vm, val);
				vm.setProp(obj, k, h);
				if (!isPrimitiveHandle(vm, h)) h.dispose();
			}
		}
		return obj;
	}
	return vm.undefined;
}

function isPrimitiveHandle(vm: QuickJSContext, h: QuickJSHandle): boolean {
	return h === vm.undefined || h === vm.null || h === vm.true || h === vm.false;
}

function writeError(vm: QuickJSContext, ctx: CommandContext, errH: QuickJSHandle): void {
	const dumped = vm.dump(errH) as Record<string, unknown> | null;
	if (!dumped) {
		ctx.stderr.write("node: <unknown error>\n");
		return;
	}
	const name = typeof dumped.name === "string" ? dumped.name : "Error";
	const message = typeof dumped.message === "string" ? dumped.message : "";
	const stack = typeof dumped.stack === "string" ? dumped.stack : "";
	ctx.stderr.write(`${name}: ${message}\n`);
	if (stack) ctx.stderr.write(stack);
}

function joinPath(parts: string[]): string {
	const out: string[] = [];
	for (const p of parts) {
		if (!p) continue;
		if (p.startsWith("/")) {
			out.length = 0;
			out.push(p);
		} else {
			out.push(p);
		}
	}
	if (out.length === 0) return ".";
	const joined = out.join("/").replace(/\/+/g, "/");
	return normalizePath(joined);
}

function normalizePath(p: string): string {
	const isAbs = p.startsWith("/");
	const segments: string[] = [];
	for (const seg of p.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			if (segments.length > 0 && segments[segments.length - 1] !== "..") {
				segments.pop();
			} else if (!isAbs) {
				segments.push("..");
			}
			continue;
		}
		segments.push(seg);
	}
	const out = segments.join("/");
	if (isAbs) return `/${out}`;
	return out || ".";
}

function relativePath(from: string, to: string): string {
	const fromParts = normalizePath(from).split("/").filter(Boolean);
	const toParts = normalizePath(to).split("/").filter(Boolean);
	let i = 0;
	while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
		i++;
	}
	const ups = fromParts.slice(i).map(() => "..");
	const downs = toParts.slice(i);
	const out = [...ups, ...downs].join("/");
	return out || ".";
}
