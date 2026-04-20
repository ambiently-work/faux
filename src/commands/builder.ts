import type { CommandContext, CommandHandler } from "./types.js";

// --- Public types ---

export interface ParsedArgs {
	/** Positional arguments (after flag parsing) */
	args: string[];
	/** Parsed flags as key-value pairs */
	flags: Record<string, string | boolean | number | string[]>;
	/** The raw args before parsing */
	raw: string[];
}

export type ActionFn = (ctx: CommandContext, parsed: ParsedArgs) => number | Promise<number>;

export interface FlagDefinition {
	short?: string;
	long: string;
	description: string;
	type: "boolean" | "string" | "number" | "count";
	default?: string | boolean | number;
	required?: boolean;
	choices?: string[];
	alias?: string[];
	multiple?: boolean;
}

export interface ArgDefinition {
	name: string;
	description: string;
	required?: boolean;
	variadic?: boolean;
	default?: string;
	choices?: string[];
}

// --- Command builder ---

export class Command {
	private _name: string;
	private _description = "";
	private _aliases: string[] = [];
	private _flags: FlagDefinition[] = [];
	private _args: ArgDefinition[] = [];
	private _action: ActionFn | null = null;
	private _subcommands: Command[] = [];
	private _examples: string[] = [];
	private _version = "";
	private _hidden = false;
	private _middleware: MiddlewareFn[] = [];
	private _parent: Command | null = null;
	private _allowUnknown = false;
	private _stopAfterFirstPositional = false;
	private _longMap: Map<string, FlagDefinition> | null = null;
	private _shortMap: Map<string, FlagDefinition> | null = null;

	constructor(name: string) {
		this._name = name;
	}

	/** Set the command description shown in help. */
	description(desc: string): this {
		this._description = desc;
		return this;
	}

	/** Add an alias for this command. */
	alias(...names: string[]): this {
		this._aliases.push(...names);
		return this;
	}

	/** Set a version string (shown with --version flag). */
	version(v: string): this {
		this._version = v;
		return this;
	}

	/** Hide this command from help output. */
	hidden(): this {
		this._hidden = true;
		return this;
	}

	/** Treat unknown flags as positional arguments instead of erroring. */
	allowUnknownFlags(): this {
		this._allowUnknown = true;
		return this;
	}

	/** Stop parsing flags after the first positional argument is encountered. */
	stopAfterFirstPositional(): this {
		this._stopAfterFirstPositional = true;
		return this;
	}

	// --- Flags ---

	/**
	 * Add a boolean flag.
	 * ```
	 * cmd.flag("-v, --verbose", "Enable verbose output")
	 * ```
	 */
	flag(flags: string, description: string, options?: { default?: boolean }): this {
		const parsed = parseFlags(flags);
		this._flags.push({
			...parsed,
			description,
			type: "boolean",
			default: options?.default ?? false,
		});
		return this;
	}

	/**
	 * Add a string option.
	 * ```
	 * cmd.option("-o, --output <path>", "Output file path")
	 * cmd.option("-f, --format <fmt>", "Format", { choices: ["json", "csv"], default: "json" })
	 * ```
	 */
	option(
		flags: string,
		description: string,
		options?: { default?: string; required?: boolean; choices?: string[]; multiple?: boolean },
	): this {
		const parsed = parseFlags(flags);
		this._flags.push({
			...parsed,
			description,
			type: "string",
			default: options?.multiple ? undefined : options?.default,
			required: options?.required,
			choices: options?.choices,
			multiple: options?.multiple,
		});
		return this;
	}

	/**
	 * Add a numeric option.
	 * ```
	 * cmd.number("-n, --count <n>", "Number of items", { default: 10 })
	 * ```
	 */
	number(
		flags: string,
		description: string,
		options?: { default?: number; required?: boolean },
	): this {
		const parsed = parseFlags(flags);
		this._flags.push({
			...parsed,
			description,
			type: "number",
			default: options?.default,
			required: options?.required,
		});
		return this;
	}

	// --- Positional arguments ---

	/**
	 * Add a required positional argument.
	 * ```
	 * cmd.argument("<source>", "Source file")
	 * ```
	 */
	argument(
		name: string,
		description: string,
		options?: { choices?: string[]; default?: string },
	): this {
		const isRequired = name.startsWith("<");
		const isVariadic = name.includes("...");
		const cleanName = name.replace(/[<>[\].]/g, "").trim();
		this._args.push({
			name: cleanName,
			description,
			required: isRequired,
			variadic: isVariadic,
			default: options?.default,
			choices: options?.choices,
		});
		return this;
	}

