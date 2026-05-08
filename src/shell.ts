import { type IFileSystem, VirtualFileSystem } from "@ambiently-work/mirage";
import { createHistoryCommand } from "./commands/builtins/history.js";
import { allBuiltins } from "./commands/builtins/index.js";
import { CommandRegistry } from "./commands/registry.js";
import type { CommandHandler, CommandTerminalContext } from "./commands/types.js";
import { Environment } from "./env/environment.js";
import { Executor } from "./executor/executor.js";
import { expandHistory } from "./history-expand.js";
import {
	type AfterHook,
	type BeforeHook,
	type CommandExecution,
	type ErrorHook,
	HookRegistry,
	type OutputTransform,
} from "./hooks.js";
import { type AstNode, parse } from "./parser/index.js";
import { CommandTracker } from "./tracker.js";
import type { ShellResult } from "./types.js";
import { ShellBridge } from "./wasm-bridge.js";
import type { WasmRuntimeModule } from "./wasm-interfaces.js";
import { getWasmExecutor, getWasmParser, useWasmRuntime } from "./wasm-runtime.js";

export interface ShellOptions {
	/** Initial environment variables */
	env?: Record<string, string>;
	/** Initial filesystem contents — keys are paths, values are file contents */
	fs?: Record<string, string>;
	/** Custom commands to register alongside builtins */
	commands?: CommandHandler[];
	/** Custom parse function (e.g., WASM parser) */
	parser?: (input: string) => AstNode;
	/** Initial working directory (default: "/") */
	cwd?: string;
	/** Username for the shell environment (sets USER, HOME, etc.) */
	user?: string;
	/** Whether to register default builtins (default: true) */
	builtins?: boolean;
	/** Enable command tracking (default: false) */
	tracking?: boolean;
	/** Maximum number of commands to keep in history (default: 1000) */
	maxHistory?: number;
	/** Terminal/TTY metadata exposed to builtins (default: non-interactive 80x24 dumb terminal) */
	tty?: ShellTtyOptions;
	/**
	 * Mark this shell as interactive. When true, the shell sources `/etc/bash.bashrc`
	 * and `~/.bashrc` (or the login files when `login` is also set) before the first
	 * command runs. Default: false.
	 */
	interactive?: boolean;
	/**
	 * Mark this shell as a login shell. Implies and requires `interactive`. When true,
	 * the shell sources `/etc/profile` followed by the first found of `~/.bash_profile`,
	 * `~/.bash_login`, or `~/.profile` before the first command runs. Default: false.
	 */
	login?: boolean;
	/**
	 * Skip rc/profile/`BASH_ENV` loading entirely. Use for hermetic tests or when the
	 * embedder wants full control over startup. Default: false.
	 */
	skipStartupFiles?: boolean;
	/**
	 * Enable WASM-accelerated runtime.
	 * - `true`: dynamically loads the bundled WASM runtime from this package
	 * - A `WasmRuntimeModule` or partial: uses the provided module directly
	 */
	wasm?: boolean | Partial<WasmRuntimeModule>;
}

export interface ShellTtyOptions {
	stdin?: boolean;
	stdout?: boolean;
	stderr?: boolean;
	cols?: number;
	rows?: number;
	name?: string;
}

export class Shell {
	private env: Environment;
	private vfs: VirtualFileSystem;
	private registry: CommandRegistry;
	private executor: Executor;
	private tty: CommandTerminalContext;
	private parseFn!: (input: string) => AstNode;
	private hookRegistry: HookRegistry;
	private commandTracker: CommandTracker | null;

	private interactive: boolean;
	private login: boolean;
	private skipStartupFiles: boolean;
	private startupFilesLoaded: boolean;

	private wasmReady: Promise<void> | null = null;
	private wasmExecuteFn:
		| ((ast: unknown, bridge: unknown, stdin: string) => Promise<unknown>)
		| null = null;

