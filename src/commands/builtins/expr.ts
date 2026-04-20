import { command } from "../builder.js";

export const expr = command("expr")
	.description("Evaluate expressions")
	.argument("[tokens...]", "Expression tokens")
	.stopAfterFirstPositional()
	.action((ctx, { raw }) => {
		if (raw.length === 0) {
			ctx.stderr.writeln("expr: missing operand");
			return 2;
		}

		const tokens = raw.slice();
		let pos = 0;

		const peek = (): string | undefined => tokens[pos];
		const consume = (): string => tokens[pos++];

		const parseOr = (): string | number => {
			let left = parseAnd();
			while (peek() === "|") {
				consume();
				const right = parseAnd();
				if (isTruthy(left)) {
					// keep left
				} else {
					left = right;
				}
			}
			return left;
		};

		const parseAnd = (): string | number => {
			let left = parseComparison();
			while (peek() === "&") {
				consume();
				const right = parseComparison();
				if (isTruthy(left) && isTruthy(right)) {
					// keep left
				} else {
					left = 0;
				}
			}
			return left;
		};

		const parseComparison = (): string | number => {
			const left = parseAddSub();
			const op = peek();
			if (op === "=" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=") {
				consume();
				const right = parseAddSub();
				const lNum = Number(left);
				const rNum = Number(right);
				const bothNumeric =
					!Number.isNaN(lNum) &&
					!Number.isNaN(rNum) &&
					String(left).trim() !== "" &&
					String(right).trim() !== "";

				let result = false;
				if (bothNumeric) {
					switch (op) {
						case "=":
							result = lNum === rNum;
							break;
						case "!=":
							result = lNum !== rNum;
							break;
						case "<":
							result = lNum < rNum;
							break;
						case ">":
							result = lNum > rNum;
							break;
						case "<=":
							result = lNum <= rNum;
							break;
						case ">=":
							result = lNum >= rNum;
							break;
					}
				} else {
					const ls = String(left);
					const rs = String(right);
					switch (op) {
						case "=":
							result = ls === rs;
							break;
						case "!=":
							result = ls !== rs;
							break;
						case "<":
							result = ls < rs;
							break;
						case ">":
							result = ls > rs;
							break;
						case "<=":
							result = ls <= rs;
							break;
						case ">=":
							result = ls >= rs;
							break;
					}
				}
				return result ? 1 : 0;
			}
			return left;
		};

		const parseAddSub = (): string | number => {
			let left = parseMulDiv();
			while (peek() === "+" || peek() === "-") {
				const op = consume();
				const right = parseMulDiv();
				const l = toNum(left);
				const r = toNum(right);
				if (l === null || r === null) {
					ctx.stderr.writeln("expr: non-integer argument");
					return 0;
				}
				left = op === "+" ? l + r : l - r;
			}
			return left;
		};

		const parseMulDiv = (): string | number => {
			let left = parseMatch();
			while (peek() === "*" || peek() === "/" || peek() === "%") {
				const op = consume();
				const right = parseMatch();
				const l = toNum(left);
				const r = toNum(right);
				if (l === null || r === null) {
					ctx.stderr.writeln("expr: non-integer argument");
					return 0;
				}
				if ((op === "/" || op === "%") && r === 0) {
					ctx.stderr.writeln("expr: division by zero");
					return 0;
				}
				if (op === "*") left = l * r;
				else if (op === "/") left = Math.trunc(l / r);
				else left = l % r;
			}
			return left;
		};

		const parseMatch = (): string | number => {
			const left = parsePrimary();
			if (peek() === ":") {
				consume();
				const pattern = String(parsePrimary());
				const str = String(left);
				// Match anchored at start
				const re = new RegExp(`^${pattern}`);
				const m = str.match(re);
				if (m) {
					if (m[1] !== undefined) {
						return m[1];
					}
					return m[0].length;
				}
				return 0;
			}
			// string operations
			if (peek() === "match") {
				consume();
				const pattern = String(parsePrimary());
				const str = String(left);
				const re = new RegExp(`^${pattern}`);
				const m = str.match(re);
				if (m) {
					if (m[1] !== undefined) return m[1];
					return m[0].length;
				}
				return 0;
			}
			if (peek() === "substr") {
				consume();
				const posArg = parsePrimary();
				const lenArg = parsePrimary();
				const str = String(left);
				const p = (toNum(posArg) ?? 1) - 1;
				const l = toNum(lenArg) ?? 0;
				return str.slice(p, p + l);
			}
			if (peek() === "index") {
				consume();
				const chars = String(parsePrimary());
				const str = String(left);
				for (let j = 0; j < str.length; j++) {
					if (chars.includes(str[j])) return j + 1;
				}
				return 0;
			}
			if (peek() === "length") {
				consume();
				return String(left).length;
			}
			return left;
		};

		const parsePrimary = (): string | number => {
			const tok = peek();
			if (tok === "(") {
				consume();
				const val = parseOr();
				if (peek() === ")") consume();
				return val;
			}
			if (tok === "length") {
				consume();
				const val = parsePrimary();
				return String(val).length;
			}
			if (tok === undefined) {
				return "";
			}
			return consume();
		};

		const toNum = (val: string | number): number | null => {
			if (typeof val === "number") return val;
			const n = Number.parseInt(val, 10);
			if (Number.isNaN(n) || String(n) !== val.trim()) return null;
			return n;
		};

		const isTruthy = (val: string | number): boolean => {
			if (typeof val === "number") return val !== 0;
			return val !== "" && val !== "0";
		};

		try {
			const result = parseOr();
			ctx.stdout.writeln(String(result));
			return isTruthy(result) ? 0 : 1;
		} catch {
			ctx.stderr.writeln("expr: syntax error");
			return 2;
		}
	})
	.toHandler();
