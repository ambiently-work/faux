import type { CommandExecution } from "./hooks.js";

/**
 * Tracks command execution history, timing, and success/failure stats.
 */
export class CommandTracker {
	private _history: CommandExecution[] = [];
	private _maxHistory: number;

	constructor(maxHistory = 1000) {
		this._maxHistory = maxHistory;
	}

	record(execution: CommandExecution): void {
		this._history.push(execution);
		if (this._history.length > this._maxHistory) {
			this._history.shift();
		}
	}

	/** All recorded executions */
	get history(): readonly CommandExecution[] {
		return this._history;
	}

	/** Last N executions */
	last(n = 10): CommandExecution[] {
		return this._history.slice(-n);
	}

	/** Only failed commands (non-zero exit code) */
	get failures(): CommandExecution[] {
		return this._history.filter((e) => e.result.exitCode !== 0);
	}

	/** Only successful commands */
	get successes(): CommandExecution[] {
		return this._history.filter((e) => e.result.exitCode === 0);
	}

	/** Commands sorted by duration (slowest first) */
	get slowest(): CommandExecution[] {
		return [...this._history].sort((a, b) => b.durationMs - a.durationMs);
	}

	/** Total execution time across all tracked commands */
	get totalTimeMs(): number {
		return this._history.reduce((sum, e) => sum + e.durationMs, 0);
	}

	/** Average execution time */
	get avgTimeMs(): number {
		if (this._history.length === 0) return 0;
		return this.totalTimeMs / this._history.length;
	}

	/** Number of commands executed */
	get count(): number {
		return this._history.length;
	}

	/** Number of failed commands */
	get failCount(): number {
		return this._history.filter((e) => e.result.exitCode !== 0).length;
	}

	/** Success rate (0-1) */
	get successRate(): number {
		if (this._history.length === 0) return 1;
		return 1 - this.failCount / this._history.length;
	}

	/** Aggregate stats */
	stats(): TrackerStats {
		const failures = this.failures;
		const slowest = this.slowest.slice(0, 5);

		return {
			total: this._history.length,
			succeeded: this._history.length - failures.length,
			failed: failures.length,
			successRate: this.successRate,
			totalTimeMs: this.totalTimeMs,
			avgTimeMs: this.avgTimeMs,
			slowestCommands: slowest.map((e) => ({
				command: e.command,
				durationMs: e.durationMs,
				exitCode: e.result.exitCode,
			})),
			recentFailures: failures.slice(-5).map((e) => ({
				command: e.command,
				exitCode: e.result.exitCode,
				stderr: e.result.stderr.slice(0, 200),
			})),
			commandFrequency: this.commandFrequency(),
		};
	}

	/** How often each command base name is used */
	commandFrequency(): Record<string, number> {
		const freq: Record<string, number> = {};
		for (const e of this._history) {
			const base = e.command.trim().split(/\s+/)[0] ?? "";
			if (base) freq[base] = (freq[base] ?? 0) + 1;
		}
		return freq;
	}

	/** Format stats as a human-readable summary */
	summary(): string {
		const s = this.stats();
		const lines: string[] = [];
		lines.push(`Commands: ${s.total} (${s.succeeded} ok, ${s.failed} failed)`);
		lines.push(`Success rate: ${(s.successRate * 100).toFixed(1)}%`);
		lines.push(`Total time: ${s.totalTimeMs.toFixed(0)}ms (avg ${s.avgTimeMs.toFixed(1)}ms)`);

		if (s.slowestCommands.length > 0) {
			lines.push(`Slowest:`);
			for (const c of s.slowestCommands) {
				lines.push(`  ${c.durationMs.toFixed(0)}ms  ${c.command}`);
			}
		}

		if (s.recentFailures.length > 0) {
			lines.push(`Recent failures:`);
			for (const f of s.recentFailures) {
				const err = f.stderr.trim().split("\n")[0] ?? "";
				lines.push(`  [${f.exitCode}] ${f.command}${err ? ": " + err : ""}`);
			}
		}

		return lines.join("\n");
	}

	/** Reset all tracked history */
	clear(): void {
		this._history = [];
	}
}

export interface TrackerStats {
	total: number;
	succeeded: number;
	failed: number;
	successRate: number;
	totalTimeMs: number;
	avgTimeMs: number;
	slowestCommands: { command: string; durationMs: number; exitCode: number }[];
	recentFailures: { command: string; exitCode: number; stderr: string }[];
	commandFrequency: Record<string, number>;
}
