import type { Environment } from "../../env/environment.js";
import type { WasmArithmeticModule } from "../../wasm-interfaces.js";

let wasmEvalArith: ((expr: string) => number) | null = null;

export function useWasmArithmetic(module: WasmArithmeticModule): void {
	wasmEvalArith = (expr) => module.evaluateArithmetic(expr);
}

export function evaluateArithmetic(expr: string, env: Environment): number {
	if (wasmEvalArith) {
		return wasmEvalArith(resolveArithVars(expr, env));
	}
	const tokens = tokenizeArith(expr, env);
	const result = parseArithExpr(tokens, { pos: 0 });
	return result;
}

function resolveArithVars(expr: string, env: Environment): string {
	let result = "";
	let i = 0;
	const s = expr.trim();
	while (i < s.length) {
		if (s[i] === "$") {
			i++;
			let name = "";
			while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
				name += s[i];
				i++;
			}
			result += env.get(name) ?? "0";
		} else if (/[a-zA-Z_]/.test(s[i])) {
			let name = "";
			while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
				name += s[i];
				i++;
			}
			result += env.get(name) ?? "0";
		} else {
			result += s[i];
			i++;
		}
	}
	return result;
}

interface ArithCursor {
	pos: number;
}

function tokenizeArith(expr: string, env: Environment): string[] {
	const tokens: string[] = [];
	let i = 0;
	const s = expr.trim();

	while (i < s.length) {
		if (s[i] === " " || s[i] === "\t") {
			i++;
			continue;
		}

		// Numbers
		if (s[i] >= "0" && s[i] <= "9") {
			let num = "";
			while (
				i < s.length &&
				((s[i] >= "0" && s[i] <= "9") ||
					s[i] === "." ||
					s[i] === "x" ||
					s[i] === "X" ||
					(s[i] >= "a" && s[i] <= "f") ||
					(s[i] >= "A" && s[i] <= "F"))
			) {
				num += s[i];
				i++;
			}
			tokens.push(num);
			continue;
		}

		// Variables
		if (s[i] === "$") {
			i++;
			let name = "";
			while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
				name += s[i];
				i++;
			}
			const val = env.get(name) ?? "0";
			tokens.push(val);
			continue;
		}

		// Identifiers (variable names without $)
		if (/[a-zA-Z_]/.test(s[i])) {
			let name = "";
			while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
				name += s[i];
				i++;
			}
			const val = env.get(name) ?? "0";
			tokens.push(val);
			continue;
		}

		// Two-char operators
		if (i + 1 < s.length) {
			const two = s[i] + s[i + 1];
			if (
				[
					"<=",
					">=",
					"==",
					"!=",
					"&&",
					"||",
					"<<",
					">>",
					"**",
					"+=",
					"-=",
					"*=",
					"/=",
					"%=",
					"++",
					"--",
				].includes(two)
			) {
				tokens.push(two);
				i += 2;
				continue;
			}
		}

		// Single-char operators
		tokens.push(s[i]);
		i++;
	}

	return tokens;
}

function parseArithExpr(tokens: string[], cur: ArithCursor): number {
	return parseAssign(tokens, cur);
}

function parseAssign(tokens: string[], cur: ArithCursor): number {
	const val = parseTernary(tokens, cur);
	return val;
}

function parseTernary(tokens: string[], cur: ArithCursor): number {
	const cond = parseLogicalOr(tokens, cur);
	if (cur.pos < tokens.length && tokens[cur.pos] === "?") {
		cur.pos++;
		const trueVal = parseArithExpr(tokens, cur);
		if (cur.pos < tokens.length && tokens[cur.pos] === ":") cur.pos++;
		const falseVal = parseArithExpr(tokens, cur);
		return cond !== 0 ? trueVal : falseVal;
	}
	return cond;
}

function parseLogicalOr(tokens: string[], cur: ArithCursor): number {
	let left = parseLogicalAnd(tokens, cur);
	while (cur.pos < tokens.length && tokens[cur.pos] === "||") {
		cur.pos++;
		const right = parseLogicalAnd(tokens, cur);
		left = left !== 0 || right !== 0 ? 1 : 0;
	}
	return left;
}

function parseLogicalAnd(tokens: string[], cur: ArithCursor): number {
	let left = parseBitwiseOr(tokens, cur);
	while (cur.pos < tokens.length && tokens[cur.pos] === "&&") {
		cur.pos++;
		const right = parseBitwiseOr(tokens, cur);
		left = left !== 0 && right !== 0 ? 1 : 0;
	}
	return left;
}

