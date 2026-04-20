import { command } from "../builder.js";

export const id = command("id")
	.description("Print user and group information")
	.flag("-u", "Print only the effective user ID")
	.flag("-g", "Print only the effective group ID")
	.flag("-G", "Print all group IDs")
	.flag("-n", "Print a name instead of a number (requires -u, -g, or -G)")
	.action((ctx, { flags }) => {
		const showUser = flags.u as boolean;
		const showGroup = flags.g as boolean;
		const showGroups = flags.G as boolean;
		const nameOnly = flags.n as boolean;

		const user = ctx.env.get("USER") ?? "root";
		const uid = user === "root" ? 0 : 1000;
		const gid = uid;
		const group = user === "root" ? "root" : user;

		if (showUser) {
			ctx.stdout.writeln(nameOnly ? user : String(uid));
		} else if (showGroup) {
			ctx.stdout.writeln(nameOnly ? group : String(gid));
		} else if (showGroups) {
			ctx.stdout.writeln(nameOnly ? group : String(gid));
		} else {
			ctx.stdout.writeln(`uid=${uid}(${user}) gid=${gid}(${group}) groups=${gid}(${group})`);
		}

		return 0;
	})
	.toHandler();

export const whoami = command("whoami")
	.description("Print the current user name")
	.action((ctx) => {
		ctx.stdout.writeln(ctx.env.get("USER") ?? "root");
		return 0;
	})
	.toHandler();
