#!/usr/bin/env bun
import { Biome } from "@biomejs/js-api/nodejs";
import { createBiomeCommand, Shell } from "faux-shell";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";

const shell = new Shell({
	env: {
		HOME: "/home/user",
		USER: "user",
		HOSTNAME: "faux-shell",
		TERM: "xterm-256color",
		PS1: "\\u@\\h:\\w\\$ ",
	},
	fs: {
		"/home/user/.bashrc": 'export PS1="\\u@\\h:\\w\\$ "\n',
		"/home/user/README.md":
			"# Welcome to faux-shell\n\nThis is a virtual shell running entirely in memory.\nNo real filesystem access — everything is simulated.\n\nTry: ls, cat README.md, echo hello | grep hell\n",
		"/home/user/examples/hello.sh":
			'#!/bin/bash\necho "Hello from faux-shell!"\nfor i in 1 2 3; do\n  echo "  count: $i"\ndone\n',
		"/home/user/examples/data.csv":
			"name,age,city\nalice,30,new york\nbob,25,san francisco\ncharlie,35,chicago\ndiana,28,seattle\neve,32,boston\n",
		"/etc/motd":
			"Welcome to faux-shell v0.1.0\nA virtual bash shell running in pure TypeScript.\nType 'help' for tips, 'exit' to quit.\n",
	},
	cwd: "/home/user",
});

// Register biome command (formatting, linting, LSP diagnostics)
shell.register(createBiomeCommand(new Biome()));

// Register a special 'help' command
shell.register({
	name: "help",
	execute(ctx) {
		ctx.stdout.writeln(`${BOLD}faux-shell${RESET} — virtual bash shell`);
		ctx.stdout.writeln("");
		ctx.stdout.writeln(`${CYAN}Navigation${RESET}`);
		ctx.stdout.writeln("  cd, ls, pwd, tree, find");
		ctx.stdout.writeln("");
		ctx.stdout.writeln(`${CYAN}Files${RESET}`);
		ctx.stdout.writeln("  cat, head, tail, touch, mkdir, cp, mv, rm");
		ctx.stdout.writeln("");
		ctx.stdout.writeln(`${CYAN}Text processing${RESET}`);
		ctx.stdout.writeln("  grep, sed, awk, sort, uniq, cut, tr, wc, rev, tac");
		ctx.stdout.writeln("");
		ctx.stdout.writeln(`${CYAN}Shell features${RESET}`);
		ctx.stdout.writeln("  Pipes (|), redirects (> >>), && || ;");
		ctx.stdout.writeln("  Variables ($VAR, ${VAR:-default})");
		ctx.stdout.writeln("  Control flow (if/for/while/case)");
		ctx.stdout.writeln("  Functions (name() { ... })");
		ctx.stdout.writeln("  Subshells ((...))");
		ctx.stdout.writeln("");
		ctx.stdout.writeln(`${CYAN}Misc${RESET}`);
		ctx.stdout.writeln("  echo, printf, date, seq, base64, expr, bc");
		ctx.stdout.writeln("");
		ctx.stdout.writeln(`${DIM}111 commands total. Type 'commands' to list all.${RESET}`);
		return 0;
	},
});

shell.register({
	name: "commands",
	execute(ctx) {
		const cmds = shell.commands.filter((c) => c !== "help" && c !== "commands");
		const cols = 8;
		const colWidth = 12;
		for (let i = 0; i < cmds.length; i += cols) {
			const row = cmds
				.slice(i, i + cols)
				.map((c) => c.padEnd(colWidth))
				.join("");
			ctx.stdout.writeln(row);
		}
		ctx.stdout.writeln(`\n${DIM}${cmds.length} commands available${RESET}`);
		return 0;
	},
});

function buildPrompt(): string {
	const user = shell.environment.get("USER") ?? "user";
	const host = shell.environment.get("HOSTNAME") ?? "faux-shell";
	const cwd = shell.environment.cwd;
	const home = shell.environment.get("HOME") ?? "/home/user";

	let displayCwd = cwd;
	if (cwd === home) {
		displayCwd = "~";
	} else if (cwd.startsWith(home + "/")) {
		displayCwd = "~" + cwd.slice(home.length);
	}

	const exitCode = shell.environment.lastExitCode;
	const indicator = exitCode === 0 ? `${GREEN}$${RESET}` : `${RED}$${RESET}`;

	return `${BOLD}${GREEN}${user}@${host}${RESET}:${BOLD}${BLUE}${displayCwd}${RESET}${indicator} `;
}

