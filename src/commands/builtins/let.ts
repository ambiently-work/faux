import { command } from "../builder.js";

export const letCmd = command("let")
	.description("Evaluate arithmetic expressions")
	.allowUnknownFlags()
	.argument("[expressions...]", "Arithmetic expressions")
	.action((ctx, { raw }) => {
		if (raw.length === 0) {
			ctx.stderr.writeln("let: expression expected");
			return 1;
		}

		let lastResult = 0;

		for (const expr of raw) {
			lastResult = evaluateLetExpr(expr, ctx.env);
		}

		return lastResult === 0 ? 1 : 0;
	})
	.toHandler();

interface LetEnv {
	get(name: string): string | undefined;
	set(name: string, value: string): void;
}

function evaluateLetExpr(expr: string, env: LetEnv): number {
	const tokens = tokenizeLet(expr);
	const result = parseLetAssign(tokens, { pos: 0 }, env);
	return result;
}

interface Cursor {
	pos: number;
}

const LET_TWO_CHAR_OPS = new Set([
	"==",
	"!=",
	"<=",
	">=",
	"&&",
	"||",
	"++",
	"--",
	"<<",
	">>",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"**",
	"&=",
	"|=",
	"^=",
]);

function tokenizeLet(expr: string): string[] {
	const tokens: string[] = [];
	let i = 0;

	while (i < expr.length) {
		const ch = expr[i];

		if (ch === " " || ch === "\t") {
			i++;
			continue;
		}

		// Three-char operators (must check before two-char)
		if (i + 2 < expr.length) {
			const three = expr[i] + expr[i + 1] + expr[i + 2];
			if (three === "**=" || three === "<<=" || three === ">>=") {
				tokens.push(three);
				i += 3;
				continue;
			}
		}

		// Two-char operators
		if (i + 1 < expr.length) {
			const two = expr[i] + expr[i + 1];
			if (LET_TWO_CHAR_OPS.has(two)) {
				tokens.push(two);
				i += 2;
				continue;
			}
		}

		if ("+-*/%^()~!&|<>=,".includes(ch)) {
			tokens.push(ch);
			i++;
			continue;
		}

		if (ch >= "0" && ch <= "9") {
			let num = "";
			if (ch === "0" && i + 1 < expr.length && (expr[i + 1] === "x" || expr[i + 1] === "X")) {
				num = "0x";
				i += 2;
				while (i < expr.length && /[0-9a-fA-F]/.test(expr[i])) {
					num += expr[i];
					i++;
				}
			} else if (ch === "0" && i + 1 < expr.length && expr[i + 1] >= "0" && expr[i + 1] <= "7") {
				num = "0";
				i++;
				while (i < expr.length && expr[i] >= "0" && expr[i] <= "7") {
					num += expr[i];
					i++;
				}
			} else {
				while (i < expr.length && expr[i] >= "0" && expr[i] <= "9") {
					num += expr[i];
					i++;
				}
			}
			tokens.push(num);
			continue;
		}

		if (/[a-zA-Z_]/.test(ch)) {
			let ident = "";
			while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
				ident += expr[i];
				i++;
			}
			tokens.push(ident);
			continue;
		}

		i++;
	}

	return tokens;
}

function parseLetAssign(tokens: string[], cur: Cursor, env: LetEnv): number {
	// Check for assignment patterns: VAR = expr, VAR += expr, etc.
	if (cur.pos < tokens.length && /^[a-zA-Z_]/.test(tokens[cur.pos])) {
		const savedPos = cur.pos;
		const name = tokens[cur.pos];
		cur.pos++;

		const tok = tokens[cur.pos];
		if (
			tok === "=" ||
			tok === "+=" ||
			tok === "-=" ||
			tok === "*=" ||
			tok === "/=" ||
			tok === "%=" ||
			tok === "**=" ||
			tok === "&=" ||
			tok === "|=" ||
			tok === "^=" ||
			tok === "<<=" ||
			tok === ">>="
		) {
			cur.pos++;
			const right = parseLetAssign(tokens, cur, env);
			const current = getVarNum(name, env);

			let result: number;
			switch (tok) {
				case "=":
					result = right;
					break;
				case "+=":
					result = current + right;
					break;
				case "-=":
					result = current - right;
					break;
				case "*=":
					result = current * right;
					break;
				case "/=":
					result = right === 0 ? 0 : Math.trunc(current / right);
					break;
				case "%=":
					result = right === 0 ? 0 : current % right;
					break;
				case "**=":
					result = current ** right;
					break;
				case "&=":
					result = current & right;
					break;
				case "|=":
					result = current | right;
					break;
				case "^=":
					result = current ^ right;
					break;
				case "<<=":
					result = current << right;
					break;
				case ">>=":
					result = current >> right;
					break;
				default:
					result = right;
					break;
			}

			env.set(name, String(result));
			return result;
		}

		cur.pos = savedPos;
	}

	return parseLetTernary(tokens, cur, env);
}

