import { command } from "../builder.js";

export const df = command("df")
	.description("Report file system disk space usage")
	.flag("-h, --human-readable", "Print sizes in human-readable format")
	.action((ctx, { flags }) => {
		const humanReadable = !!flags.humanReadable;

		ctx.stdout.writeln("Filesystem     1K-blocks     Used Available Use% Mounted on");

		if (humanReadable) {
			ctx.stdout.writeln("/dev/vda1          100G     2.1G      98G   3% /");
			ctx.stdout.writeln("tmpfs              512M       0B     512M   0% /tmp");
		} else {
			ctx.stdout.writeln("/dev/vda1      104857600  2202009 102655591   3% /");
			ctx.stdout.writeln("tmpfs             524288        0    524288   0% /tmp");
		}

		return 0;
	})
	.toHandler();
