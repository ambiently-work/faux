import { command } from "../builder.js";

export const strings = command("strings")
	.description("Print the sequences of printable characters in files")
	.number("-n, --bytes <n>", "Print sequences of at least n characters", { default: 4 })
	.argument("[file...]", "Input files")
	.allowUnknownFlags()
	.action((ctx, { args, flags }) => {
		let minLength = flags.bytes as number;
		const files: string[] = [];

		// Separate bare -N patterns from file args
		for (const arg of args) {
			if (/^-\d+$/.test(arg)) {
				minLength = Number.parseInt(arg.slice(1), 10);
			} else {
				files.push(arg);
			}
		}

		const processContent = (content: string): void => {
			let current = "";
			for (let j = 0; j < content.length; j++) {
				const code = content.charCodeAt(j);
				if (code >= 32 && code < 127) {
					current += content[j];
				} else {
					if (current.length >= minLength) {
						ctx.stdout.writeln(current);
					}
					current = "";
				}
			}
			if (current.length >= minLength) {
				ctx.stdout.writeln(current);
			}
		};

		if (files.length === 0) {
			processContent(ctx.stdin);
		} else {
			for (const file of files) {
				try {
					processContent(ctx.fs.readFile(ctx.resolve(file)));
				} catch {
					ctx.stderr.writeln(`strings: ${file}: No such file or directory`);
					return 1;
				}
			}
		}

		return 0;
	})
	.toHandler();