function parseLetTernary(tokens: string[], cur: Cursor, env: LetEnv): number {
	const cond = parseLetOr(tokens, cur, env);
	if (cur.pos < tokens.length && tokens[cur.pos] === "?") {
		// Not commonly needed, skip for simplicity
	}
	return cond;
}

function parseLetOr(tokens: string[], cur: Cursor, env: LetEnv): number {
	let left = parseLetAnd(tokens, cur, env);
	while (cur.pos < tokens.length && tokens[cur.pos] === "||") {
		cur.pos++;
		const right = parseLetAnd(tokens, cur, env);
		left = left || right ? 1 : 0;
	}
	return left;
}

function parseLetAnd(tokens: string[], cur: Cursor, env: LetEnv): number {
	let left = parseLetBitwiseOr(tokens, cur, env);
	while (cur.pos < tokens.length && tokens[cur.pos] === "&&") {
		cur.pos++;
		const right = parseLetBitwiseOr(tokens, cur, env);
		left = left && right ? 1 : 0;
	}
	return left;
}

function parseLetBitwiseOr(tokens: string[], cur: Cursor, env: LetEnv): number {
	let left = parseLetBitwiseXor(tokens, cur, env);
	while (cur.pos < tokens.length && tokens[cur.pos] === "|") {
		cur.pos++;
		const right = parseLetBitwiseXor(tokens, cur, env);
		left = left | right;
	}
	return left;
}

function parseLetBitwiseXor(tokens: string[], cur: Cursor, env: LetEnv): number {
	let left = parseLetBitwiseAnd(tokens, cur, env);
	while (cur.pos < tokens.length && tokens[cur.pos] === "^") {
		cur.pos++;
		const right = parseLetBitwiseAnd(tokens, cur, env);
		left = left ^ right;
	}
	return left;
}

function parseLetBitwiseAnd(tokens: string[], cur: Cursor, env: LetEnv): number {
	let left = parseLetEquality(tokens, cur, env);
	while (cur.pos < tokens.length && tokens[cur.pos] === "&") {
		cur.pos++;
		const right = parseLetEquality(tokens, cur, env);
		left = left & right;
	}
	return left;
}

function parseLetEquality(tokens: string[], cur: Cursor, env: LetEnv): number {
	let left = parseLetComparison(tokens, cur, env);
	while (cur.pos < tokens.length && (tokens[cur.pos] === "==" || tokens[cur.pos] === "!=")) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseLetComparison(tokens, cur, env);
		left = op === "==" ? (left === right ? 1 : 0) : left !== right ? 1 : 0;
	}
	return left;
}

function parseLetComparison(tokens: string[], cur: Cursor, env: LetEnv): number {
	let left = parseLetShift(tokens, cur, env);
	while (
		cur.pos < tokens.length &&
		(tokens[cur.pos] === "<" ||
			tokens[cur.pos] === ">" ||
			tokens[cur.pos] === "<=" ||
			tokens[cur.pos] === ">=")
	) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseLetShift(tokens, cur, env);
		switch (op) {
			case "<":
				left = left < right ? 1 : 0;
				break;
			case ">":
				left = left > right ? 1 : 0;
				break;
			case "<=":
				left = left <= right ? 1 : 0;
				break;
			case ">=":
				left = left >= right ? 1 : 0;
				break;
		}
	}
	return left;
}

