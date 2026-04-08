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
	const result = parseArithExpr(tokens, { pos: 0 }, env);
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

		// Variables ($name → identifier token)
		if (s[i] === "$") {
			i++;
			let name = "";
			while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
				name += s[i];
				i++;
			}
			tokens.push("@" + name);
			continue;
		}

		// Identifiers (bare variable names → identifier token)
		if (/[a-zA-Z_]/.test(s[i])) {
			let name = "";
			while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
				name += s[i];
				i++;
			}
			tokens.push("@" + name);
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

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%="]);

function resolveVar(tok: string, env: Environment): number {
	if (tok.startsWith("@")) {
		const val = env.get(tok.slice(1)) ?? "0";
		const num = Number(val);
		return Number.isNaN(num) ? 0 : Math.trunc(num);
	}
	if (tok.startsWith("0x") || tok.startsWith("0X")) {
		return Number.parseInt(tok, 16) || 0;
	}
	if (tok.startsWith("0") && tok.length > 1 && !tok.includes(".")) {
		return Number.parseInt(tok, 8) || 0;
	}
	const num = Number(tok);
	return Number.isNaN(num) ? 0 : Math.trunc(num);
}

function parseArithExpr(tokens: string[], cur: ArithCursor, env: Environment): number {
	return parseAssign(tokens, cur, env);
}

function parseAssign(tokens: string[], cur: ArithCursor, env: Environment): number {
	// Check for identifier followed by assignment operator
	if (
		cur.pos < tokens.length &&
		tokens[cur.pos].startsWith("@") &&
		cur.pos + 1 < tokens.length &&
		ASSIGN_OPS.has(tokens[cur.pos + 1])
	) {
		const name = tokens[cur.pos].slice(1);
		cur.pos++;
		const op = tokens[cur.pos];
		cur.pos++;
		const rhs = parseAssign(tokens, cur, env);
		const current = Number(env.get(name) ?? "0") || 0;
		let result: number;
		switch (op) {
			case "=":
				result = rhs;
				break;
			case "+=":
				result = current + rhs;
				break;
			case "-=":
				result = current - rhs;
				break;
			case "*=":
				result = current * rhs;
				break;
			case "/=":
				result = rhs !== 0 ? Math.trunc(current / rhs) : 0;
				break;
			case "%=":
				result = rhs !== 0 ? current % rhs : 0;
				break;
			default:
				result = rhs;
		}
		env.set(name, String(result));
		return result;
	}
	return parseTernary(tokens, cur, env);
}

function parseTernary(tokens: string[], cur: ArithCursor, env: Environment): number {
	const cond = parseLogicalOr(tokens, cur, env);
	if (cur.pos < tokens.length && tokens[cur.pos] === "?") {
		cur.pos++;
		const trueVal = parseArithExpr(tokens, cur, env);
		if (cur.pos < tokens.length && tokens[cur.pos] === ":") cur.pos++;
		const falseVal = parseArithExpr(tokens, cur, env);
		return cond !== 0 ? trueVal : falseVal;
	}
	return cond;
}

function parseLogicalOr(tokens: string[], cur: ArithCursor, env: Environment): number {
	let left = parseLogicalAnd(tokens, cur, env);
	while (cur.pos < tokens.length && tokens[cur.pos] === "||") {
		cur.pos++;
		const right = parseLogicalAnd(tokens, cur, env);
		left = left !== 0 || right !== 0 ? 1 : 0;
	}
	return left;
}

function parseLogicalAnd(tokens: string[], cur: ArithCursor, env: Environment): number {
	let left = parseBitwiseOr(tokens, cur, env);
	while (cur.pos < tokens.length && tokens[cur.pos] === "&&") {
		cur.pos++;
		const right = parseBitwiseOr(tokens, cur, env);
		left = left !== 0 && right !== 0 ? 1 : 0;
	}
	return left;
}

function parseBitwiseOr(tokens: string[], cur: ArithCursor, env: Environment): number {
	let left = parseBitwiseXor(tokens, cur, env);
	while (cur.pos < tokens.length && tokens[cur.pos] === "|") {
		cur.pos++;
		left = left | parseBitwiseXor(tokens, cur, env);
	}
	return left;
}

function parseBitwiseXor(tokens: string[], cur: ArithCursor, env: Environment): number {
	let left = parseBitwiseAnd(tokens, cur, env);
	while (cur.pos < tokens.length && tokens[cur.pos] === "^") {
		cur.pos++;
		left = left ^ parseBitwiseAnd(tokens, cur, env);
	}
	return left;
}

function parseBitwiseAnd(tokens: string[], cur: ArithCursor, env: Environment): number {
	let left = parseEquality(tokens, cur, env);
	while (cur.pos < tokens.length && tokens[cur.pos] === "&") {
		cur.pos++;
		left = left & parseEquality(tokens, cur, env);
	}
	return left;
}

