import { command } from "../builder.js";
import type { CommandContext } from "../types.js";

const LONG_OPTIONS: Record<string, string> = {
	errexit: "e",
	nounset: "u",
	xtrace: "x",
	verbose: "v",
	noclobber: "C",
	allexport: "a",
	braceexpand: "B",
	emacs: "",
	errtrace: "E",
	functrace: "T",
	hashall: "h",
	histexpand: "H",
	history: "",
	ignoreeof: "",
	keyword: "k",
	monitor: "m",
	noexec: "n",
	noglob: "f",
	nolog: "",
	notify: "b",
	onecmd: "t",
	physical: "P",
	pipefail: "",
	posix: "",
	privileged: "p",
	vi: "",
};

const SHORT_TO_LONG: Record<string, string> = {};
for (const [long, short] of Object.entries(LONG_OPTIONS)) {
	if (short) {
		SHORT_TO_LONG[short] = long;
	}
}

// `set` has very non-standard syntax (-o/+o, positional params via --)
// so we use allowUnknownFlags and handle parsing in the action
export const set = command("set")
	.description("Set or unset shell options and positional parameters")
	.allowUnknownFlags()
	.argument("[args...]", "Options or positional parameters")
	.action((ctx, { raw }) => {
		const args = raw;
		if (args.length === 0) {
			for (const [key, value] of ctx.env.all()) {
				ctx.stdout.writeln(`${key}=${quoteValue(value)}`);
			}
			return 0;
		}

		let i = 0;
		while (i < args.length) {
			const arg = args[i];

			if (arg === "--") {
				ctx.env.positionalArgs = args.slice(i + 1);
				return 0;
			}

			if (arg === "-o" || arg === "+o") {
				const enabling = arg === "-o";
				i++;
				if (i >= args.length) {
					for (const name of Object.keys(LONG_OPTIONS)) {
						const isSet = ctx.env.hasOption(name);
						if (enabling) {
							ctx.stdout.writeln(`${name.padEnd(20)}${isSet ? "on" : "off"}`);
						} else {
							ctx.stdout.writeln(`set ${isSet ? "-o" : "+o"} ${name}`);
						}
					}
					return 0;
				}
				const optName = args[i];
				if (!(optName in LONG_OPTIONS)) {
					ctx.stderr.writeln(`set: invalid option name: ${optName}`);
					return 1;
				}
				if (enabling) {
					ctx.env.setOption(optName);
				} else {
					ctx.env.unsetOption(optName);
				}
				i++;
				continue;
			}

			if ((arg.startsWith("-") || arg.startsWith("+")) && arg.length > 1) {
				const enabling = arg[0] === "-";
				for (let j = 1; j < arg.length; j++) {
					const ch = arg[j];
					const longName = SHORT_TO_LONG[ch];
					if (longName) {
						if (enabling) {
							ctx.env.setOption(longName);
						} else {
							ctx.env.unsetOption(longName);
						}
					} else {
						ctx.stderr.writeln(`set: invalid option: -${ch}`);
						return 1;
					}
				}
				i++;
				continue;
			}

			ctx.env.positionalArgs = args.slice(i);
			return 0;
		}

		return 0;
	})
	.toHandler();

const SHOPT_OPTIONS = [
	"autocd",
	"cdable_vars",
	"cdspell",
	"checkhash",
	"checkjobs",
	"checkwinsize",
	"cmdhist",
	"compat31",
	"compat32",
	"compat40",
	"compat41",
	"compat42",
	"compat43",
	"complete_fullquote",
	"direxpand",
	"dirspell",
	"dotglob",
	"execfail",
	"expand_aliases",
	"extdebug",
	"extglob",
	"extquote",
	"failglob",
	"force_fignore",
	"globasciiranges",
	"globstar",
	"gnu_errfmt",
	"histappend",
	"histreedit",
	"histverify",
	"hostcomplete",
	"huponexit",
	"inherit_errexit",
	"interactive_comments",
	"lastpipe",
	"lithist",
	"login_shell",
	"mailwarn",
	"no_empty_cmd_completion",
	"nocaseglob",
	"nocasematch",
	"nullglob",
	"progcomp",
	"promptvars",
	"restricted_shell",
	"shift_verbose",
	"sourcepath",
	"xpg_echo",
];

export const shopt = command("shopt")
	.description("Set and unset shell options")
	.flag("-s, --set", "Enable options")
	.flag("-u, --unset", "Disable options")
	.flag("-q, --query", "Query option status silently")
	.flag("-p, --print", "Print option status")
	.allowUnknownFlags()
	.argument("[options...]", "Shell option names")
	.action((ctx, { args, flags }) => {
		let mode: "set" | "unset" | "print" | "query" = "print";
		if (flags.set) mode = "set";
		else if (flags.unset) mode = "unset";
		else if (flags.query) mode = "query";

		const optionsToProcess = args.length > 0 ? args : SHOPT_OPTIONS;

		if (mode === "set") {
			for (const name of optionsToProcess) {
				if (!SHOPT_OPTIONS.includes(name)) {
					ctx.stderr.writeln(`shopt: invalid shell option name: ${name}`);
					return 1;
				}
				ctx.env.setOption(`shopt_${name}`);
			}
			return 0;
		}

		if (mode === "unset") {
			for (const name of optionsToProcess) {
				if (!SHOPT_OPTIONS.includes(name)) {
					ctx.stderr.writeln(`shopt: invalid shell option name: ${name}`);
					return 1;
				}
				ctx.env.unsetOption(`shopt_${name}`);
			}
			return 0;
		}

		if (mode === "query") {
			let allSet = true;
			for (const name of optionsToProcess) {
				if (!SHOPT_OPTIONS.includes(name)) {
					ctx.stderr.writeln(`shopt: invalid shell option name: ${name}`);
					return 1;
				}
				if (!ctx.env.hasOption(`shopt_${name}`)) {
					allSet = false;
				}
			}
			return allSet ? 0 : 1;
		}

		// print mode
		for (const name of optionsToProcess) {
			if (!SHOPT_OPTIONS.includes(name)) {
				ctx.stderr.writeln(`shopt: invalid shell option name: ${name}`);
				return 1;
			}
			const isSet = ctx.env.hasOption(`shopt_${name}`);
			ctx.stdout.writeln(`${name.padEnd(30)}${isSet ? "on" : "off"}`);
		}
		return 0;
	})
	.toHandler();

function quoteValue(value: string): string {
	if (/^[a-zA-Z0-9_/.:@=+-]+$/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, "'\\''")}'`;
}
