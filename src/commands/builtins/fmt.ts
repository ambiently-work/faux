import { command } from "../builder.js";

export const fmt = command("fmt")
	.description("Simple text formatter")
	.number("-w, --width <n>", "Maximum line width", { default: 75 })
	.argument("[file...]", "Input files")
	.action((ctx, { args: files, flags }) => {
		const width = flags.width as number;

		let content: string;
		if (files.length === 0) {
			content = ctx.stdin;
		} else {
			const parts: string[] = [];
			for (const file of files) {
				const resolved = ctx.resolve(file);
				try {
					parts.push(ctx.fs.readFile(resolved));
				} catch {
					ctx.stderr.writeln(`fmt: ${file}: No such file or directory`);
					return 1;
				}
			}
			content = parts.join("");
		}

		const hasTrailing = content.endsWith("\n") && content.length > 0;
		const lines = content.split("\n");
		if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
			lines.pop();
		}

		// Split into paragraphs (separated by blank lines)
		const paragraphs: string[][] = [];
		let currentPara: string[] = [];

		for (const line of lines) {
			if (line.trim() === "") {
				if (currentPara.length > 0) {
					paragraphs.push(currentPara);
					currentPara = [];
				}
				paragraphs.push([]); // blank line
			} else {
				currentPara.push(line);
			}
		}
		if (currentPara.length > 0) {
			paragraphs.push(currentPara);
		}

		for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
			const para = paragraphs[pIdx];
			if (para.length === 0) {
				ctx.stdout.writeln("");
				continue;
			}

			// Join all words
			const words = para
				.join(" ")
				.split(/\s+/)
				.filter((w) => w !== "");
			if (words.length === 0) {
				ctx.stdout.writeln("");
				continue;
			}

			let currentLine = words[0];
			for (let w = 1; w < words.length; w++) {
				if (currentLine.length + 1 + words[w].length <= width) {
					currentLine += ` ${words[w]}`;
				} else {
					ctx.stdout.writeln(currentLine);
					currentLine = words[w];
				}
			}
			if (currentLine.length > 0) {
				ctx.stdout.writeln(currentLine);
			}
		}

		return 0;
	})
	.toHandler();