	// --- Subcommands ---

	/**
	 * Add a subcommand.
	 * ```
	 * const sub = cmd.command("init", "Initialize project");
	 * sub.action((ctx, { args, flags }) => { ... });
	 * ```
	 */
	command(name: string, description?: string): Command {
		const sub = new Command(name);
		if (description) sub.description(description);
		sub._parent = this;
		this._subcommands.push(sub);
		return sub;
	}

	// --- Examples ---

	/** Add a usage example shown in help. */
	example(usage: string): this {
		this._examples.push(usage);
		return this;
	}

	// --- Middleware ---

	/**
	 * Add middleware that runs before the action.
	 * Can modify parsed args, or return a number to short-circuit with that exit code.
	 */
	use(fn: MiddlewareFn): this {
		this._middleware.push(fn);
		return this;
	}

	// --- Action ---

	/** Set the handler function for this command. */
	action(fn: ActionFn): this {
		this._action = fn;
		return this;
	}

	// --- Build ---

	/**
	 * Build into CommandHandler(s) for registration.
	 * Returns an array (one per command name + aliases).
	 */
	build(): CommandHandler[] {
		const handlers: CommandHandler[] = [];
		const names = [this._name, ...this._aliases];

		for (const name of names) {
			handlers.push({
				name,
				execute: (ctx) => this.execute(ctx),
			});
		}

		return handlers;
	}

	/** Build a single CommandHandler (just the primary name). */
	toHandler(): CommandHandler {
		return {
			name: this._name,
			execute: (ctx) => this.execute(ctx),
		};
	}

	// --- Execution ---

	private async execute(ctx: CommandContext): Promise<number> {
		const args = ctx.args;

		// Check for --help
		if (args.includes("--help") || args.includes("-h")) {
			ctx.stdout.write(this.helpText());
			return 0;
		}

		// Check for --version
		if (this._version && (args.includes("--version") || args.includes("-V"))) {
			ctx.stdout.writeln(`${this._name} ${this._version}`);
			return 0;
		}

		// Check for subcommand
		if (this._subcommands.length > 0 && args.length > 0) {
			const subName = args[0];
			const sub = this._subcommands.find(
				(s) => s._name === subName || s._aliases.includes(subName),
			);
			if (sub) {
				const subCtx: CommandContext = {
					...ctx,
					args: args.slice(1),
				};
				return sub.execute(subCtx);
			}
		}

		// No action and has subcommands → show help
		if (!this._action && this._subcommands.length > 0) {
			ctx.stdout.write(this.helpText());
			return 0;
		}

		if (!this._action) {
			ctx.stderr.writeln(`${this._name}: no action defined`);
			return 1;
		}

		// Parse arguments
		let parsed: ParsedArgs;
		try {
			parsed = this.parseArgs(args);
		} catch (e) {
			ctx.stderr.writeln(`${this._name}: ${e instanceof Error ? e.message : String(e)}`);
			ctx.stderr.writeln(`Try '${this._name} --help' for usage.`);
			return 1;
		}

		// Run middleware
		for (const mw of this._middleware) {
			const result = await mw(ctx, parsed);
			if (typeof result === "number") return result;
		}

		return this._action(ctx, parsed);
	}

	// --- Arg parsing ---

	private ensureFlagMaps(): void {
		if (this._longMap) return;
		this._longMap = new Map();
		this._shortMap = new Map();
		for (const def of this._flags) {
			const key = flagKey(def.long);
			this._longMap.set(key, def);
			if (def.alias) {
				for (const a of def.alias) {
					this._longMap.set(a, def);
				}
			}
			if (def.short) {
				this._shortMap.set(def.short, def);
			}
		}
	}

