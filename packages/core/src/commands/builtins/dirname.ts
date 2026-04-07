import { command } from "../builder.js";

export const dirname = command("dirname")
	.description("Strip last component from file name")
	.flag("-z", "End each output line with NUL, not newline")
	.stopAfterFirstPositional()
	.action((ctx, { args, flags }) => {
		if (args.length === 0) {
			ctx.stderr.writeln("dirname: missing operand");
			return 1;
		}

		const zeroTerminated = flags.z as boolean;

		for (const p of args) {
			let result = p;
			// Remove trailing slashes
			while (result.length > 1 && result.endsWith("/")) {
				result = result.slice(0, -1);
			}
			const lastSlash = result.lastIndexOf("/");
			if (lastSlash < 0) {
				result = ".";
			} else if (lastSlash === 0) {
				result = "/";
			} else {
				result = result.slice(0, lastSlash);
				// Remove trailing slashes from result
				while (result.length > 1 && result.endsWith("/")) {
					result = result.slice(0, -1);
				}
			}

			if (zeroTerminated) {
				ctx.stdout.write(result + "\0");
			} else {
				ctx.stdout.writeln(result);
			}
		}

		return 0;
	})
	.toHandler();