function parseLetShift(tokens: string[], cur: Cursor, env: LetEnv): number {
	let left = parseLetAddSub(tokens, cur, env);
	while (cur.pos < tokens.length && (tokens[cur.pos] === "<<" || tokens[cur.pos] === ">>")) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseLetAddSub(tokens, cur, env);
		left = op === "<<" ? left << right : left >> right;
	}
	return left;
}

function parseLetAddSub(tokens: string[], cur: Cursor, env: LetEnv): number {
	let left = parseLetMulDiv(tokens, cur, env);
	while (cur.pos < tokens.length && (tokens[cur.pos] === "+" || tokens[cur.pos] === "-")) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseLetMulDiv(tokens, cur, env);
		left = op === "+" ? left + right : left - right;
	}
	return left;
}

function parseLetMulDiv(tokens: string[], cur: Cursor, env: LetEnv): number {
	let left = parseLetPow(tokens, cur, env);
	while (
		cur.pos < tokens.length &&
		(tokens[cur.pos] === "*" || tokens[cur.pos] === "/" || tokens[cur.pos] === "%")
	) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseLetPow(tokens, cur, env);
		if (op === "*") left = left * right;
		else if (op === "/") left = right === 0 ? 0 : Math.trunc(left / right);
		else left = right === 0 ? 0 : left % right;
	}
	return left;
}

function parseLetPow(tokens: string[], cur: Cursor, env: LetEnv): number {
	let base = parseLetUnary(tokens, cur, env);
	if (cur.pos < tokens.length && tokens[cur.pos] === "**") {
		cur.pos++;
		const exp = parseLetUnary(tokens, cur, env);
		base = base ** exp;
	}
	return base;
}

function parseLetUnary(tokens: string[], cur: Cursor, env: LetEnv): number {
	if (cur.pos >= tokens.length) return 0;

	const tok = tokens[cur.pos];

	if (tok === "-") {
		cur.pos++;
		return -parseLetUnary(tokens, cur, env);
	}

	if (tok === "+") {
		cur.pos++;
		return parseLetUnary(tokens, cur, env);
	}

	if (tok === "~") {
		cur.pos++;
		return ~parseLetUnary(tokens, cur, env);
	}

	if (tok === "!") {
		cur.pos++;
		return parseLetUnary(tokens, cur, env) === 0 ? 1 : 0;
	}

	if (tok === "++" || tok === "--") {
		cur.pos++;
		if (cur.pos < tokens.length && /^[a-zA-Z_]/.test(tokens[cur.pos])) {
			const name = tokens[cur.pos];
			cur.pos++;
			const current = getVarNum(name, env);
			const newVal = tok === "++" ? current + 1 : current - 1;
			env.set(name, String(newVal));
			return newVal;
		}
		return 0;
	}

	return parseLetPrimary(tokens, cur, env);
}

function parseLetPrimary(tokens: string[], cur: Cursor, env: LetEnv): number {
	if (cur.pos >= tokens.length) return 0;

	const tok = tokens[cur.pos];

	if (tok === "(") {
		cur.pos++;
		const result = parseLetAssign(tokens, cur, env);
		if (cur.pos < tokens.length && tokens[cur.pos] === ")") {
			cur.pos++;
		}
		return result;
	}

	cur.pos++;

	// Number
	if (/^0[xX]/.test(tok)) {
		return Number.parseInt(tok, 16);
	}
	if (/^0[0-7]+$/.test(tok)) {
		return Number.parseInt(tok, 8);
	}
	if (/^[0-9]/.test(tok)) {
		return Number.parseInt(tok, 10);
	}

	// Variable (possibly with post-increment)
	if (/^[a-zA-Z_]/.test(tok)) {
		const val = getVarNum(tok, env);
		if (cur.pos < tokens.length && (tokens[cur.pos] === "++" || tokens[cur.pos] === "--")) {
			const op = tokens[cur.pos];
			cur.pos++;
			const newVal = op === "++" ? val + 1 : val - 1;
			env.set(tok, String(newVal));
			return val; // return pre-increment value
		}
		return val;
	}

	return 0;
}

function getVarNum(name: string, env: LetEnv): number {
	const val = env.get(name);
	if (val === undefined) return 0;
	const n = Number.parseInt(val, 10);
	return Number.isNaN(n) ? 0 : n;
}
