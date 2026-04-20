#!/usr/bin/env bun
import { Shell } from "../src/index.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";

const shell = new Shell({
	wasm: true,
	user: "demo",
	fs: {
		"/home/demo/README.md": "# faux-shell WASM demo\nRunning the engine in Rust via WebAssembly.\n",
		"/home/demo/data.csv":
			"name,age,city\nalice,30,new york\nbob,25,san francisco\ncharlie,35,chicago\ndiana,28,seattle\neve,32,boston\n",
		"/home/demo/hello.sh":
			'#!/bin/bash\necho "Hello from WASM engine!"\nfor i in 1 2 3; do\n  echo "  count: $i"\ndone\n',
	},
	cwd: "/home/demo",
});

const commands = [
	// Basic commands
	"echo 'Hello from the WASM engine!'",
	"pwd",
	"ls",

	// Variable expansion
	'echo "User: $USER, Home: $HOME"',

	// Pipes
	"cat data.csv | head -3",
	"cat data.csv | grep alice",
	"echo one two three | tr ' ' '\\n' | sort",

	// Redirects
	"echo 'new file content' > /tmp/test.txt",
	"cat /tmp/test.txt",

	// Control flow
	'for i in a b c; do echo "item: $i"; done',
	"if true; then echo 'condition passed'; fi",

	// Arithmetic
	"echo $((21 * 2))",
	"echo $((2 ** 10))",

	// Variable operations
	"X=hello; echo ${X^^}",
	"Y=faux-shell; echo ${Y%-*}",

	// Nested command substitution
	'echo "Files: $(ls | wc -l)"',

	// Brace expansion
	"echo file.{txt,md,rs}",

	// Complex pipeline
	"cat data.csv | tail -n +2 | sort -t, -k2 -n | head -3",

	// While loop
	'i=1; while [ $i -le 3 ]; do echo "loop $i"; i=$(($i + 1)); done',

	// Case statement
	"lang=rust; case $lang in rust) echo 'fast!';; python) echo 'easy!';; esac",

	// Functions
	'greet() { echo "Hello, $1!"; }; greet World',
];

console.log(`${BOLD}${CYAN}faux-shell WASM engine demo${RESET}`);
console.log(`${DIM}Running ${commands.length} commands through the Rust/WASM core${RESET}\n`);

const t0 = performance.now();

for (const cmd of commands) {
	console.log(`${GREEN}$ ${cmd}${RESET}`);
	const result = await shell.run(cmd);
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(`${DIM}${result.stderr}${RESET}`);
	if (result.exitCode !== 0) {
		console.log(`${DIM}(exit ${result.exitCode})${RESET}`);
	}
}

const elapsed = (performance.now() - t0).toFixed(1);
console.log(`\n${DIM}Completed in ${elapsed}ms${RESET}`);
