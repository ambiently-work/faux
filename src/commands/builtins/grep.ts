import { command } from "../builder.js";
import type { CommandContext } from "../types.js";

interface GrepFlags {
	caseInsensitive: boolean;
	invert: boolean;
	count: boolean;
	lineNumbers: boolean;
	filesOnly: boolean;
	recursive: boolean;
	extendedRegex: boolean;
	fixedString: boolean;
	wholeWord: boolean;
	wholeLine: boolean;
	quiet: boolean;
	onlyMatching: boolean;
	withFilename: boolean;
	noFilename: boolean;
}

function buildRegex(pattern: string, flags: GrepFlags): RegExp {
	let p = pattern;

	if (flags.fixedString) {
		p = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	if (flags.wholeWord) {
		p = `\\b${p}\\b`;
	}

	if (flags.wholeLine) {
		p = `^${p}$`;
	}

	const regexFlags = flags.caseInsensitive ? "gi" : "g";
	return new RegExp(p, regexFlags);
}

function grepContent(
	ctx: CommandContext,
	content: string,
	regex: RegExp,
	flags: GrepFlags,
	filename: string | null,
): { matched: boolean; matchCount: number } {
	const lines = content.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "" && content.endsWith("\n")) {
		lines.pop();
	}

	let matchCount = 0;
	const showFile = filename !== null && !flags.noFilename;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		regex.lastIndex = 0;
		const matches = regex.test(line);
		const hit = flags.invert ? !matches : matches;

		if (hit) {
			matchCount++;

			if (flags.quiet) continue;
			if (flags.filesOnly) continue;
			if (flags.count) continue;

			if (flags.onlyMatching && !flags.invert) {
				regex.lastIndex = 0;
				let m: RegExpExecArray | null;
				while ((m = regex.exec(line)) !== null) {
					const parts: string[] = [];
					if (showFile) parts.push(`${filename}:`);
					if (flags.lineNumbers) parts.push(`${String(i + 1)}:`);
					parts.push(m[0]);
					ctx.stdout.writeln(parts.join(""));
					if (!regex.global) break;
				}
			} else {
				const parts: string[] = [];
				if (showFile) parts.push(`${filename}:`);
				if (flags.lineNumbers) parts.push(`${String(i + 1)}:`);
				parts.push(line);
				ctx.stdout.writeln(parts.join(""));
			}
		}
	}

	if (flags.count && !flags.quiet) {
		if (showFile) {
			ctx.stdout.writeln(`${filename}:${String(matchCount)}`);
		} else {
			ctx.stdout.writeln(String(matchCount));
		}
	}

	if (flags.filesOnly && matchCount > 0 && !flags.quiet) {
		if (filename !== null) {
			ctx.stdout.writeln(filename);
		}
	}

	return { matched: matchCount > 0, matchCount };
}

function grepRecursive(
	ctx: CommandContext,
	dirPath: string,
	regex: RegExp,
	flags: GrepFlags,
): boolean {
	let anyMatch = false;
	let entries: string[];
	try {
		entries = ctx.fs.readDir(dirPath);
	} catch {
		return false;
	}

	for (const entry of entries) {
		const fullPath = dirPath === "/" ? `/${entry}` : `${dirPath}/${entry}`;
		try {
			const st = ctx.fs.stat(fullPath);
			if (st.isDirectory()) {
				if (grepRecursive(ctx, fullPath, regex, flags)) {
					anyMatch = true;
				}
			} else if (st.isFile()) {
				const content = ctx.fs.readFile(fullPath);
				regex.lastIndex = 0;
				const result = grepContent(ctx, content, regex, flags, fullPath);
				if (result.matched) anyMatch = true;
			}
		} catch {
			// skip inaccessible
		}
	}

	return anyMatch;
}

export const grep = command("grep")
	.description("Search for patterns in files")
	.flag("-i, --case-insensitive", "Ignore case distinctions")
	.flag("-v, --invert", "Invert match")
	.flag("-c, --count", "Print only a count of matching lines")
	.flag("-n, --line-numbers", "Prefix each line with line number")
	.flag("-l, --files-only", "Print only names of files with matches")
	.flag("-r, --recursive", "Read all files under each directory recursively")
	.flag("-R, --recursive-alt", "Read all files under each directory recursively")
	.flag("-E, --extended-regex", "Use extended regular expressions")
	.flag("-F, --fixed-string", "Interpret pattern as fixed string")
	.flag("-w, --whole-word", "Match only whole words")
	.flag("-x, --whole-line", "Match only whole lines")
	.flag("-q, --quiet", "Suppress all normal output")
	.flag("-o, --only-matching", "Show only the matching part of lines")
	.flag("-H, --with-filename", "Print the filename for each match")
	.flag("-h, --no-filename", "Suppress the filename prefix")
	.stopAfterFirstPositional()
	.action((ctx, { args: operands, flags: f }) => {
		const gFlags: GrepFlags = {
			caseInsensitive: f.caseInsensitive as boolean,
			invert: f.invert as boolean,
			count: f.count as boolean,
			lineNumbers: f.lineNumbers as boolean,
			filesOnly: f.filesOnly as boolean,
			recursive: (f.recursive as boolean) || (f.recursiveAlt as boolean),
			extendedRegex: f.extendedRegex as boolean,
			fixedString: f.fixedString as boolean,
			wholeWord: f.wholeWord as boolean,
			wholeLine: f.wholeLine as boolean,
			quiet: f.quiet as boolean,
			onlyMatching: f.onlyMatching as boolean,
			withFilename: f.withFilename as boolean,
			noFilename: f.noFilename as boolean,
		};

		if (operands.length === 0) {
			ctx.stderr.writeln("grep: missing pattern");
			return 2;
		}

		const pattern = operands[0];
		const files = operands.slice(1);

		let regex: RegExp;
		try {
			regex = buildRegex(pattern, gFlags);
		} catch {
			ctx.stderr.writeln(`grep: Invalid regular expression: '${pattern}'`);
			return 2;
		}

		const multiFile = files.length > 1 || gFlags.recursive;
		if (multiFile && !gFlags.noFilename) {
			gFlags.withFilename = true;
		}
		if (gFlags.withFilename) {
			gFlags.noFilename = false;
		}

		let anyMatch = false;

		if (files.length === 0) {
			gFlags.noFilename = true;
			const result = grepContent(ctx, ctx.stdin, regex, gFlags, null);
			anyMatch = result.matched;
		} else {
			for (const file of files) {
				const resolved = ctx.resolve(file);
				try {
					const st = ctx.fs.stat(resolved);
					if (st.isDirectory()) {
						if (gFlags.recursive) {
							if (grepRecursive(ctx, resolved, regex, gFlags)) {
								anyMatch = true;
							}
						} else {
							ctx.stderr.writeln(`grep: ${file}: Is a directory`);
						}
						continue;
					}

					const content = ctx.fs.readFile(resolved);
					regex.lastIndex = 0;
					const displayName = multiFile || gFlags.withFilename ? file : null;
					const result = grepContent(ctx, content, regex, gFlags, displayName);
					if (result.matched) anyMatch = true;
				} catch {
					ctx.stderr.writeln(`grep: ${file}: No such file or directory`);
				}
			}
		}

		return anyMatch ? 0 : 1;
	})
	.toHandler();