	private parseArgs(raw: string[]): ParsedArgs {
		this.ensureFlagMaps();
		const flags: Record<string, string | boolean | number | string[]> = {};
		const positional: string[] = [];
		let i = 0;

		// Set defaults
		for (const def of this._flags) {
			const key = flagKey(def.long);
			if (def.multiple) {
				flags[key] = [];
			} else if (def.default !== undefined) {
				flags[key] = def.default;
			} else if (def.type === "boolean") {
				flags[key] = false;
			} else if (def.type === "count") {
				flags[key] = 0;
			}
		}

		// Parse
		let endOfFlags = false;
		while (i < raw.length) {
			const arg = raw[i];

			if (arg === "--") {
				endOfFlags = true;
				i++;
				continue;
			}

			if (endOfFlags || !arg.startsWith("-") || arg === "-") {
				positional.push(arg);
				if (this._stopAfterFirstPositional) endOfFlags = true;
				i++;
				continue;
			}

			// Long flag
			if (arg.startsWith("--")) {
				const eqIdx = arg.indexOf("=");
				const name = eqIdx >= 0 ? arg.slice(2, eqIdx) : arg.slice(2);
				const negated = name.startsWith("no-");
				const lookupName = negated ? name.slice(3) : name;

				const def = this._longMap?.get(lookupName);

				if (!def) {
					if (this._allowUnknown) {
						positional.push(arg);
						if (this._stopAfterFirstPositional) endOfFlags = true;
						i++;
						continue;
					}
					throw new Error(`unknown option: --${name}`);
				}

				const key = flagKey(def.long);

				if (def.type === "boolean") {
					flags[key] = !negated;
					i++;
				} else if (def.type === "count") {
					flags[key] = ((flags[key] as number) ?? 0) + 1;
					i++;
				} else {
					const value = eqIdx >= 0 ? arg.slice(eqIdx + 1) : raw[++i];
					if (value === undefined) {
						throw new Error(`option --${name} requires a value`);
					}
					if (def.choices && !def.choices.includes(value)) {
						throw new Error(
							`invalid value '${value}' for --${name}. Choices: ${def.choices.join(", ")}`,
						);
					}
					if (def.type === "number") {
						const num = Number(value);
						if (Number.isNaN(num)) {
							throw new Error(`option --${name} expects a number, got '${value}'`);
						}
						flags[key] = num;
					} else if (def.multiple) {
						(flags[key] as string[]).push(value);
					} else {
						flags[key] = value;
					}
					i++;
				}
				continue;
			}

			// Short flags (can be combined: -abc)
			const shorts = arg.slice(1);
			let unknownShort = false;
			for (let j = 0; j < shorts.length; j++) {
				const ch = shorts[j];
				const def = this._shortMap?.get(ch);

				if (!def) {
					if (this._allowUnknown) {
						// Treat the entire original arg as positional
						positional.push(arg);
						if (this._stopAfterFirstPositional) endOfFlags = true;
						unknownShort = true;
						break;
					}
					throw new Error(`unknown option: -${ch}`);
				}

				const key = flagKey(def.long);

				if (def.type === "boolean") {
					flags[key] = true;
				} else if (def.type === "count") {
					flags[key] = ((flags[key] as number) ?? 0) + 1;
				} else {
					// Takes a value — rest of shorts or next arg
					const value = j + 1 < shorts.length ? shorts.slice(j + 1) : raw[++i];
					if (value === undefined) {
						throw new Error(`option -${ch} requires a value`);
					}
					if (def.choices && !def.choices.includes(value)) {
						throw new Error(
							`invalid value '${value}' for -${ch}. Choices: ${def.choices.join(", ")}`,
						);
					}
					if (def.type === "number") {
						const num = Number(value);
						if (Number.isNaN(num)) {
							throw new Error(`option -${ch} expects a number, got '${value}'`);
						}
						flags[key] = num;
					} else if (def.multiple) {
						(flags[key] as string[]).push(value);
					} else {
						flags[key] = value;
					}
					break; // consumed rest of shorts
				}
			}
			if (!unknownShort) i++;
			else i++;
		}

		// Validate required flags
		for (const def of this._flags) {
			if (def.required && flags[flagKey(def.long)] === undefined) {
				throw new Error(`required option --${flagKey(def.long)} is missing`);
			}
		}

		// Validate required positional args
		for (let a = 0; a < this._args.length; a++) {
			const argDef = this._args[a];
			if (argDef.required && positional[a] === undefined && argDef.default === undefined) {
				throw new Error(`missing required argument: <${argDef.name}>`);
			}
			if (argDef.choices && positional[a] && !argDef.choices.includes(positional[a])) {
				throw new Error(
					`invalid value '${positional[a]}' for <${argDef.name}>. Choices: ${argDef.choices.join(", ")}`,
				);
			}
		}

		// Apply defaults for missing positional args
		for (let a = 0; a < this._args.length; a++) {
			if (positional[a] === undefined && this._args[a].default !== undefined) {
				positional[a] = this._args[a].default!;
			}
		}

		return { args: positional, flags, raw };
	}

	// --- Help text ---

