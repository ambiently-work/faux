import { command } from "../builder.js";

export const basename = command("basename")
	.description("Strip directory and suffix from filenames")
	.flag("-a", "Support multiple arguments")
	.flag("-z", "End each output line with NUL, not newline")
	.option("-s, --suffix <suffix>", "Remove trailing suffix")
	.stopAfterFirstPositional()
	.action((ctx, { args, flags }) => {
		const paths = [...args];

		if (paths.length === 0) {
			ctx.stderr.writeln("basename: missing operand");
			return 1;
		}

		let suffix = (flags.suffix as string | undefined) ?? null;

		// If exactly two args and no -s flag, second is suffix
		if (paths.length === 2 && suffix === null) {
			suffix = paths.pop() ?? "";
		}

		const zeroTerminated = flags.z as boolean;

		for (const p of paths) {
			let result = p;
			// Remove trailing slashes
			while (result.length > 1 && result.endsWith("/")) {
				result = result.slice(0, -1);
			}
			// Get last component
			const lastSlash = result.lastIndexOf("/");
			if (lastSlash >= 0) {
				result = result.slice(lastSlash + 1);
			}
			// Remove suffix
			if (suffix && result.endsWith(suffix) && result.length > suffix.length) {
				result = result.slice(0, -suffix.length);
			}

			if (zeroTerminated) {
				ctx.stdout.write(`${result}\0`);
			} else {
				ctx.stdout.writeln(result);
			}
		}

		return 0;
	})
	.toHandler();
