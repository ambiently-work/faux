import { command } from "../builder.js";

export const hostname = command("hostname")
	.description("Show or set the system hostname")
	.flag("-s", "Show short hostname (up to first dot)")
	.flag("-f", "Show FQDN")
	.stopAfterFirstPositional()
	.action((ctx, { args, flags }) => {
		// If a positional arg is given, set the hostname
		if (args.length > 0) {
			ctx.env.set("HOSTNAME", args[0]);
			return 0;
		}

		const name = ctx.env.get("HOSTNAME") ?? "faux-shell";

		if (flags.s) {
			ctx.stdout.writeln(name.split(".")[0]);
		} else if (flags.f) {
			ctx.stdout.writeln(name.includes(".") ? name : `${name}.localdomain`);
		} else {
			ctx.stdout.writeln(name);
		}

		return 0;
	})
	.toHandler();