async function main() {
	const writer = Bun.stdout.writer();

	// Print MOTD
	writer.write(`\n${BOLD}${CYAN}  ╭─────────────────────────────────────╮${RESET}\n`);
	writer.write(
		`${BOLD}${CYAN}  │${RESET}  ${BOLD}faux-shell${RESET} v0.1.0                  ${BOLD}${CYAN}│${RESET}\n`,
	);
	writer.write(
		`${BOLD}${CYAN}  │${RESET}  ${DIM}Virtual bash · Pure TypeScript${RESET}      ${BOLD}${CYAN}│${RESET}\n`,
	);
	writer.write(
		`${BOLD}${CYAN}  │${RESET}  ${DIM}111 commands · In-memory VFS${RESET}        ${BOLD}${CYAN}│${RESET}\n`,
	);
	writer.write(`${BOLD}${CYAN}  ╰─────────────────────────────────────╯${RESET}\n\n`);
	writer.write(`${DIM}Type 'help' for tips, 'exit' or Ctrl+D to quit.${RESET}\n\n`);
	writer.flush();

	const reader = Bun.stdin.stream().getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let multilineBuffer = "";
	let inMultiline = false;

	writer.write(buildPrompt());
	writer.flush();

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			writer.write("\n");
			writer.flush();
			break;
		}

		buffer += decoder.decode(value, { stream: true });

		while (buffer.includes("\n")) {
			const newlineIdx = buffer.indexOf("\n");
			const line = buffer.slice(0, newlineIdx);
			buffer = buffer.slice(newlineIdx + 1);

			const input = inMultiline ? multilineBuffer + "\n" + line : line;

			// Check for continuation (trailing backslash or unclosed quotes/blocks)
			if (needsContinuation(input)) {
				inMultiline = true;
				multilineBuffer = input;
				writer.write(`${YELLOW}>${RESET} `);
				writer.flush();
				continue;
			}

			inMultiline = false;
			multilineBuffer = "";

			const trimmed = input.trim();
			if (trimmed === "") {
				writer.write(buildPrompt());
				writer.flush();
				continue;
			}

			if (trimmed === "exit" || trimmed.startsWith("exit ")) {
				const code = trimmed === "exit" ? 0 : Number.parseInt(trimmed.slice(5).trim(), 10) || 0;
				writer.write(`${DIM}bye${RESET}\n`);
				writer.flush();
				process.exit(code);
			}

			if (trimmed === "clear") {
				writer.write("\x1b[2J\x1b[H");
				writer.write(buildPrompt());
				writer.flush();
				continue;
			}

			const startTime = performance.now();
			const result = await shell.run(input);
			const elapsed = performance.now() - startTime;

			if (result.stdout) {
				writer.write(result.stdout);
			}
			if (result.stderr) {
				writer.write(`${RED}${result.stderr}${RESET}`);
			}

			// Show timing for slow commands (>100ms)
			if (elapsed > 100) {
				writer.write(`${DIM}(${elapsed.toFixed(0)}ms)${RESET}\n`);
			}

			writer.write(buildPrompt());
			writer.flush();
		}
	}
}

function needsContinuation(input: string): boolean {
	// Trailing backslash
	if (input.endsWith("\\")) return true;

	// Count unmatched quotes
	let singleQuotes = 0;
	let doubleQuotes = 0;
	let escaped = false;

	for (const ch of input) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (ch === "'" && doubleQuotes % 2 === 0) singleQuotes++;
		if (ch === '"' && singleQuotes % 2 === 0) doubleQuotes++;
	}

	if (singleQuotes % 2 !== 0) return true;
	if (doubleQuotes % 2 !== 0) return true;

	// Unclosed blocks — trailing then/do/else/elif without fi/done
	const trimmed = input.trim();
	if (
		trimmed.endsWith("then") ||
		trimmed.endsWith("do") ||
		trimmed.endsWith("else") ||
		trimmed.endsWith("{") ||
		trimmed.endsWith("|") ||
		trimmed.endsWith("&&") ||
		trimmed.endsWith("||")
	) {
		return true;
	}

	return false;
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