function parseBitwiseOr(tokens: string[], cur: ArithCursor): number {
	let left = parseBitwiseXor(tokens, cur);
	while (cur.pos < tokens.length && tokens[cur.pos] === "|") {
		cur.pos++;
		left = left | parseBitwiseXor(tokens, cur);
	}
	return left;
}

function parseBitwiseXor(tokens: string[], cur: ArithCursor): number {
	let left = parseBitwiseAnd(tokens, cur);
	while (cur.pos < tokens.length && tokens[cur.pos] === "^") {
		cur.pos++;
		left = left ^ parseBitwiseAnd(tokens, cur);
	}
	return left;
}

function parseBitwiseAnd(tokens: string[], cur: ArithCursor): number {
	let left = parseEquality(tokens, cur);
	while (cur.pos < tokens.length && tokens[cur.pos] === "&") {
		cur.pos++;
		left = left & parseEquality(tokens, cur);
	}
	return left;
}

function parseEquality(tokens: string[], cur: ArithCursor): number {
	let left = parseRelational(tokens, cur);
	while (cur.pos < tokens.length && (tokens[cur.pos] === "==" || tokens[cur.pos] === "!=")) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseRelational(tokens, cur);
		left = op === "==" ? (left === right ? 1 : 0) : left !== right ? 1 : 0;
	}
	return left;
}

function parseRelational(tokens: string[], cur: ArithCursor): number {
	let left = parseShift(tokens, cur);
	while (cur.pos < tokens.length && ["<", ">", "<=", ">="].includes(tokens[cur.pos])) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseShift(tokens, cur);
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

function parseShift(tokens: string[], cur: ArithCursor): number {
	let left = parseAddSub(tokens, cur);
	while (cur.pos < tokens.length && (tokens[cur.pos] === "<<" || tokens[cur.pos] === ">>")) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseAddSub(tokens, cur);
		left = op === "<<" ? left << right : left >> right;
	}
	return left;
}

function parseAddSub(tokens: string[], cur: ArithCursor): number {
	let left = parseMulDiv(tokens, cur);
	while (cur.pos < tokens.length && (tokens[cur.pos] === "+" || tokens[cur.pos] === "-")) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseMulDiv(tokens, cur);
		left = op === "+" ? left + right : left - right;
	}
	return left;
}

function parseMulDiv(tokens: string[], cur: ArithCursor): number {
	let left = parseExponent(tokens, cur);
	while (
		cur.pos < tokens.length &&
		(tokens[cur.pos] === "*" || tokens[cur.pos] === "/" || tokens[cur.pos] === "%")
	) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseExponent(tokens, cur);
		if (op === "*") left = left * right;
		else if (op === "/") left = right !== 0 ? Math.trunc(left / right) : 0;
		else left = right !== 0 ? left % right : 0;
	}
	return left;
}

function parseExponent(tokens: string[], cur: ArithCursor): number {
	const base = parseUnary(tokens, cur);
	if (cur.pos < tokens.length && tokens[cur.pos] === "**") {
		cur.pos++;
		const exp = parseExponent(tokens, cur);
		return base ** exp;
	}
	return base;
}

function parseUnary(tokens: string[], cur: ArithCursor): number {
	if (cur.pos < tokens.length) {
		if (tokens[cur.pos] === "-") {
			cur.pos++;
			return -parseUnary(tokens, cur);
		}
		if (tokens[cur.pos] === "+") {
			cur.pos++;
			return parseUnary(tokens, cur);
		}
		if (tokens[cur.pos] === "!") {
			cur.pos++;
			return parseUnary(tokens, cur) === 0 ? 1 : 0;
		}
		if (tokens[cur.pos] === "~") {
			cur.pos++;
			return ~parseUnary(tokens, cur);
		}
	}
	return parsePrimaryArith(tokens, cur);
}

function parsePrimaryArith(tokens: string[], cur: ArithCursor): number {
	if (cur.pos >= tokens.length) return 0;

	if (tokens[cur.pos] === "(") {
		cur.pos++;
		const val = parseArithExpr(tokens, cur);
		if (cur.pos < tokens.length && tokens[cur.pos] === ")") cur.pos++;
		return val;
	}

	const tok = tokens[cur.pos];
	cur.pos++;

	// Parse number (decimal, hex, octal)
	if (tok.startsWith("0x") || tok.startsWith("0X")) {
		return Number.parseInt(tok, 16) || 0;
	}
	if (tok.startsWith("0") && tok.length > 1 && !tok.includes(".")) {
		return Number.parseInt(tok, 8) || 0;
	}
	const num = Number(tok);
	return Number.isNaN(num) ? 0 : Math.trunc(num);
}
