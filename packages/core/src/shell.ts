import { type AstNode, parse } from "@faux-shell/parser";
import { allBuiltins } from "./commands/builtins/index.js";
import { CommandRegistry } from "./commands/registry.js";
import type { CommandHandler } from "./commands/types.js";
import { Environment } from "./env/environment.js";
import { Executor } from "./executor/executor.js";
import {
	type AfterHook,
	type BeforeHook,
	type CommandExecution,
	type ErrorHook,
	HookRegistry,
	type OutputTransform,
} from "./hooks.js";
import { CommandTracker, type TrackerStats } from "./tracker.js";
import type { ShellResult } from "./types.js";
import { VirtualFileSystem } from "./vfs/filesystem.js";
import type { IFileSystem } from "./vfs/types.js";
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
	/**
	 * Enable WASM-accelerated runtime.
	 * - `true`: dynamically imports `@faux-shell/wasm` (must be installed)
	 * - A `WasmRuntimeModule` or partial: uses the provided module directly
	 */
	wasm?: boolean | Partial<WasmRuntimeModule>;
}

export class Shell {
	private env: Environment;
	private vfs: VirtualFileSystem;
	private registry: CommandRegistry;
	private executor: Executor;
	private parseFn!: (input: string) => AstNode;
	private hookRegistry: HookRegistry;
	private commandTracker: CommandTracker | null;

	private wasmReady: Promise<void> | null = null;
	private wasmExecuteFn:
		| ((ast: unknown, bridge: unknown, stdin: string) => Promise<unknown>)
		| null = null;

	constructor(options?: ShellOptions) {
		const opts = options ?? {};

		// Merge user shorthand into env
		const env = { ...opts.env };
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
				this.wasmReady = import("@faux-shell/wasm")
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
						// @faux-shell/wasm not installed — silently fall back to TS
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
		this.executor = new Executor(this.env, this.vfs, this.registry);
		this.hookRegistry = new HookRegistry();
		this.commandTracker = opts.tracking ? new CommandTracker(opts.maxHistory) : null;
	}

	// --- Execution ---

	async run(command: string): Promise<ShellResult> {
		if (this.wasmReady) {
			await this.wasmReady;
			this.wasmReady = null;
		}

		if (command.trim() === "") {
			return { stdout: "", stderr: "", exitCode: 0 };
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
				const bridge = new ShellBridge(this.env, this.vfs, this.registry);
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
