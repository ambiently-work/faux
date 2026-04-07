import type { ShellResult } from "./types.js";

/**
 * Information about a command execution, passed to hooks.
 */
export interface CommandExecution {
	/** The raw command string that was run */
	command: string;
	/** The result after execution */
	result: ShellResult;
	/** Wall-clock duration in milliseconds */
	durationMs: number;
	/** Timestamp when execution started */
	startedAt: number;
	/** Working directory at time of execution */
	cwd: string;
}

/**
 * Hook that runs before a command executes.
 * Return `false` to block execution, or a modified command string to rewrite it.
 */
export type BeforeHook = (
	command: string,
	cwd: string,
) => void | false | string | Promise<void | false | string>;

/**
 * Hook that runs after a command completes.
 */
export type AfterHook = (execution: CommandExecution) => void | Promise<void>;

/**
 * Hook that runs when a command fails (non-zero exit code).
 */
export type ErrorHook = (execution: CommandExecution) => void | Promise<void>;

/**
 * Transform applied to command output before returning.
 * Receives the result and returns a modified result.
 */
export type OutputTransform = (result: ShellResult, command: string) => ShellResult;

export class HookRegistry {
	private beforeHooks: BeforeHook[] = [];
	private afterHooks: AfterHook[] = [];
	private errorHooks: ErrorHook[] = [];
	private transforms: OutputTransform[] = [];

	before(hook: BeforeHook): () => void {
		this.beforeHooks.push(hook);
		return () => {
			const idx = this.beforeHooks.indexOf(hook);
			if (idx >= 0) this.beforeHooks.splice(idx, 1);
		};
	}

	after(hook: AfterHook): () => void {
		this.afterHooks.push(hook);
		return () => {
			const idx = this.afterHooks.indexOf(hook);
			if (idx >= 0) this.afterHooks.splice(idx, 1);
		};
	}

	onError(hook: ErrorHook): () => void {
		this.errorHooks.push(hook);
		return () => {
			const idx = this.errorHooks.indexOf(hook);
			if (idx >= 0) this.errorHooks.splice(idx, 1);
		};
	}

	transform(transform: OutputTransform): () => void {
		this.transforms.push(transform);
		return () => {
			const idx = this.transforms.indexOf(transform);
			if (idx >= 0) this.transforms.splice(idx, 1);
		};
	}

	async runBefore(command: string, cwd: string): Promise<{ blocked: boolean; command: string }> {
		let current = command;
		for (const hook of this.beforeHooks) {
			const result = await hook(current, cwd);
			if (result === false) return { blocked: true, command: current };
			if (typeof result === "string") current = result;
		}
		return { blocked: false, command: current };
	}

	async runAfter(execution: CommandExecution): Promise<void> {
		for (const hook of this.afterHooks) {
			await hook(execution);
		}
	}

	async runError(execution: CommandExecution): Promise<void> {
		for (const hook of this.errorHooks) {
			await hook(execution);
		}
	}

	applyTransforms(result: ShellResult, command: string): ShellResult {
		let current = result;
		for (const transform of this.transforms) {
			current = transform(current, command);
		}
		return current;
	}

	clear(): void {
		this.beforeHooks = [];
		this.afterHooks = [];
		this.errorHooks = [];
		this.transforms = [];
	}
}
