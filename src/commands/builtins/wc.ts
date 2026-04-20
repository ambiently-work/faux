import { command } from "../builder.js";

export const wc = command("wc")
	.description("Print newline, word, and byte counts for each file")
	.flag("-l, --lines", "Print the newline counts")
	.flag("-w, --words", "Print the word counts")
	.flag("-c, --bytes", "Print the byte counts")
	.flag("-m, --chars", "Print the character counts")
	.argument("[file...]", "Input files")
	.action((ctx, { args: files, flags }) => {
		let showLines = flags.lines as boolean;
		let showWords = flags.words as boolean;
		let showBytes = flags.bytes as boolean;
		const showChars = flags.chars as boolean;

		// Default: show all three
		const showDefault = !showLines && !showWords && !showChars && !showBytes;
		if (showDefault) {
			showLines = true;
			showWords = true;
			showBytes = true;
		}

		const count = (content: string) => {
			// wc -l counts newline characters, not text lines
			let lines = 0;
			for (let j = 0; j < content.length; j++) {
				if (content[j] === "\n") lines++;
			}
			const words = content.trim() === "" ? 0 : content.trim().split(/\s+/).length;
			const chars = content.length;
			return { lines, words, chars };
		};

		const formatResult = (
			c: { lines: number; words: number; chars: number },
			name: string | null,
		): string => {
			const parts: string[] = [];
			if (showLines) parts.push(String(c.lines).padStart(7, " "));
			if (showWords) parts.push(String(c.words).padStart(7, " "));
			if (showBytes || showChars) parts.push(String(c.chars).padStart(7, " "));
			if (name !== null) parts.push(` ${name}`);
			return parts.join("");
		};

		if (files.length === 0) {
			const c = count(ctx.stdin);
			ctx.stdout.writeln(formatResult(c, null));
		} else {
			let totalLines = 0;
			let totalWords = 0;
			let totalChars = 0;
			let exitCode = 0;

			for (const file of files) {
				const resolved = ctx.resolve(file);
				try {
					const content = ctx.fs.readFile(resolved);
					const c = count(content);
					totalLines += c.lines;
					totalWords += c.words;
					totalChars += c.chars;
					ctx.stdout.writeln(formatResult(c, file));
				} catch {
					ctx.stderr.writeln(`wc: ${file}: No such file or directory`);
					exitCode = 1;
				}
			}

			if (files.length > 1) {
				ctx.stdout.writeln(
					formatResult({ lines: totalLines, words: totalWords, chars: totalChars }, "total"),
				);
			}

			return exitCode;
		}

		return 0;
	})
	.toHandler();
