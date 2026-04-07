import { command } from "../builder.js";

export const test = command("test")
	.description("Evaluate conditional expression")
	.allowUnknownFlags()
	.argument("[expression...]", "Test expression")
	.action((ctx, { raw }) => {
		return evaluateTest(raw, ctx) ? 0 : 1;
	})
	.toHandler();

export const bracket = command("[")
	.description("Evaluate conditional expression (bracket form)")
	.allowUnknownFlags()
	.argument("[expression...]", "Test expression")
	.action((ctx, { raw }) => {
		const args = [...raw];
		if (args.length === 0 || args[args.length - 1] !== "]") {
			ctx.stderr.writeln("[: missing `]`");
			return 2;
		}
		args.pop();
		return evaluateTest(args, ctx) ? 0 : 1;
	})
	.toHandler();

export const doubleBracket = command("[[")
	.description("Evaluate conditional expression (double bracket form)")
	.allowUnknownFlags()
	.argument("[expression...]", "Test expression")
	.action((ctx, { raw }) => {
		const args = [...raw];
		if (args.length === 0 || args[args.length - 1] !== "]]") {
			ctx.stderr.writeln("[[: missing `]]`");
			return 2;
		}
		args.pop();
		return evaluateTest(args, ctx) ? 0 : 1;
	})
	.toHandler();

interface TestCtx {
	fs: {
		exists(p: string): boolean;
		stat(p: string): {
			isFile(): boolean;
			isDirectory(): boolean;
			isSymlink(): boolean;
			size: number;
			mode: number;
			mtime: number;
		};
	};
	resolve(path: string): string;
}

function evaluateTest(args: string[], ctx: TestCtx): boolean {
	if (args.length === 0) return false;
	if (args.length === 1) return args[0] !== "";

	return parseOr(args, { pos: 0 }, ctx);
}

interface Cursor {
	pos: number;
}

function parseOr(args: string[], cur: Cursor, ctx: TestCtx): boolean {
	let result = parseAnd(args, cur, ctx);
	while (cur.pos < args.length && args[cur.pos] === "-o") {
		cur.pos++;
		const right = parseAnd(args, cur, ctx);
		result = result || right;
	}
	return result;
}

function parseAnd(args: string[], cur: Cursor, ctx: TestCtx): boolean {
	let result = parsePrimary(args, cur, ctx);
	while (cur.pos < args.length && args[cur.pos] === "-a") {
		cur.pos++;
		const right = parsePrimary(args, cur, ctx);
		result = result && right;
	}
	return result;
}

function parsePrimary(args: string[], cur: Cursor, ctx: TestCtx): boolean {
	if (cur.pos >= args.length) return false;

	if (args[cur.pos] === "!") {
		cur.pos++;
		return !parsePrimary(args, cur, ctx);
	}

	if (args[cur.pos] === "(") {
		cur.pos++;
		const result = parseOr(args, cur, ctx);
		if (cur.pos < args.length && args[cur.pos] === ")") {
			cur.pos++;
		}
		return result;
	}

	// Unary operators
	if (args[cur.pos].startsWith("-") && args[cur.pos].length === 2 && cur.pos + 1 < args.length) {
		const op = args[cur.pos];
		const operand = args[cur.pos + 1];

		// Check if next token could be a binary operator instead
		if (cur.pos + 2 < args.length && isBinaryOp(args[cur.pos + 1])) {
			// This is not a unary expression; treat as binary
		} else {
			const unaryResult = evalUnary(op, operand, ctx);
			if (unaryResult !== undefined) {
				cur.pos += 2;
				return unaryResult;
			}
		}
	}

	// Binary operators
	if (cur.pos + 2 <= args.length && isBinaryOp(args[cur.pos + 1])) {
		const left = args[cur.pos];
		const op = args[cur.pos + 1];
		const right = args[cur.pos + 2];
		cur.pos += 3;
		return evalBinary(left, op, right);
	}

	// Single string: true if non-empty
	const val = args[cur.pos];
	cur.pos++;
	return val !== "";
}

function isBinaryOp(op: string): boolean {
	return [
		"=",
		"==",
		"!=",
		"<",
		">",
		"-eq",
		"-ne",
		"-lt",
		"-le",
		"-gt",
		"-ge",
		"-nt",
		"-ot",
		"-ef",
		"=~",
	].includes(op);
}

function evalUnary(op: string, operand: string, ctx: TestCtx): boolean | undefined {
	switch (op) {
		case "-n":
			return operand.length > 0;
		case "-z":
			return operand.length === 0;
		case "-e": {
			try {
				return ctx.fs.exists(ctx.resolve(operand));
			} catch {
				return false;
			}
		}
		case "-f": {
			try {
				const s = ctx.fs.stat(ctx.resolve(operand));
				return s.isFile();
			} catch {
				return false;
			}
		}
		case "-d": {
			try {
				const s = ctx.fs.stat(ctx.resolve(operand));
				return s.isDirectory();
			} catch {
				return false;
			}
		}
		case "-L":
		case "-h": {
			try {
				const s = ctx.fs.lstat(ctx.resolve(operand));
				return s.isSymlink();
			} catch {
				return false;
			}
		}
		case "-s": {
			try {
				const s = ctx.fs.stat(ctx.resolve(operand));
				return s.size > 0;
			} catch {
				return false;
			}
		}
		case "-r":
		case "-w":
		case "-x": {
			try {
				return ctx.fs.exists(ctx.resolve(operand));
			} catch {
				return false;
			}
		}
		case "-b":
		case "-c":
		case "-p":
		case "-S":
		case "-t":
		case "-g":
		case "-u":
		case "-k":
		case "-G":
		case "-O":
		case "-N":
			return false;
		case "-v":
			return operand !== "";
		default:
			return undefined;
	}
}

function evalBinary(left: string, op: string, right: string): boolean {
	switch (op) {
		case "=":
		case "==":
			return left === right;
		case "!=":
			return left !== right;
		case "<":
			return left < right;
		case ">":
			return left > right;
		case "-eq":
			return toNum(left) === toNum(right);
		case "-ne":
			return toNum(left) !== toNum(right);
		case "-lt":
			return toNum(left) < toNum(right);
		case "-le":
			return toNum(left) <= toNum(right);
		case "-gt":
			return toNum(left) > toNum(right);
		case "-ge":
			return toNum(left) >= toNum(right);
		case "=~": {
			try {
				return new RegExp(right).test(left);
			} catch {
				return false;
			}
		}
		default:
			return false;
	}
}

function toNum(s: string): number {
	const n = Number.parseInt(s, 10);
	return Number.isNaN(n) ? 0 : n;
}
