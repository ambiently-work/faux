import { command } from "../builder.js";

export const sort = command("sort")
	.description("Sort lines of text files")
	.flag("-r, --reverse", "Reverse the result of comparisons")
	.flag("-n, --numeric-sort", "Compare according to string numerical value")
	.flag("-u, --unique", "Output only unique lines")
	.flag("-f, --fold-case", "Fold lower case to upper case characters")
	.flag("-b, --ignore-leading-blanks", "Ignore leading blanks")
	.option("-k, --key <keydef>", "Sort via a key definition")
	.option("-t, --field-separator <sep>", "Use sep as field separator")
	.argument("[file...]", "Input files")
	.action((ctx, { args: files, flags }) => {
		const reverse = flags.reverse as boolean;
		const numeric = flags.numericSort as boolean;
		const unique = flags.unique as boolean;
		const foldCase = flags.foldCase as boolean;
		const ignoreLeadingBlanks = flags.ignoreLeadingBlanks as boolean;
		const keyField = (flags.key as string | undefined) ?? null;
		const separator = (flags.fieldSeparator as string | undefined) ?? null;

		let content: string;
		let hadError = false;
		if (files.length === 0) {
			content = ctx.stdin;
		} else {
			const parts: string[] = [];
			for (const file of files) {
				const resolved = ctx.resolve(file);
				try {
					parts.push(ctx.fs.readFile(resolved));
				} catch {
					ctx.stderr.writeln("sort: " + file + ": No such file or directory");
					hadError = true;
				}
			}
			content = parts.join("");
		}

		const hasTrailing = content.endsWith("\n") && content.length > 0;
		let lines = content.split("\n");
		if (hasTrailing && lines.length > 0 && lines[lines.length - 1] === "") {
			lines.pop();
		}

		// Parse key spec: e.g. "2", "2,3", "2.1,2.3"
		let keyStart = 0;
		let keyEnd = -1;
		if (keyField) {
			const kParts = keyField.split(",");
			keyStart = Number.parseInt(kParts[0].split(".")[0], 10) - 1;
			if (kParts.length > 1) {
				keyEnd = Number.parseInt(kParts[1].split(".")[0], 10) - 1;
			}
		}

		const getKey = (line: string): string => {
			if (keyField === null) {
				return ignoreLeadingBlanks ? line.trimStart() : line;
			}
			const sep = separator ?? /\s+/;
			const fields = line.split(sep);
			if (keyEnd >= 0) {
				return fields.slice(keyStart, keyEnd + 1).join(separator ?? " ");
			}
			return fields[keyStart] ?? "";
		};

		lines.sort((a, b) => {
			let ka = getKey(a);
			let kb = getKey(b);

			if (foldCase) {
				ka = ka.toLowerCase();
				kb = kb.toLowerCase();
			}

			if (ignoreLeadingBlanks) {
				ka = ka.trimStart();
				kb = kb.trimStart();
			}

			if (numeric) {
				const na = Number.parseFloat(ka) || 0;
				const nb = Number.parseFloat(kb) || 0;
				if (na !== nb) return na - nb;
				// Fall through to lexical if numeric values are equal
			}

			if (ka < kb) return -1;
			if (ka > kb) return 1;
			return 0;
		});

		if (reverse) {
			lines.reverse();
		}

		if (unique) {
			const seen = new Set<string>();
			const uniqueLines: string[] = [];
			for (const line of lines) {
				const key = foldCase ? getKey(line).toLowerCase() : getKey(line);
				if (!seen.has(key)) {
					seen.add(key);
					uniqueLines.push(line);
				}
			}
			lines = uniqueLines;
		}

		for (const line of lines) {
			ctx.stdout.writeln(line);
		}

		return hadError ? 1 : 0;
	})
	.toHandler();
