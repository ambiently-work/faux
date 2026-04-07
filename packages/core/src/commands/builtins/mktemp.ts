import { command } from "../builder.js";

export const mktemp = command("mktemp")
	.description("Create a temporary file or directory")
	.flag("-d", "Create a directory instead of a file")
	.flag("-t", "Interpret template relative to TMPDIR")
	.argument("[template]", "Template for the name", { default: "tmp.XXXXXXXXXX" })
	.action((ctx, { args, flags }) => {
		const isDir = !!flags.d;
		const useTemplate = !!flags.t;
		const template = args[0] || "tmp.XXXXXXXXXX";

		// Generate random suffix
		const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
		let name = "";
		for (let j = 0; j < template.length; j++) {
			if (template[j] === "X") {
				name += chars[Math.floor(Math.random() * chars.length)];
			} else {
				name += template[j];
			}
		}

		let path: string;
		if (useTemplate || !template.includes("/")) {
			const tmpDir = ctx.env.get("TMPDIR") ?? "/tmp";
			path = tmpDir + "/" + name;
		} else {
			path = ctx.resolve(name);
		}

		try {
			if (isDir) {
				ctx.fs.mkdir(path, { recursive: true });
			} else {
				// Ensure parent exists
				const parent = path.slice(0, path.lastIndexOf("/"));
				if (parent && !ctx.fs.exists(parent)) {
					ctx.fs.mkdir(parent, { recursive: true });
				}
				ctx.fs.writeFile(path, "");
			}
			ctx.stdout.writeln(path);
			return 0;
		} catch (e) {
			ctx.stderr.writeln(`mktemp: failed to create ${isDir ? "directory" : "file"}: ${path}`);
			return 1;
		}
	})
	.toHandler();
