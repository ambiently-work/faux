import type { IFileSystem } from "@ambiently-work/mirage";
import type { CommandRegistry } from "./commands/registry.js";
import type { CommandContext } from "./commands/types.js";
import type { Environment } from "./env/environment.js";
import { ShellBreak, ShellContinue, ShellExit, ShellReturn } from "./executor/pipeline.js";
import { WritableBuffer } from "./io/stream.js";
import { parse } from "./parser/index.js";
import type { ShellResult } from "./types.js";

/**
 * Bridge object passed to the WASM executor. Each method is called from Rust
 * via wasm-bindgen to access TS-side state (environment, filesystem, commands).
 */
export class ShellBridge {
	private env: Environment;
	private fs: IFileSystem;
	private registry: CommandRegistry;

	constructor(env: Environment, fs: IFileSystem, registry: CommandRegistry) {
		this.env = env;
		this.fs = fs;
		this.registry = registry;
	}

	// ---- Environment ----

	env_get(name: string): string | undefined {
		// Check special variables first
		const special = this.env.getSpecial(name);
		if (special !== undefined) return special;
		return this.env.get(name);
	}

	env_set(name: string, value: string): void {
		this.env.set(name, value);
	}

	env_cwd(): string {
		return this.env.cwd;
	}

	env_export(name: string): void {
		this.env.export(name);
	}

	env_mark_readonly(name: string): void {
		this.env.markReadonly(name);
	}

	env_last_exit_code(): number {
		return this.env.lastExitCode;
	}

	env_set_last_exit_code(code: number): void {
		this.env.lastExitCode = code;
	}

	env_get_alias(name: string): string | undefined {
		return this.env.getAlias(name);
	}

	env_set_function(name: string, body: unknown): void {
		this.env.setFunction(name, body);
	}

	env_get_function(name: string): unknown | undefined {
		return this.env.getFunction(name);
	}

	env_get_positional_args(): string[] {
		return this.env.positionalArgs;
	}

	env_set_positional_args(args: string[]): void {
		this.env.positionalArgs = args;
	}

	env_fork(): ShellBridge {
		const childEnv = this.env.fork();
		return new ShellBridge(childEnv, this.fs, this.registry);
	}

	// ---- Filesystem ----

	fs_read_file(path: string): string | undefined {
		try {
			return this.fs.readFile(path);
		} catch {
			return undefined;
		}
	}

	fs_write_file(path: string, content: string): void {
		this.fs.writeFile(path, content);
	}

	fs_append_file(path: string, content: string): void {
		this.fs.appendFile(path, content);
	}

	fs_exists(path: string): boolean {
		return this.fs.exists(path);
	}

	fs_glob(pattern: string, cwd: string): string[] {
		try {
			return this.fs.glob(pattern, { cwd });
		} catch {
			return [];
		}
	}

	// ---- Command execution ----

	has_command(name: string): boolean {
		return this.registry.has(name);
	}

	async execute_command(
		name: string,
		args: string[],
		stdin: string,
		_redirects: unknown,
	): Promise<ShellResult & { signal?: string; levels?: number }> {
		const stdout = new WritableBuffer();
		const stderr = new WritableBuffer();

		const handler = this.registry.get(name);
		if (!handler) {
			stderr.writeln(`${name}: command not found`);
			return { stdout: "", stderr: stderr.toString(), exitCode: 127 };
		}

		const resolvePath = (p: string): string => {
			if (p.startsWith("/")) return p;
			const cwd = this.env.cwd;
			if (cwd === "/") return `/${p}`;
			return `${cwd}/${p}`;
		};

		const ctx: CommandContext = {
			args,
			stdin,
			env: this.env,
			fs: this.fs,
			cwd: this.env.cwd,
			stdout,
			stderr,
			resolve: resolvePath,
			subExec: async (cmd: string) => {
				const ast = parse(cmd);
				// Re-enter the WASM executor for sub-execution would be ideal,
				// but for simplicity we use the TS executor path here.
				// This is fine because subExec is relatively rare.
				const { Executor } = await import("./executor/executor.js");
				const exec = new Executor(this.env, this.fs, this.registry);
				const result = await exec.execute(ast);
				return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
			},
		};

		try {
			const exitCode = await handler.execute(ctx);
			return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
		} catch (e) {
			if (e instanceof ShellBreak) {
				return {
					stdout: stdout.toString(),
					stderr: stderr.toString(),
					exitCode: 0,
					signal: "break",
					levels: e.levels,
				};
			}
			if (e instanceof ShellContinue) {
				return {
					stdout: stdout.toString(),
					stderr: stderr.toString(),
					exitCode: 0,
					signal: "continue",
					levels: e.levels,
				};
			}
			if (e instanceof ShellExit) {
				return {
					stdout: stdout.toString(),
					stderr: stderr.toString(),
					exitCode: e.code,
					signal: "exit",
				};
			}
			if (e instanceof ShellReturn) {
				return {
					stdout: stdout.toString(),
					stderr: stderr.toString(),
					exitCode: e.code,
					signal: "return",
				};
			}
			const message = e instanceof Error ? e.message : String(e);
			stderr.writeln(`${name}: ${message}`);
			return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 1 };
		}
	}

	// ---- Parser ----

	parse_input(input: string): unknown {
		return parse(input) as unknown;
	}
}
