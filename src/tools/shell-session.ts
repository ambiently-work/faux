import { Shell, type ShellOptions } from "../shell.js";
import type { ShellResult } from "../types.js";

export class ShellSession {
	readonly shell: Shell;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(shellOrOptions: Shell | ShellOptions = {}) {
		this.shell = shellOrOptions instanceof Shell ? shellOrOptions : new Shell(shellOrOptions);
	}

	run(command: string): Promise<ShellResult> {
		const task = this.queue.then(() => this.shell.run(command));
		this.queue = task.then(
			() => undefined,
			() => undefined,
		);
		return task;
	}
}
