import { command } from "../builder.js";

const getoptsHandler = command("getopts")
	.description("Parse positional parameters")
	.allowUnknownFlags()
	.argument("[args...]", "optstring name [arg ...]")
	.action((ctx, { raw }) => {
		if (raw.length < 2) {
			ctx.stderr.writeln("getopts: usage: getopts optstring name [arg ...]");
			return 2;
		}

		const optstring = raw[0];
		const name = raw[1];
		const args = raw.length > 2 ? raw.slice(2) : ctx.env.positionalArgs;

		// OPTIND is 1-based, tracks which arg we're processing
		let optind = Number.parseInt(ctx.env.get("OPTIND") ?? "1", 10);
		if (Number.isNaN(optind) || optind < 1) {
			optind = 1;
		}

		const argIdx = optind - 1;

		if (argIdx >= args.length) {
			ctx.env.set(name, "?");
			return 1;
		}

		const current = args[argIdx];

		if (!current.startsWith("-") || current === "-" || current === "--") {
			ctx.env.set(name, "?");
			if (current === "--") {
				ctx.env.set("OPTIND", String(optind + 1));
			}
			return 1;
		}

		// Get current char position within the option group
		let charIdx = Number.parseInt(ctx.env.get("_GETOPTS_CHARPOS") ?? "1", 10);
		if (Number.isNaN(charIdx) || charIdx < 1) {
			charIdx = 1;
		}

		if (charIdx >= current.length) {
			// Move to next arg
			optind++;
			charIdx = 1;
			ctx.env.set("OPTIND", String(optind));
			ctx.env.set("_GETOPTS_CHARPOS", "1");
			// Recurse
			return getoptsHandler.execute(ctx);
		}

		const optChar = current[charIdx];
		const optIdx = optstring.indexOf(optChar);

		if (optIdx === -1) {
			// Unknown option
			ctx.env.set(name, "?");
			ctx.env.set("OPTARG", optChar);

			if (charIdx + 1 >= current.length) {
				ctx.env.set("OPTIND", String(optind + 1));
				ctx.env.set("_GETOPTS_CHARPOS", "1");
			} else {
				ctx.env.set("_GETOPTS_CHARPOS", String(charIdx + 1));
			}

			if (optstring[0] !== ":") {
				ctx.stderr.writeln(`${ctx.env.get("0") ?? "shell"}: illegal option -- ${optChar}`);
			}

			return 0;
		}

		// Check if option requires an argument
		const needsArg = optIdx + 1 < optstring.length && optstring[optIdx + 1] === ":";

		if (needsArg) {
			// Rest of current arg is the argument, or next arg
			if (charIdx + 1 < current.length) {
				ctx.env.set("OPTARG", current.slice(charIdx + 1));
				ctx.env.set("OPTIND", String(optind + 1));
				ctx.env.set("_GETOPTS_CHARPOS", "1");
			} else if (optind < args.length) {
				ctx.env.set("OPTARG", args[optind]);
				ctx.env.set("OPTIND", String(optind + 2));
				ctx.env.set("_GETOPTS_CHARPOS", "1");
			} else {
				// Missing argument
				ctx.env.set("OPTIND", String(optind + 1));
				ctx.env.set("_GETOPTS_CHARPOS", "1");
				if (optstring[0] === ":") {
					ctx.env.set(name, ":");
					ctx.env.set("OPTARG", optChar);
				} else {
					ctx.env.set(name, "?");
					ctx.stderr.writeln(
						`${ctx.env.get("0") ?? "shell"}: option requires an argument -- ${optChar}`,
					);
				}
				return 0;
			}

			ctx.env.set(name, optChar);
			return 0;
		}

		// No argument needed
		ctx.env.set(name, optChar);
		ctx.env.unset("OPTARG");

		if (charIdx + 1 >= current.length) {
			ctx.env.set("OPTIND", String(optind + 1));
			ctx.env.set("_GETOPTS_CHARPOS", "1");
		} else {
			ctx.env.set("_GETOPTS_CHARPOS", String(charIdx + 1));
		}

		return 0;
	})
	.toHandler();

export const getopts = getoptsHandler;
