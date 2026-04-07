import { command } from "../builder.js";
import type { CommandContext } from "../types.js";

export const find = command("find")
	.description("Search for files in a directory hierarchy")
	.allowUnknownFlags()
	.stopAfterFirstPositional()
	.action((ctx) => {
		const args = ctx.args.slice();
		let i = 0;

		// Parse starting paths (before any expression)
		const paths: string[] = [];
		while (i < args.length && !args[i].startsWith("-") && args[i] !== "!" && args[i] !== "(") {
			paths.push(args[i]);
			i++;
		}

		if (paths.length === 0) {
			paths.push(".");
		}

		// Parse global options first (maxdepth, mindepth)
		let maxDepth = -1;
		let minDepth = 0;
		const exprArgs: string[] = [];

		for (let j = i; j < args.length; j++) {
			if (args[j] === "-maxdepth" && j + 1 < args.length) {
				maxDepth = Number.parseInt(args[j + 1], 10);
				j++;
			} else if (args[j] === "-mindepth" && j + 1 < args.length) {
				minDepth = Number.parseInt(args[j + 1], 10);
				j++;
			} else {
				exprArgs.push(args[j]);
			}
		}

		const expression = parseExpression(exprArgs, { pos: 0 });
		let exitCode = 0;

		for (const searchPath of paths) {
			const resolved = ctx.resolve(searchPath);
			if (!ctx.fs.exists(resolved)) {
				ctx.stderr.writeln(`find: '${searchPath}': No such file or directory`);
				exitCode = 1;
				continue;
			}
			walkPath(ctx, resolved, searchPath, 0, maxDepth, minDepth, expression);
		}

		return exitCode;
	})
	.toHandler();

interface FindExpr {
	type: string;
}

interface NameExpr extends FindExpr {
	type: "name";
	pattern: string;
	caseInsensitive: boolean;
}

interface TypeExpr extends FindExpr {
	type: "type";
	fileType: string;
}

interface EmptyExpr extends FindExpr {
	type: "empty";
}

interface NewerExpr extends FindExpr {
	type: "newer";
	refPath: string;
}

interface PrintExpr extends FindExpr {
	type: "print";
}

interface Print0Expr extends FindExpr {
	type: "print0";
}

interface AndExpr extends FindExpr {
	type: "and";
	left: FindExpr;
	right: FindExpr;
}

interface OrExpr extends FindExpr {
	type: "or";
	left: FindExpr;
	right: FindExpr;
}

interface NotExpr extends FindExpr {
	type: "not";
	operand: FindExpr;
}

interface TrueExpr extends FindExpr {
	type: "true";
}

interface Cursor {
	pos: number;
}

function parseExpression(args: string[], cur: Cursor): FindExpr {
	const expressions: FindExpr[] = [];
	let hasPrint = false;

	while (cur.pos < args.length) {
		const arg = args[cur.pos];

		if (arg === ")") {
			break;
		}

		if (arg === "-and" || arg === "-a") {
			cur.pos++;
			continue;
		}

		if (arg === "-or" || arg === "-o") {
			cur.pos++;
			const left = combineAnd(expressions);
			expressions.length = 0;
			const right = parseExpression(args, cur);
			return { type: "or", left, right } as OrExpr;
		}

		const expr = parseSingle(args, cur);
		if (expr.type === "print" || expr.type === "print0") {
			hasPrint = true;
		}
		expressions.push(expr);
	}

	if (expressions.length === 0) {
		return { type: "print" } as PrintExpr;
	}

	const combined = combineAnd(expressions);

	if (!hasPrint) {
		return { type: "and", left: combined, right: { type: "print" } as PrintExpr } as AndExpr;
	}

	return combined;
}

function parseSingle(args: string[], cur: Cursor): FindExpr {
	if (cur.pos >= args.length) {
		return { type: "true" } as TrueExpr;
	}

	const arg = args[cur.pos];

	if (arg === "!" || arg === "-not") {
		cur.pos++;
		const operand = parseSingle(args, cur);
		return { type: "not", operand } as NotExpr;
	}

	if (arg === "(") {
		cur.pos++;
		const expr = parseExpression(args, cur);
		if (cur.pos < args.length && args[cur.pos] === ")") {
			cur.pos++;
		}
		return expr;
	}

	if (arg === "-name" || arg === "-iname") {
		const caseInsensitive = arg === "-iname";
		cur.pos++;
		const pattern = args[cur.pos] ?? "*";
		cur.pos++;
		return { type: "name", pattern, caseInsensitive } as NameExpr;
	}

	if (arg === "-type") {
		cur.pos++;
		const fileType = args[cur.pos] ?? "f";
		cur.pos++;
		return { type: "type", fileType } as TypeExpr;
	}

	if (arg === "-empty") {
		cur.pos++;
		return { type: "empty" } as EmptyExpr;
	}

	if (arg === "-newer") {
		cur.pos++;
		const refPath = args[cur.pos] ?? "";
		cur.pos++;
		return { type: "newer", refPath } as NewerExpr;
	}

	if (arg === "-print") {
		cur.pos++;
		return { type: "print" } as PrintExpr;
	}

	if (arg === "-print0") {
		cur.pos++;
		return { type: "print0" } as Print0Expr;
	}

	// Unknown expression — skip
	cur.pos++;
	return { type: "true" } as TrueExpr;
}

