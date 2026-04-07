import { command as cmd } from "../builder.js";
import type { CommandContext } from "../types.js";

export const type = cmd("type")
	.description("Display information about command type")
	.flag("-t, --terse", "Print only the type")
	.flag("-a, --all", "Show all locations of command")
	.flag("-p, --path", "Print disk file only")
	.argument("[names...]", "Command names to describe")
	.action((ctx, { args, flags }) => {
		if (args.length === 0) return 0;

		let exitCode = 0;

		for (const name of args) {
			const results = describeCommand(ctx, name, flags.all as boolean);

			if (results.length === 0) {
				if (!flags.terse) {
					ctx.stderr.writeln(`${name}: not found`);
				}
				exitCode = 1;
				continue;
			}

			for (const result of results) {
				if (flags.terse) {
					ctx.stdout.writeln(result.type);
				} else {
					ctx.stdout.writeln(result.description);
				}
				if (!flags.all) break;
			}
		}

		return exitCode;
	})
	.toHandler();

export const which = cmd("which")
	.description("Locate a command")
	.argument("[names...]", "Command names to find")
	.action((ctx, { args }) => {
		let exitCode = 0;

		for (const name of args) {
			const path = findInPath(ctx, name);
			if (path) {
				ctx.stdout.writeln(path);
			} else {
				ctx.stderr.writeln(`which: no ${name} in (${ctx.env.get("PATH") ?? ""})`);
				exitCode = 1;
			}
		}

		return exitCode;
	})
	.toHandler();

export const command = cmd("command")
	.description("Execute a command bypassing aliases and functions")
	.flag("-v, --describe", "Describe command")
	.flag("-V, --verbose-describe", "Verbose describe command")
	.flag("-p, --path-only", "Use default PATH to find command")
	.allowUnknownFlags()
	.stopAfterFirstPositional()
	.argument("[args...]", "Command and its arguments")
	.action(async (ctx, { args, flags }) => {
		if (args.length === 0) return 0;

		if (flags.describe || flags.verboseDescribe) {
			const name = args[0];
			const results = describeCommand(ctx, name, false);
			if (results.length > 0) {
				const r = results[0];
				if (r.type === "alias") {
					ctx.stdout.writeln(`alias ${name}='${ctx.env.getAlias(name)}'`);
				} else if (r.type === "builtin") {
					ctx.stdout.writeln(name);
				} else if (r.type === "function") {
					ctx.stdout.writeln(name);
				} else if (r.type === "file") {
					ctx.stdout.writeln(r.path ?? name);
				}
				return 0;
			}
			return 1;
		}

		// Execute bypassing aliases and functions
		const cmdLine = args.join(" ");
		const result = await ctx.subExec(cmdLine);
		ctx.stdout.write(result.stdout);
		if (result.stderr) {
			ctx.stderr.write(result.stderr);
		}
		return result.exitCode;
	})
	.toHandler();

export const builtin = cmd("builtin")
	.description("Execute a shell builtin")
	.allowUnknownFlags()
	.stopAfterFirstPositional()
	.argument("[args...]", "Builtin command and its arguments")
	.action(async (ctx, { args }) => {
		if (args.length === 0) return 0;

		const cmdLine = args.join(" ");
		const result = await ctx.subExec(cmdLine);
		ctx.stdout.write(result.stdout);
		if (result.stderr) {
			ctx.stderr.write(result.stderr);
		}
		return result.exitCode;
	})
	.toHandler();

const hashTable = new Map<string, string>();

export const hash = cmd("hash")
	.description("Remember or display program locations")
	.flag("-r, --reset", "Clear the hash table")
	.option("-d, --delete <name>", "Remove name from the hash table")
	.flag("-t, --find", "Print full path for each name")
	.allowUnknownFlags()
	.argument("[names...]", "Command names")
	.action((ctx, { args, flags, raw }) => {
		// hash has complex enough arg handling that we use raw
		if (raw.length === 0) {
			if (hashTable.size === 0) {
				ctx.stderr.writeln("hash: hash table empty");
				return 0;
			}
			ctx.stdout.writeln("hits\tcommand");
			for (const [name, path] of hashTable) {
				ctx.stdout.writeln(`   1\t${path}`);
			}
			return 0;
		}

		let i = 0;
		while (i < raw.length) {
			const arg = raw[i];
			if (arg === "-r") {
				hashTable.clear();
			} else if (arg === "-d") {
				i++;
				if (i < raw.length) {
					hashTable.delete(raw[i]);
				}
			} else if (arg === "-t") {
				i++;
				while (i < raw.length) {
					const name = raw[i];
					const cached = hashTable.get(name);
					if (cached) {
						ctx.stdout.writeln(cached);
					} else {
						const found = findInPath(ctx, name);
						if (found) {
							hashTable.set(name, found);
							ctx.stdout.writeln(found);
						} else {
							ctx.stderr.writeln(`hash: ${name}: not found`);
							return 1;
						}
					}
					i++;
				}
				return 0;
			} else if (!arg.startsWith("-")) {
				const found = findInPath(ctx, arg);
				if (found) {
					hashTable.set(arg, found);
				} else {
					ctx.stderr.writeln(`hash: ${arg}: not found`);
					return 1;
				}
			}
			i++;
		}

		return 0;
	})
	.toHandler();

