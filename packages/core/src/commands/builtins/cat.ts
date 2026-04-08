import { command } from "../builder.js";

export const cat = command("cat")
	.description("Concatenate and print files")
	.flag("-n, --number", "Number all output lines")
	.flag("-b, --number-nonblank", "Number non-blank output lines")
	.flag("-s, --squeeze-blank", "Suppress repeated empty output lines")
	.flag("-E, --show-ends", "Display $ at end of each line")
	.flag("-T, --show-tabs", "Display TAB characters as ^I")
	.flag("-A, --show-all", "Equivalent to -ET")
	.argument("[files...]", "Files to concatenate")
	.action((ctx, { args, flags }) => {
		let numberLines = flags.number as boolean;
		const numberNonBlank = flags.numberNonblank as boolean;
		const squeezeBlank = flags.squeezeBlank as boolean;
		let showEnds = flags.showEnds as boolean;
		let showTabs = flags.showTabs as boolean;

		if (flags.showAll) {
			showEnds = true;
			showTabs = true;
		}

		if (numberNonBlank) {
			numberLines = false;
		}

		const inputs: string[] = [];
		let exitCode = 0;

		if (args.length === 0) {
			inputs.push(ctx.stdin);
		} else {
			for (const file of args) {
				if (file === "-") {
					inputs.push(ctx.stdin);
				} else {
					const resolved = ctx.resolve(file);
					try {
						inputs.push(ctx.fs.readFile(resolved));
					} catch {
						ctx.stderr.writeln(`cat: ${file}: No such file or directory`);
						exitCode = 1;
					}
				}
			}
		}

		const allContent = inputs.join("");
		let lines = allContent.split("\n");

		const hasTrailingNewline = allContent.endsWith("\n") && allContent.length > 0;
		if (hasTrailingNewline) {
			lines = lines.slice(0, -1);
		}

		let lineNum = 1;
		let prevBlank = false;

		for (let idx = 0; idx < lines.length; idx++) {
			let line = lines[idx];
			const isBlank = line === "";

			if (squeezeBlank && isBlank && prevBlank) {
				continue;
			}

			if (showTabs) {
				line = line.replace(/\t/g, "^I");
			}

			if (showEnds) {
				line = line + "$";
			}

			if (numberNonBlank) {
				if (!isBlank) {
					const num = String(lineNum).padStart(6, " ");
					line = `${num}\t${line}`;
					lineNum++;
				}
			} else if (numberLines) {
				const num = String(lineNum).padStart(6, " ");
				line = `${num}\t${line}`;
				lineNum++;
			}

			const isLast = idx === lines.length - 1;
			ctx.stdout.write(line + (isLast && !hasTrailingNewline ? "" : "\n"));
			prevBlank = isBlank;
		}

		return exitCode;
	})
	.toHandler();
