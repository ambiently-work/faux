import type { OutputTransform } from "./hooks.js";

/**
 * Strip all ANSI escape codes (colors, cursor movement, etc.)
 */
export const stripAnsi: OutputTransform = (result) => ({
	...result,
	stdout: removeAnsiCodes(result.stdout),
	stderr: removeAnsiCodes(result.stderr),
});

/**
 * Collapse consecutive blank lines into a single blank line.
 */
export const compressBlankLines: OutputTransform = (result) => ({
	...result,
	stdout: collapseBlankLines(result.stdout),
	stderr: collapseBlankLines(result.stderr),
});

/**
 * Trim trailing whitespace from each line.
 */
export const trimTrailingWhitespace: OutputTransform = (result) => ({
	...result,
	stdout: trimLines(result.stdout),
	stderr: trimLines(result.stderr),
});

/**
 * Trim leading and trailing whitespace from the entire output.
 */
export const trimOutput: OutputTransform = (result) => ({
	...result,
	stdout: result.stdout.trim() ? `${result.stdout.trim()}\n` : "",
	stderr: result.stderr.trim() ? `${result.stderr.trim()}\n` : "",
});

/**
 * Truncate output to a maximum number of lines, appending a marker.
 */
export function truncateLines(maxLines: number, marker = "... (truncated)"): OutputTransform {
	return (result) => ({
		...result,
		stdout: truncate(result.stdout, maxLines, marker),
		stderr: truncate(result.stderr, maxLines, marker),
	});
}

/**
 * Truncate output to a maximum number of characters.
 */
export function truncateChars(maxChars: number, marker = "..."): OutputTransform {
	return (result) => ({
		...result,
		stdout:
			result.stdout.length > maxChars
				? `${result.stdout.slice(0, maxChars) + marker}\n`
				: result.stdout,
		stderr:
			result.stderr.length > maxChars
				? `${result.stderr.slice(0, maxChars) + marker}\n`
				: result.stderr,
	});
}

/**
 * Replace tab characters with spaces.
 */
export function tabsToSpaces(width = 4): OutputTransform {
	const spaces = " ".repeat(width);
	return (result) => ({
		...result,
		stdout: result.stdout.replace(/\t/g, spaces),
		stderr: result.stderr.replace(/\t/g, spaces),
	});
}

/**
 * Collapse multiple consecutive spaces into one (preserving leading indent).
 */
export const collapseSpaces: OutputTransform = (result) => ({
	...result,
	stdout: collapseInlineSpaces(result.stdout),
	stderr: collapseInlineSpaces(result.stderr),
});

/**
 * Remove empty stderr (when exitCode is 0, stderr is usually noise).
 */
export const suppressEmptyStderr: OutputTransform = (result) => ({
	...result,
	stderr: result.exitCode === 0 ? "" : result.stderr,
});

/**
 * Normalize line endings to \n (strip \r).
 */
export const normalizeLineEndings: OutputTransform = (result) => ({
	...result,
	stdout: result.stdout.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
	stderr: result.stderr.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
});

/**
 * Combined preset: strip ANSI, compress blanks, trim trailing whitespace,
 * normalize line endings. Good default for token-optimized output.
 */
export const tokenOptimized: OutputTransform = (result, command) => {
	let r = result;
	r = stripAnsi(r, command);
	r = normalizeLineEndings(r, command);
	r = compressBlankLines(r, command);
	r = trimTrailingWhitespace(r, command);
	r = suppressEmptyStderr(r, command);
	return r;
};

/**
 * Aggressive token optimization: everything in tokenOptimized plus
 * truncation and space collapsing. For LLM consumption.
 */
export function llmOptimized(maxLines = 200, maxChars = 8000): OutputTransform {
	const truncLines = truncateLines(maxLines);
	const truncCh = truncateChars(maxChars);
	return (result, command) => {
		let r = tokenOptimized(result, command);
		r = truncLines(r, command);
		r = truncCh(r, command);
		return r;
	};
}

// --- Internal helpers ---

function removeAnsiCodes(s: string): string {
	// Match all ANSI escape sequences:
	// ESC[ ... m (SGR), ESC[ ... H (cursor), ESC[ ... J (erase), etc.
	// Also ESC] ... BEL/ST (OSC), ESC( (character set)
	return s.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes
		/\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[>=<]|\x1b\[[?]?[0-9;]*[hl]/g,
		"",
	);
}

function collapseBlankLines(s: string): string {
	return s.replace(/\n{3,}/g, "\n\n");
}

function trimLines(s: string): string {
	return s
		.split("\n")
		.map((line) => line.replace(/\s+$/, ""))
		.join("\n");
}

function truncate(s: string, maxLines: number, marker: string): string {
	const lines = s.split("\n");
	if (lines.length <= maxLines) return s;
	return `${lines.slice(0, maxLines).join("\n")}\n${marker}\n`;
}

function collapseInlineSpaces(s: string): string {
	return s
		.split("\n")
		.map((line) => {
			// Preserve leading whitespace, collapse spaces in the rest
			const match = line.match(/^(\s*)(.*)/);
			if (!match) return line;
			const [, indent, rest] = match;
			return indent + rest.replace(/ {2,}/g, " ");
		})
		.join("\n");
}