const disabledBuiltins = new Set<string>();

export const enable = cmd("enable")
	.description("Enable and disable shell builtins")
	.flag("-n, --disable", "Disable builtin")
	.flag("-a, --all", "List all builtins including disabled")
	.flag("-p, --print", "Print disabled builtins")
	.argument("[names...]", "Builtin names")
	.action((ctx, { args, flags }) => {
		if (flags.all || flags.print) {
			for (const name of disabledBuiltins) {
				ctx.stdout.writeln(`enable -n ${name}`);
			}
			return 0;
		}

		if (args.length === 0) {
			ctx.stdout.writeln("enable .");
			ctx.stdout.writeln("enable :");
			ctx.stdout.writeln("enable [");
			ctx.stdout.writeln("enable alias");
			ctx.stdout.writeln("enable bg");
			ctx.stdout.writeln("enable cd");
			ctx.stdout.writeln("enable echo");
			ctx.stdout.writeln("enable eval");
			ctx.stdout.writeln("enable exec");
			ctx.stdout.writeln("enable exit");
			ctx.stdout.writeln("enable export");
			ctx.stdout.writeln("enable fg");
			ctx.stdout.writeln("enable hash");
			ctx.stdout.writeln("enable jobs");
			ctx.stdout.writeln("enable kill");
			ctx.stdout.writeln("enable printf");
			ctx.stdout.writeln("enable pwd");
			ctx.stdout.writeln("enable read");
			ctx.stdout.writeln("enable return");
			ctx.stdout.writeln("enable set");
			ctx.stdout.writeln("enable shift");
			ctx.stdout.writeln("enable source");
			ctx.stdout.writeln("enable test");
			ctx.stdout.writeln("enable trap");
			ctx.stdout.writeln("enable type");
			ctx.stdout.writeln("enable unalias");
			ctx.stdout.writeln("enable unset");
			ctx.stdout.writeln("enable wait");
			return 0;
		}

		for (const name of args) {
			if (flags.disable) {
				disabledBuiltins.add(name);
			} else {
				disabledBuiltins.delete(name);
			}
		}

		return 0;
	})
	.toHandler();

interface CommandDescription {
	type: "alias" | "function" | "builtin" | "file" | "keyword";
	description: string;
	path?: string;
}

function describeCommand(ctx: CommandContext, name: string, all: boolean): CommandDescription[] {
	const results: CommandDescription[] = [];

	// Check alias
	const aliasVal = ctx.env.getAlias(name);
	if (aliasVal !== undefined) {
		results.push({
			type: "alias",
			description: `${name} is aliased to \`${aliasVal}'`,
		});
		if (!all) return results;
	}

	// Check shell keywords
	const keywords = [
		"if",
		"then",
		"else",
		"elif",
		"fi",
		"for",
		"while",
		"until",
		"do",
		"done",
		"case",
		"esac",
		"in",
		"function",
		"{",
		"}",
		"!",
		"[[",
		"]]",
	];
	if (keywords.includes(name)) {
		results.push({
			type: "keyword",
			description: `${name} is a shell keyword`,
		});
		if (!all) return results;
	}

	// Check function
	const func = ctx.env.getFunction(name);
	if (func !== undefined) {
		results.push({
			type: "function",
			description: `${name} is a function`,
		});
		if (!all) return results;
	}

	// Check builtin
	const builtins = [
		".",
		":",
		"[",
		"alias",
		"bg",
		"builtin",
		"cd",
		"command",
		"echo",
		"eval",
		"exec",
		"exit",
		"export",
		"false",
		"fg",
		"getopts",
		"hash",
		"help",
		"jobs",
		"kill",
		"let",
		"local",
		"printf",
		"pwd",
		"read",
		"readonly",
		"return",
		"set",
		"shift",
		"shopt",
		"source",
		"test",
		"trap",
		"true",
		"type",
		"ulimit",
		"umask",
		"unalias",
		"unset",
		"wait",
	];
	if (builtins.includes(name) && !disabledBuiltins.has(name)) {
		results.push({
			type: "builtin",
			description: `${name} is a shell builtin`,
		});
		if (!all) return results;
	}

	// Check PATH
	const path = findInPath(ctx, name);
	if (path) {
		results.push({
			type: "file",
			description: `${name} is ${path}`,
			path,
		});
	}

	return results;
}

function findInPath(ctx: CommandContext, name: string): string | null {
	if (name.includes("/")) {
		const resolved = ctx.resolve(name);
		if (ctx.fs.exists(resolved)) {
			return resolved;
		}
		return null;
	}

	const pathStr = ctx.env.get("PATH") ?? "";
	const dirs = pathStr.split(":");

	for (const dir of dirs) {
		if (!dir) continue;
		const fullPath = dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
		try {
			if (ctx.fs.exists(fullPath)) {
				return fullPath;
			}
		} catch {
			// Skip invalid paths
		}
	}

	return null;
}
