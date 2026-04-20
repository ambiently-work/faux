import type { ShellResult } from "../types.js";

/**
 * A command in the pipeline receives stdin and produces a ShellResult.
 */
export type PipelineCommand = (stdin: string) => ShellResult;

/**
 * Connect stdout of one command to stdin of the next.
 * Returns the final ShellResult.
 */
export function pipeTwo(
	left: PipelineCommand,
	right: PipelineCommand,
	stdin: string = "",
): ShellResult {
	const leftResult = left(stdin);
	return right(leftResult.stdout);
}

/**
 * Run a chain of pipeline commands, piping stdout -> stdin through each stage.
 */
export function pipeChain(commands: PipelineCommand[], stdin: string = ""): ShellResult {
	if (commands.length === 0) {
		return { stdout: "", stderr: "", exitCode: 0 };
	}

	let currentStdin = stdin;
	const stderrParts: string[] = [];

	for (let i = 0; i < commands.length; i++) {
		const result = commands[i](currentStdin);
		stderrParts.push(result.stderr);
		currentStdin = result.stdout;

		// For pipelines, the exit code of the last command is used
		// unless pipefail is set (handled by PipelineRunner)
		if (i === commands.length - 1) {
			return {
				stdout: result.stdout,
				stderr: stderrParts.join(""),
				exitCode: result.exitCode,
			};
		}
	}

	// Should not reach here, but satisfy the type system
	return { stdout: currentStdin, stderr: stderrParts.join(""), exitCode: 0 };
}

export interface PipelineRunnerOptions {
	/** If true, the pipeline exit code is the first non-zero exit from any stage. */
	pipefail?: boolean;
}

/**
 * PipelineRunner chains multiple commands, passing stdout from one to stdin of the next.
 */
export class PipelineRunner {
	private commands: PipelineCommand[] = [];
	private options: PipelineRunnerOptions;

	constructor(options?: PipelineRunnerOptions) {
		this.options = options ?? {};
	}

	/**
	 * Add a command stage to the pipeline.
	 */
	add(command: PipelineCommand): this {
		this.commands.push(command);
		return this;
	}

	/**
	 * Execute the entire pipeline with optional initial stdin.
	 */
	run(stdin: string = ""): ShellResult {
		if (this.commands.length === 0) {
			return { stdout: "", stderr: "", exitCode: 0 };
		}

		let currentStdin = stdin;
		const stderrParts: string[] = [];
		const exitCodes: number[] = [];

		for (const command of this.commands) {
			const result = command(currentStdin);
			stderrParts.push(result.stderr);
			exitCodes.push(result.exitCode);
			currentStdin = result.stdout;
		}

		let exitCode = exitCodes[exitCodes.length - 1];
		if (this.options.pipefail) {
			const firstFailure = exitCodes.find((c) => c !== 0);
			if (firstFailure !== undefined) {
				exitCode = firstFailure;
			}
		}

		return {
			stdout: currentStdin,
			stderr: stderrParts.join(""),
			exitCode,
		};
	}
}