	constructor(options?: ShellOptions) {
		const opts = options ?? {};

		// Merge user shorthand into env
		const env = { ...opts.env };
		this.tty = createTerminalContext(opts.tty, env);
		env.COLUMNS = String(this.tty.term.cols);
		env.LINES = String(this.tty.term.rows);
		env.TERM ??= this.tty.term.name;

		if (opts.user) {
			env.USER ??= opts.user;
			env.HOME ??= `/home/${opts.user}`;
			env.HOSTNAME ??= "faux-shell";
		}

		this.env = new Environment(env);
		if (opts.cwd) {
			this.env.cwd = opts.cwd;
			this.env.set("PWD", opts.cwd);
		}

		this.vfs = new VirtualFileSystem({
			files: opts.fs,
			cwd: this.env.cwd,
		});

		// Handle WASM runtime initialization
		if (opts.wasm) {
			if (opts.wasm === true) {
				this.wasmReady = import("./wasm/index.js")
					.then((mod) => mod.loadWasmRuntime())
					.then((runtime) => {
						useWasmRuntime(runtime);
						// Wire up WASM parser if available
						const wasmParser = getWasmParser(runtime);
						if (wasmParser) {
							this.parseFn = wasmParser as (input: string) => AstNode;
						}
						// Wire up WASM executor if available
						const wasmExecutor = getWasmExecutor(runtime);
						if (wasmExecutor) {
							this.wasmExecuteFn = wasmExecutor;
						}
					})
					.catch(() => {
						// WASM binary unavailable in this env — silently fall back to TS
					});
			} else {
				useWasmRuntime(opts.wasm);
				const wasmParser = getWasmParser(opts.wasm);
				if (wasmParser) {
					this.parseFn = wasmParser as (input: string) => AstNode;
				}
				const wasmExecutor = getWasmExecutor(opts.wasm);
				if (wasmExecutor) {
					this.wasmExecuteFn = wasmExecutor;
				}
			}
		}

		this.registry = new CommandRegistry();

		if (opts.builtins !== false) {
			this.registry.registerAll(allBuiltins);
		}

		if (opts.commands) {
			this.registry.registerAll(opts.commands);
		}

		this.parseFn ??= opts.parser ?? parse;
		this.executor = new Executor(this.env, this.vfs, this.registry, this.tty);
		this.hookRegistry = new HookRegistry();

		this.interactive = opts.interactive ?? false;
		this.login = opts.login ?? false;
		this.skipStartupFiles = opts.skipStartupFiles ?? false;
		this.startupFilesLoaded = false;

		// Interactive shells auto-enable tracking so `history` has data to show.
		const trackingEnabled = opts.tracking ?? this.interactive;
		const histsizeOverride = parseHistsize(this.env.get("HISTSIZE"));
		const maxHistory = opts.maxHistory ?? histsizeOverride ?? 500;
		this.commandTracker = trackingEnabled ? new CommandTracker(maxHistory) : null;

		// Seed defaults bash provides for interactive shells.
		if (this.interactive) {
			if (!this.env.get("HISTFILE")) {
				const home = this.env.get("HOME") ?? "/root";
				this.env.set("HISTFILE", `${home}/.bash_history`);
			}
			if (!this.env.get("HISTSIZE")) {
				this.env.set("HISTSIZE", String(maxHistory));
			}
		}

		if (opts.builtins !== false) {
			this.registry.register(createHistoryCommand(() => this.commandTracker));
		}
	}

	// --- Execution ---