function combineAnd(expressions: FindExpr[]): FindExpr {
	if (expressions.length === 0) {
		return { type: "true" } as TrueExpr;
	}
	if (expressions.length === 1) {
		return expressions[0];
	}
	let result = expressions[0];
	for (let i = 1; i < expressions.length; i++) {
		result = { type: "and", left: result, right: expressions[i] } as AndExpr;
	}
	return result;
}

function walkPath(
	ctx: CommandContext,
	fullPath: string,
	displayPath: string,
	depth: number,
	maxDepth: number,
	minDepth: number,
	expr: FindExpr,
): void {
	if (maxDepth >= 0 && depth > maxDepth) {
		return;
	}

	if (depth >= minDepth) {
		evaluateExpr(ctx, fullPath, displayPath, depth, expr);
	}

	try {
		const stat = ctx.fs.stat(fullPath);
		if (stat.isDirectory()) {
			const entries = ctx.fs.readDir(fullPath);
			entries.sort();
			for (const entry of entries) {
				const childFull = fullPath.endsWith("/") ? `${fullPath}${entry}` : `${fullPath}/${entry}`;
				const childDisplay = displayPath === "." ? `./${entry}` : `${displayPath}/${entry}`;
				walkPath(ctx, childFull, childDisplay, depth + 1, maxDepth, minDepth, expr);
			}
		}
	} catch {
		// Cannot read directory
	}
}

function evaluateExpr(
	ctx: CommandContext,
	fullPath: string,
	displayPath: string,
	depth: number,
	expr: FindExpr,
): boolean {
	switch (expr.type) {
		case "true":
			return true;

		case "print":
			ctx.stdout.writeln(displayPath);
			return true;

		case "print0":
			ctx.stdout.write(displayPath + "\0");
			return true;

		case "name": {
			const nameExpr = expr as NameExpr;
			let name = fullPath.slice(fullPath.lastIndexOf("/") + 1);
			let pattern = nameExpr.pattern;
			if (nameExpr.caseInsensitive) {
				name = name.toLowerCase();
				pattern = pattern.toLowerCase();
			}
			return globMatch(name, pattern);
		}

		case "type": {
			const fileType = (expr as TypeExpr).fileType;
			try {
				const stat = ctx.fs.stat(fullPath);
				switch (fileType) {
					case "f":
						return stat.isFile();
					case "d":
						return stat.isDirectory();
					case "l":
						return stat.isSymlink();
					default:
						return false;
				}
			} catch {
				return false;
			}
		}

		case "empty": {
			try {
				const stat = ctx.fs.stat(fullPath);
				if (stat.isFile()) return stat.size === 0;
				if (stat.isDirectory()) return ctx.fs.readDir(fullPath).length === 0;
				return false;
			} catch {
				return false;
			}
		}

		case "newer": {
			const refPath = (expr as NewerExpr).refPath;
			try {
				const resolved = ctx.resolve(refPath);
				const refStat = ctx.fs.stat(resolved);
				const thisStat = ctx.fs.stat(fullPath);
				return thisStat.mtime > refStat.mtime;
			} catch {
				return false;
			}
		}

		case "and": {
			const andExpr = expr as AndExpr;
			const leftResult = evaluateExpr(ctx, fullPath, displayPath, depth, andExpr.left);
			if (!leftResult) return false;
			return evaluateExpr(ctx, fullPath, displayPath, depth, andExpr.right);
		}

		case "or": {
			const orExpr = expr as OrExpr;
			const leftResult = evaluateExpr(ctx, fullPath, displayPath, depth, orExpr.left);
			if (leftResult) return true;
			return evaluateExpr(ctx, fullPath, displayPath, depth, orExpr.right);
		}

		case "not": {
			const notExpr = expr as NotExpr;
			return !evaluateExpr(ctx, fullPath, displayPath, depth, notExpr.operand);
		}

		default:
			return true;
	}
}

function globMatch(str: string, pattern: string): boolean {
	let regex = "^";
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];
		switch (ch) {
			case "*":
				regex += ".*";
				break;
			case "?":
				regex += ".";
				break;
			case "[": {
				let j = i + 1;
				let bracket = "[";
				while (j < pattern.length && pattern[j] !== "]") {
					bracket += pattern[j];
					j++;
				}
				bracket += "]";
				regex += bracket;
				i = j;
				break;
			}
			case ".":
			case "+":
			case "^":
			case "$":
			case "(":
			case ")":
			case "{":
			case "}":
			case "|":
			case "\\":
				regex += `\\${ch}`;
				break;
			default:
				regex += ch;
				break;
		}
	}
	regex += "$";

	try {
		return new RegExp(regex).test(str);
	} catch {
		return str === pattern;
	}
}
