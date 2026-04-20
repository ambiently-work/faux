import { command } from "../builder.js";

export const uname = command("uname")
	.description("Print system information")
	.flag("-a, --all", "Print all information")
	.flag("-s, --kernel-name", "Print the kernel name")
	.flag("-n, --nodename", "Print the network node hostname")
	.flag("-r, --kernel-release", "Print the kernel release")
	.flag("-m, --machine", "Print the machine hardware name")
	.flag("-o, --operating-system", "Print the operating system")
	.action((ctx, { flags }) => {
		const sysName = "FauxOS";
		const nodeName = ctx.env.get("HOSTNAME") ?? "faux-shell";
		const release = "6.1.0-faux";
		const machine = "x86_64";
		const os = "GNU/Linux";

		if (flags.all) {
			ctx.stdout.writeln(`${sysName} ${nodeName} ${release} ${machine} ${os}`);
			return 0;
		}

		const showSys = flags.kernelName as boolean;
		const showNode = flags.nodename as boolean;
		const showRelease = flags.kernelRelease as boolean;
		const showMachine = flags.machine as boolean;
		const showOs = flags.operatingSystem as boolean;

		// Default to showing kernel name if no flags given
		if (!showSys && !showNode && !showRelease && !showMachine && !showOs) {
			ctx.stdout.writeln(sysName);
			return 0;
		}

		const parts: string[] = [];
		if (showSys) parts.push(sysName);
		if (showNode) parts.push(nodeName);
		if (showRelease) parts.push(release);
		if (showMachine) parts.push(machine);
		if (showOs) parts.push(os);

		ctx.stdout.writeln(parts.join(" "));
		return 0;
	})
	.toHandler();