	async run(command: string): Promise<ShellResult> {
		if (this.wasmReady) {
			await this.wasmReady;
			this.wasmReady = null;
		}

		if (!this.startupFilesLoaded) {
			this.startupFilesLoaded = true;
			if (!this.skipStartupFiles) {
				await this.runStartupFiles();
			}
		}

		if (command.trim() === "") {
			return { stdout: "", stderr: "", exitCode: 0 };
		}

		// History expansion (set -H) runs before parsing so `!!` and friends become
		// the literal text from a previous entry.
		if (this.env.hasOption("histexpand") && this.commandTracker) {
			const expanded = expandHistory(command, this.commandTracker);
			if (expanded === null) {
				return { stdout: "", stderr: `${command}: event not found\n`, exitCode: 1 };
			}
			command = expanded;
		}

		// Run before hooks
		const before = await this.hookRegistry.runBefore(command, this.env.cwd);
		if (before.blocked) {
			return { stdout: "", stderr: "command blocked by hook\n", exitCode: 130 };
		}
		const effectiveCommand = before.command;

		const startedAt = Date.now();
		const t0 = performance.now();

		let result: ShellResult;
		try {
			const ast = this.parseFn(effectiveCommand);

			if (this.wasmExecuteFn) {
				// Use WASM executor with bridge
				const bridge = new ShellBridge(this.env, this.vfs, this.registry, this.tty);
				const wasmResult = await this.wasmExecuteFn(ast, bridge, "");
				result = wasmResult as ShellResult;
			} else {
				// Use TS executor
				result = await this.executor.execute(ast);
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			result = { stdout: "", stderr: `${message}\n`, exitCode: 2 };
		}

		const durationMs = performance.now() - t0;

		// Apply output transforms
		result = this.hookRegistry.applyTransforms(result, effectiveCommand);

		// Build execution record
		const execution: CommandExecution = {
			command: effectiveCommand,
			result,
			durationMs,
			startedAt,
			cwd: this.env.cwd,
		};

		// Track
		if (this.commandTracker) {
			this.commandTracker.record(execution);
		}

		// Run after hooks
		await this.hookRegistry.runAfter(execution);

		// Run error hooks if failed
		if (result.exitCode !== 0) {
			await this.hookRegistry.runError(execution);
		}

		return result;
	}

	/**
	 * Source the appropriate startup files based on `interactive` / `login` mode.
	 * Idempotent — only runs once. Called automatically before the first `run()`,
	 * but can be invoked eagerly so embedders can ensure aliases / PATH / functions
	 * are visible before they kick off any work.
	 */
	async init(): Promise<void> {
		if (this.wasmReady) {
			await this.wasmReady;
			this.wasmReady = null;
		}
		if (this.startupFilesLoaded) return;
		this.startupFilesLoaded = true;
		if (!this.skipStartupFiles) {
			await this.runStartupFiles();
		}
	}

	private async runStartupFiles(): Promise<void> {
		const home = this.env.get("HOME") ?? "/root";

		if (this.interactive) {
			if (this.login) {
				await this.sourceIfExists("/etc/profile");
				for (const candidate of [
					`${home}/.bash_profile`,
					`${home}/.bash_login`,
					`${home}/.profile`,
				]) {
					if (await this.sourceIfExists(candidate)) break;
				}
			} else {
				await this.sourceIfExists("/etc/bash.bashrc");
				await this.sourceIfExists(`${home}/.bashrc`);
			}
		} else {
			const bashEnv = this.env.get("BASH_ENV");
			if (bashEnv && bashEnv.length > 0) {
				const expanded = expandHome(bashEnv, home);
				await this.sourceIfExists(expanded);
			}
		}
	}

	private async sourceIfExists(path: string): Promise<boolean> {
		let content: string;
		try {
			if (!this.vfs.exists(path)) return false;
			content = this.vfs.readFile(path);
		} catch {
			return false;
		}
		try {
			const ast = this.parseFn(content);
			await this.executor.execute(ast);
		} catch {
			// Don't abort startup on a malformed rc file — same shape as bash, which
			// prints the error and moves on.
		}
		return true;
	}

	// --- Hooks ---

	/** Register a hook that runs before each command. Return false to block, or a string to rewrite. */
	before(hook: BeforeHook): () => void {
		return this.hookRegistry.before(hook);
	}

	/** Register a hook that runs after each command completes. */
	after(hook: AfterHook): () => void {
		return this.hookRegistry.after(hook);
	}

	/** Register a hook that runs when a command fails (non-zero exit). */
	onError(hook: ErrorHook): () => void {
		return this.hookRegistry.onError(hook);
	}

	/** Register an output transform applied to every command's result. */
	transform(transform: OutputTransform): () => void {
		return this.hookRegistry.transform(transform);
	}

	/** Remove all hooks and transforms. */
	clearHooks(): void {
		this.hookRegistry.clear();
	}

	// --- Tracking ---

	/** Enable command tracking (if not enabled at construction). */
	enableTracking(maxHistory = 1000): void {
		if (!this.commandTracker) {
			this.commandTracker = new CommandTracker(maxHistory);
		}
	}

	/** Get the command tracker (null if tracking is disabled). */
	get tracker(): CommandTracker | null {
		return this.commandTracker;
	}

	// --- Registration ---

	register(handler: CommandHandler): this {
		this.registry.register(handler);
		return this;
	}

	unregister(name: string): this {
		this.registry.remove(name);
		return this;
	}

	// --- Accessors ---

	get filesystem(): IFileSystem {
		return this.vfs;
	}

	get environment(): Environment {
		return this.env;
	}

	get commands(): string[] {
		return this.registry.list();
	}

	mount(path: string, fs: IFileSystem): this {
		this.vfs.mount(path, fs);
		return this;
	}

	cd(path: string): this {
		const resolved = path.startsWith("/")
			? path
			: this.env.cwd === "/"
				? `/${path}`
				: `${this.env.cwd}/${path}`;
		this.env.cwd = resolved;
		this.env.set("PWD", resolved);
		return this;
	}

	snapshot(): Record<string, string> {
		return this.vfs.snapshot();
	}
}

function createTerminalContext(
	options: ShellTtyOptions | undefined,
	env: Record<string, string>,
): CommandTerminalContext {
	const cols = parsePositiveInt(options?.cols ?? env.COLUMNS, 80);
	const rows = parsePositiveInt(options?.rows ?? env.LINES, 24);
	return {
		isatty: {
			stdin: options?.stdin ?? false,
			stdout: options?.stdout ?? false,
			stderr: options?.stderr ?? false,
		},
		term: {
			cols,
			rows,
			name: options?.name ?? env.TERM ?? "dumb",
		},
	};
}

function parsePositiveInt(value: string | number | undefined, fallback: number): number {
	const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function expandHome(path: string, home: string): string {
	if (path === "~") return home;
	if (path.startsWith("~/")) return `${home}${path.slice(1)}`;
	return path;
}

function parseHistsize(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	return n;
}
