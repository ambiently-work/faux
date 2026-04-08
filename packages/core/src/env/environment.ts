const DEFAULT_VARS: Record<string, string> = {
	HOME: "/root",
	PATH: "/usr/bin:/bin",
	PWD: "/",
	SHELL: "/bin/bash",
	USER: "root",
	HOSTNAME: "faux-shell",
	TERM: "xterm-256color",
	LANG: "en_US.UTF-8",
	SHLVL: "1",
	IFS: " \t\n",
};

export class Environment {
	private vars: Map<string, string>;
	private exported: Set<string>;
	private _cwd: string;
	private _lastExitCode: number;
	private _aliases: Map<string, string>;
	private _functions: Map<string, unknown>;
	private _positionalArgs: string[];
	private _shellName: string;
	private _options: Set<string>;
	private _pid: number;
	private _lastBgPid: number;
	private _readonly: Set<string>;
	private _startTime: number;

	constructor(initial?: Record<string, string>) {
		this.vars = new Map();
		this.exported = new Set();
		this._readonly = new Set();
		this._aliases = new Map();
		this._functions = new Map();
		this._positionalArgs = [];
		this._shellName = "faux-shell";
		this._options = new Set();
		this._lastExitCode = 0;
		this._pid = 1;
		this._lastBgPid = 0;
		this._startTime = Date.now();

		// Apply defaults first
		for (const [key, value] of Object.entries(DEFAULT_VARS)) {
			this.vars.set(key, value);
			this.exported.add(key);
		}

		// Apply user-provided overrides
		if (initial) {
			for (const [key, value] of Object.entries(initial)) {
				this.vars.set(key, value);
			}
		}

		this._cwd = this.vars.get("PWD") ?? "/";
	}

	get(name: string): string | undefined {
		return this.vars.get(name);
	}

	set(name: string, value: string): void {
		if (this._readonly.has(name)) {
			throw new Error(`${name}: readonly variable`);
		}
		this.vars.set(name, value);
		if (name === "PWD") {
			this._cwd = value;
		}
	}

	unset(name: string): void {
		if (this._readonly.has(name)) {
			throw new Error(`${name}: readonly variable`);
		}
		this.vars.delete(name);
		this.exported.delete(name);
	}

	export(name: string, value?: string): void {
		if (value !== undefined) {
			this.set(name, value);
		}
		this.exported.add(name);
	}

	isExported(name: string): boolean {
		return this.exported.has(name);
	}

	unexport(name: string): void {
		this.exported.delete(name);
	}

	markReadonly(name: string): void {
		this._readonly.add(name);
	}

	isReadonly(name: string): boolean {
		return this._readonly.has(name);
	}

	get cwd(): string {
		return this._cwd;
	}

	set cwd(path: string) {
		this._cwd = path;
		this.vars.set("PWD", path);
	}

	get lastExitCode(): number {
		return this._lastExitCode;
	}

	set lastExitCode(code: number) {
		this._lastExitCode = code;
	}

	get positionalArgs(): string[] {
		return this._positionalArgs;
	}

	set positionalArgs(args: string[]) {
		this._positionalArgs = args;
	}

	setAlias(name: string, value: string): void {
		this._aliases.set(name, value);
	}

	getAlias(name: string): string | undefined {
		return this._aliases.get(name);
	}

	removeAlias(name: string): void {
		this._aliases.delete(name);
	}

	aliases(): Map<string, string> {
		return new Map(this._aliases);
	}

	setFunction(name: string, body: unknown): void {
		this._functions.set(name, body);
	}

	getFunction(name: string): unknown | undefined {
		return this._functions.get(name);
	}

	removeFunction(name: string): void {
		this._functions.delete(name);
	}

	setOption(option: string): void {
		this._options.add(option);
	}

	unsetOption(option: string): void {
		this._options.delete(option);
	}

	hasOption(option: string): boolean {
		return this._options.has(option);
	}

	/**
	 * Create a child environment for subshells.
	 * Inherits exported variables, cwd, aliases, and options.
	 */
	fork(): Environment {
		const child = new Environment();
		child.vars = new Map(this.vars);
		child.exported = new Set(this.exported);

		child._cwd = this._cwd;
		child._lastExitCode = this._lastExitCode;
		child._shellName = this._shellName;
		child._options = new Set(this._options);
		child._aliases = new Map(this._aliases);
		child._positionalArgs = [...this._positionalArgs];
		child._pid = this._pid;
		child._lastBgPid = this._lastBgPid;
		child._readonly = new Set(this._readonly);
		child._startTime = this._startTime;

		// Increment SHLVL
		const shlvl = Number.parseInt(child.vars.get("SHLVL") ?? "1", 10);
		child.vars.set("SHLVL", String(shlvl + 1));

		return child;
	}

	/**
	 * Return all exported variables as a plain object.
	 */
	toObject(): Record<string, string> {
		const result: Record<string, string> = {};
		for (const name of this.exported) {
			const value = this.vars.get(name);
			if (value !== undefined) {
				result[name] = value;
			}
		}
		return result;
	}

	/**
	 * Return all variables (exported and non-exported).
	 * Returns the internal map directly for iteration — do not mutate.
	 */
	all(): ReadonlyMap<string, string> {
		return this.vars;
	}

	/**
	 * Resolve special shell variables: $?, $#, $@, $*, $0, $$, $!, $-, $RANDOM, etc.
	 */
	getSpecial(name: string): string | undefined {
		switch (name) {
			case "?":
				return String(this._lastExitCode);
			case "#":
				return String(this._positionalArgs.length);
			case "@":
				return this._positionalArgs.join(" ");
			case "*":
				return this._positionalArgs.join(this.vars.get("IFS")?.charAt(0) ?? " ");
			case "0":
				return this._shellName;
			case "$":
				return String(this._pid);
			case "!":
				return String(this._lastBgPid);
			case "-": {
				const flags: string[] = [];
				if (this._options.has("errexit")) flags.push("e");
				if (this._options.has("nounset")) flags.push("u");
				if (this._options.has("xtrace")) flags.push("x");
				if (this._options.has("verbose")) flags.push("v");
				if (this._options.has("pipefail")) flags.push("p");
				return flags.join("");
			}
			case "RANDOM":
				return String(Math.floor(Math.random() * 32768));
			case "LINENO":
				return "0";
			case "SECONDS":
				return String(Math.floor((Date.now() - this._startTime) / 1000));
			case "BASHPID":
				return String(this._pid);
			default: {
				// Positional args: $1, $2, etc.
				const num = Number.parseInt(name, 10);
				if (!Number.isNaN(num) && num >= 1 && num <= this._positionalArgs.length) {
					return this._positionalArgs[num - 1];
				}
				return undefined;
			}
		}
	}
}