	helpText(): string {
		const lines: string[] = [];

		// Usage line
		let usage = `Usage: ${this.fullName()}`;
		if (this._flags.length > 0) usage += " [options]";
		if (this._subcommands.length > 0) usage += " <command>";
		for (const arg of this._args) {
			usage += arg.required ? ` <${arg.name}>` : ` [${arg.name}]`;
			if (arg.variadic) usage += "...";
		}
		lines.push(usage);

		if (this._description) {
			lines.push("");
			lines.push(this._description);
		}

		// Arguments
		if (this._args.length > 0) {
			lines.push("");
			lines.push("Arguments:");
			const maxLen = Math.max(...this._args.map((a) => a.name.length));
			for (const arg of this._args) {
				let line = `  ${arg.name.padEnd(maxLen + 2)}${arg.description}`;
				if (arg.default) line += ` (default: ${arg.default})`;
				if (arg.choices) line += ` [choices: ${arg.choices.join(", ")}]`;
				lines.push(line);
			}
		}

		// Options
		if (this._flags.length > 0) {
			lines.push("");
			lines.push("Options:");
			const flagStrs = this._flags.map((f) => formatFlagHelp(f));
			const maxLen = Math.max(...flagStrs.map((s) => s.length));
			for (let j = 0; j < this._flags.length; j++) {
				let line = `  ${flagStrs[j].padEnd(maxLen + 2)}${this._flags[j].description}`;
				if (this._flags[j].default !== undefined && this._flags[j].default !== false) {
					line += ` (default: ${this._flags[j].default})`;
				}
				if (this._flags[j].choices) {
					line += ` [${this._flags[j].choices?.join(", ")}]`;
				}
				lines.push(line);
			}
			lines.push(`  ${"-h, --help".padEnd(maxLen + 2)}Show this help`);
		}

		// Subcommands
		const visibleSubs = this._subcommands.filter((s) => !s._hidden);
		if (visibleSubs.length > 0) {
			lines.push("");
			lines.push("Commands:");
			const maxLen = Math.max(...visibleSubs.map((s) => s._name.length));
			for (const sub of visibleSubs) {
				const aliases = sub._aliases.length > 0 ? ` (${sub._aliases.join(", ")})` : "";
				lines.push(`  ${sub._name.padEnd(maxLen + 2)}${sub._description}${aliases}`);
			}
		}

		// Examples
		if (this._examples.length > 0) {
			lines.push("");
			lines.push("Examples:");
			for (const ex of this._examples) {
				lines.push(`  $ ${ex}`);
			}
		}

		lines.push("");
		return lines.join("\n");
	}

	private fullName(): string {
		const parts: string[] = [];
		let current: Command | null = this;
		while (current) {
			parts.unshift(current._name);
			current = current._parent;
		}
		return parts.join(" ");
	}
}

export type MiddlewareFn = (
	ctx: CommandContext,
	parsed: ParsedArgs,
) => undefined | number | Promise<undefined | number>;

/**
 * Create a new command builder.
 * ```
 * const handler = command("greet")
 *   .description("Greet someone")
 *   .argument("<name>", "Person to greet")
 *   .flag("-l, --loud", "Shout the greeting")
 *   .action((ctx, { args, flags }) => {
 *     const greeting = `Hello, ${args[0]}!`;
 *     ctx.stdout.writeln(flags.loud ? greeting.toUpperCase() : greeting);
 *     return 0;
 *   });
 *
 * shell.register(handler.toHandler());
 * ```
 */
export function command(name: string): Command {
	return new Command(name);
}

/**
 * Create a command group (parent with subcommands, no own action).
 * ```
 * const group = commandGroup("git", "Version control")
 *   .command("init", "Initialize repo")
 *   .action(...)
 *   .parent
 *   .command("commit", "Create commit")
 *   .action(...);
 * ```
 */
export function commandGroup(name: string, description?: string): Command {
	const cmd = new Command(name);
	if (description) cmd.description(description);
	return cmd;
}

// --- Internals ---

function parseFlags(input: string): { short?: string; long: string } {
	// Parse "-s, --long", "--long", "-s, --long <value>", etc.
	const clean = input.replace(/<[^>]+>|\[[^\]]+\]/g, "").trim();
	const parts = clean.split(",").map((p) => p.trim());

	let short: string | undefined;
	let long = "";

	for (const part of parts) {
		if (part.startsWith("--")) {
			long = part.slice(2);
		} else if (part.startsWith("-") && part.length === 2) {
			short = part[1];
		}
	}

	if (!long && short) {
		long = short;
	}

	return { short, long };
}

function flagKey(long: string): string {
	// Convert kebab-case to camelCase
	return long.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function formatFlagHelp(def: FlagDefinition): string {
	let str = "";
	if (def.short) str += `-${def.short}, `;
	str += `--${def.long}`;
	if (def.type === "string") str += ` <value>`;
	if (def.type === "number") str += ` <n>`;
	return str;
}