function parseEquality(tokens: string[], cur: ArithCursor, env: Environment): number {
	let left = parseRelational(tokens, cur, env);
	while (cur.pos < tokens.length && (tokens[cur.pos] === "==" || tokens[cur.pos] === "!=")) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseRelational(tokens, cur, env);
		left = op === "==" ? (left === right ? 1 : 0) : left !== right ? 1 : 0;
	}
	return left;
}

function parseRelational(tokens: string[], cur: ArithCursor, env: Environment): number {
	let left = parseShift(tokens, cur, env);
	while (cur.pos < tokens.length && ["<", ">", "<=", ">="].includes(tokens[cur.pos])) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseShift(tokens, cur, env);
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

function parseShift(tokens: string[], cur: ArithCursor, env: Environment): number {
	let left = parseAddSub(tokens, cur, env);
	while (cur.pos < tokens.length && (tokens[cur.pos] === "<<" || tokens[cur.pos] === ">>")) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseAddSub(tokens, cur, env);
		left = op === "<<" ? left << right : left >> right;
	}
	return left;
}

function parseAddSub(tokens: string[], cur: ArithCursor, env: Environment): number {
	let left = parseMulDiv(tokens, cur, env);
	while (cur.pos < tokens.length && (tokens[cur.pos] === "+" || tokens[cur.pos] === "-")) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseMulDiv(tokens, cur, env);
		left = op === "+" ? left + right : left - right;
	}
	return left;
}

function parseMulDiv(tokens: string[], cur: ArithCursor, env: Environment): number {
	let left = parseExponent(tokens, cur, env);
	while (
		cur.pos < tokens.length &&
		(tokens[cur.pos] === "*" || tokens[cur.pos] === "/" || tokens[cur.pos] === "%")
	) {
		const op = tokens[cur.pos];
		cur.pos++;
		const right = parseExponent(tokens, cur, env);
		if (op === "*") left = left * right;
		else if (op === "/") left = right !== 0 ? Math.trunc(left / right) : 0;
		else left = right !== 0 ? left % right : 0;
	}
	return left;
}

function parseExponent(tokens: string[], cur: ArithCursor, env: Environment): number {
	const base = parseUnary(tokens, cur, env);
	if (cur.pos < tokens.length && tokens[cur.pos] === "**") {
		cur.pos++;
		const exp = parseExponent(tokens, cur, env);
		return base ** exp;
	}
	return base;
}

function parseUnary(tokens: string[], cur: ArithCursor, env: Environment): number {
	if (cur.pos < tokens.length) {
		if (tokens[cur.pos] === "-") {
			cur.pos++;
			return -parseUnary(tokens, cur, env);
		}
		if (tokens[cur.pos] === "+") {
			cur.pos++;
			return parseUnary(tokens, cur, env);
		}
		if (tokens[cur.pos] === "!") {
			cur.pos++;
			return parseUnary(tokens, cur, env) === 0 ? 1 : 0;
		}
		if (tokens[cur.pos] === "~") {
			cur.pos++;
			return ~parseUnary(tokens, cur, env);
		}
		// Pre-increment/decrement
		if (tokens[cur.pos] === "++" && cur.pos + 1 < tokens.length && tokens[cur.pos + 1].startsWith("@")) {
			cur.pos++;
			const name = tokens[cur.pos].slice(1);
			cur.pos++;
			const val = (Number(env.get(name) ?? "0") || 0) + 1;
			env.set(name, String(val));
			return val;
		}
		if (tokens[cur.pos] === "--" && cur.pos + 1 < tokens.length && tokens[cur.pos + 1].startsWith("@")) {
			cur.pos++;
			const name = tokens[cur.pos].slice(1);
			cur.pos++;
			const val = (Number(env.get(name) ?? "0") || 0) - 1;
			env.set(name, String(val));
			return val;
		}
	}
	return parsePrimaryArith(tokens, cur, env);
}

function parsePrimaryArith(tokens: string[], cur: ArithCursor, env: Environment): number {
	if (cur.pos >= tokens.length) return 0;

	if (tokens[cur.pos] === "(") {
		cur.pos++;
		const val = parseArithExpr(tokens, cur, env);
		if (cur.pos < tokens.length && tokens[cur.pos] === ")") cur.pos++;
		return val;
	}

	const tok = tokens[cur.pos];
	cur.pos++;

	// Post-increment/decrement
	if (tok.startsWith("@") && cur.pos < tokens.length) {
		if (tokens[cur.pos] === "++" || tokens[cur.pos] === "--") {
			const name = tok.slice(1);
			const current = Number(env.get(name) ?? "0") || 0;
			const delta = tokens[cur.pos] === "++" ? 1 : -1;
			cur.pos++;
			env.set(name, String(current + delta));
			return current; // post: return old value
		}
	}

	return resolveVar(tok, env);
}
