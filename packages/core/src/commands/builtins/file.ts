import { command } from "../builder.js";

export const file = command("file")
	.description("Determine file type")
	.argument("<files...>", "Files to examine")
	.allowUnknownFlags()
	.action((ctx, { args: files }) => {
		if (files.length === 0) {
			ctx.stderr.writeln("file: missing operand");
			return 1;
		}

		for (const f of files) {
			const resolved = ctx.resolve(f);
			try {
				const s = ctx.fs.lstat(resolved);
				if (s.isDirectory()) {
					ctx.stdout.writeln(`${f}: directory`);
					continue;
				}
				if (s.isSymlink()) {
					try {
						const target = ctx.fs.readlink(resolved);
						ctx.stdout.writeln(`${f}: symbolic link to ${target}`);
					} catch {
						ctx.stdout.writeln(`${f}: symbolic link`);
					}
					continue;
				}

				const content = ctx.fs.readFile(resolved);
				if (content.length === 0) {
					ctx.stdout.writeln(`${f}: empty`);
					continue;
				}

				// Check for shebang
				if (content.startsWith("#!")) {
					const firstLine = content.split("\n")[0];
					if (firstLine.includes("bash") || firstLine.includes("sh")) {
						ctx.stdout.writeln(`${f}: Bourne-Again shell script, ASCII text executable`);
					} else if (firstLine.includes("python")) {
						ctx.stdout.writeln(`${f}: Python script, ASCII text executable`);
					} else if (firstLine.includes("node") || firstLine.includes("bun")) {
						ctx.stdout.writeln(`${f}: JavaScript script, ASCII text executable`);
					} else {
						ctx.stdout.writeln(`${f}: script, ASCII text executable`);
					}
					continue;
				}

				// Check for JSON
				const trimmed = content.trimStart();
				if (
					(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
					(trimmed.startsWith("[") && trimmed.endsWith("]"))
				) {
					try {
						JSON.parse(content);
						ctx.stdout.writeln(`${f}: JSON data`);
						continue;
					} catch {
						// not valid JSON
					}
				}

				// Check for XML/HTML
				if (
					trimmed.startsWith("<?xml") ||
					trimmed.startsWith("<!DOCTYPE") ||
					trimmed.startsWith("<html")
				) {
					if (trimmed.startsWith("<?xml")) {
						ctx.stdout.writeln(`${f}: XML document, ASCII text`);
					} else {
						ctx.stdout.writeln(`${f}: HTML document, ASCII text`);
					}
					continue;
				}

				// Check binary-like content
				let nonPrintable = 0;
				const checkLen = Math.min(content.length, 512);
				for (let j = 0; j < checkLen; j++) {
					const code = content.charCodeAt(j);
					if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
						nonPrintable++;
					}
				}

				if (nonPrintable > checkLen * 0.1) {
					ctx.stdout.writeln(`${f}: data`);
				} else {
					ctx.stdout.writeln(`${f}: ASCII text`);
				}
			} catch {
				ctx.stderr.writeln(`file: cannot open '${f}' (No such file or directory)`);
			}
		}

		return 0;
	})
	.toHandler();
