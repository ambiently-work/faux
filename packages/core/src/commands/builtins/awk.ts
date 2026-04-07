import { command } from "../builder.js";

// ---- Types ----

type AwkValue = string | number;

interface AwkRule {
	pattern: AwkPattern | null;
	action: AwkStatement[];
}

type AwkPattern =
	| { type: "BEGIN" }
	| { type: "END" }
	| { type: "regex"; regex: RegExp }
	| { type: "expr"; expr: AwkExpr }
	| { type: "range"; start: AwkExpr; end: AwkExpr };

type AwkExpr =
	| { type: "number"; value: number }
	| { type: "string"; value: string }
	| { type: "field"; index: AwkExpr }
	| { type: "var"; name: string }
	| { type: "array_access"; name: string; index: AwkExpr }
	| { type: "assign"; target: AwkExpr; value: AwkExpr }
	| { type: "assign_op"; op: string; target: AwkExpr; value: AwkExpr }
	| { type: "binop"; op: string; left: AwkExpr; right: AwkExpr }
	| { type: "unary"; op: string; expr: AwkExpr }
	| { type: "incr"; expr: AwkExpr; pre: boolean }
	| { type: "decr"; expr: AwkExpr; pre: boolean }
	| { type: "match"; expr: AwkExpr; regex: RegExp; negate: boolean }
	| { type: "regex_literal"; regex: RegExp }
	| { type: "ternary"; cond: AwkExpr; then: AwkExpr; else: AwkExpr }
	| { type: "concat"; parts: AwkExpr[] }
	| { type: "call"; name: string; args: AwkExpr[] }
	| { type: "in"; name: string; index: AwkExpr }
	| { type: "getline" }
	| { type: "pipe_getline"; cmd: AwkExpr };

type AwkStatement =
	| { type: "expr"; expr: AwkExpr }
	| { type: "print"; args: AwkExpr[]; dest?: AwkExpr }
	| { type: "printf"; format: AwkExpr; args: AwkExpr[]; dest?: AwkExpr }
	| { type: "if"; cond: AwkExpr; then: AwkStatement[]; else?: AwkStatement[] }
	| { type: "while"; cond: AwkExpr; body: AwkStatement[] }
	| {
			type: "for";
			init: AwkStatement | null;
			cond: AwkExpr | null;
			incr: AwkStatement | null;
			body: AwkStatement[];
	  }
	| { type: "for_in"; varName: string; arrayName: string; body: AwkStatement[] }
	| { type: "do_while"; body: AwkStatement[]; cond: AwkExpr }
	| { type: "break" }
	| { type: "continue" }
	| { type: "next" }
	| { type: "exit"; code?: AwkExpr }
	| { type: "return"; value?: AwkExpr }
	| { type: "delete"; name: string; index: AwkExpr };

class BreakSignal {}
class ContinueSignal {}
class NextSignal {}
class ExitSignal {
	constructor(public code: number) {}
}
class ReturnSignal {
	constructor(public value: AwkValue) {}
}

// ---- Tokenizer ----

interface Token {
	type: string;
	value: string;
}

function tokenize(src: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	const isIdChar = (c: string): boolean => /[a-zA-Z_0-9]/.test(c);
	const isDigit = (c: string): boolean => /[0-9]/.test(c);

	while (i < src.length) {
		// Skip whitespace (but not newlines, they matter)
		if (src[i] === " " || src[i] === "\t" || src[i] === "\r") {
			i++;
			continue;
		}

		// Comments
		if (src[i] === "#") {
			while (i < src.length && src[i] !== "\n") i++;
			continue;
		}

		// Newlines and semicolons are statement terminators
		if (src[i] === "\n" || src[i] === ";") {
			tokens.push({ type: "NEWLINE", value: src[i] });
			i++;
			continue;
		}

		// Strings
		if (src[i] === '"') {
			let s = "";
			i++;
			while (i < src.length && src[i] !== '"') {
				if (src[i] === "\\" && i + 1 < src.length) {
					i++;
					switch (src[i]) {
						case "n":
							s += "\n";
							break;
						case "t":
							s += "\t";
							break;
						case "\\":
							s += "\\";
							break;
						case '"':
							s += '"';
							break;
						case "/":
							s += "/";
							break;
						case "a":
							s += "\x07";
							break;
						case "b":
							s += "\b";
							break;
						case "r":
							s += "\r";
							break;
						default:
							s += "\\" + src[i];
					}
				} else {
					s += src[i];
				}
				i++;
			}
			if (i < src.length) i++; // skip closing quote
			tokens.push({ type: "STRING", value: s });
			continue;
		}

		// Regex
		if (src[i] === "/") {
			// Determine if this is a regex or division
			const prev = tokens.length > 0 ? tokens[tokens.length - 1] : null;
			const isRegex =
				!prev ||
				prev.type === "NEWLINE" ||
				prev.type === "OP" ||
				prev.value === "(" ||
				prev.value === "," ||
				prev.value === "!" ||
				prev.value === "~" ||
				prev.value === "{" ||
				prev.value === "||" ||
				prev.value === "&&" ||
				prev.value === "BEGIN" ||
				prev.value === "END";

			if (isRegex) {
				let pattern = "";
				i++; // skip opening /
				while (i < src.length && src[i] !== "/") {
					if (src[i] === "\\" && i + 1 < src.length) {
						pattern += src[i] + src[i + 1];
						i += 2;
					} else {
						pattern += src[i];
						i++;
					}
				}
				if (i < src.length) i++; // skip closing /
				tokens.push({ type: "REGEX", value: pattern });
				continue;
			}
		}

		// Numbers
		if (isDigit(src[i]) || (src[i] === "." && i + 1 < src.length && isDigit(src[i + 1]))) {
			let num = "";
			if (src[i] === "0" && i + 1 < src.length && (src[i + 1] === "x" || src[i + 1] === "X")) {
				num = "0x";
				i += 2;
				while (i < src.length && /[0-9a-fA-F]/.test(src[i])) {
					num += src[i];
					i++;
				}
			} else {
				while (i < src.length && (isDigit(src[i]) || src[i] === ".")) {
					num += src[i];
					i++;
				}
				if (i < src.length && (src[i] === "e" || src[i] === "E")) {
					num += src[i];
					i++;
					if (i < src.length && (src[i] === "+" || src[i] === "-")) {
						num += src[i];
						i++;
					}
					while (i < src.length && isDigit(src[i])) {
						num += src[i];
						i++;
					}
				}
			}
			tokens.push({ type: "NUMBER", value: num });
			continue;
		}

		// Identifiers and keywords
		if (/[a-zA-Z_]/.test(src[i])) {
			let id = "";
			while (i < src.length && isIdChar(src[i])) {
				id += src[i];
				i++;
			}
			const keywords = [
				"BEGIN",
				"END",
				"if",
				"else",
				"while",
				"for",
				"do",
				"break",
				"continue",
				"next",
				"exit",
				"return",
				"delete",
				"in",
				"print",
				"printf",
				"getline",
				"function",
			];
			if (keywords.includes(id)) {
				tokens.push({ type: id.toUpperCase(), value: id });
			} else {
				tokens.push({ type: "IDENT", value: id });
			}
			continue;
		}

		// Operators
		const twoChar = src.slice(i, i + 2);
		const threeChar = src.slice(i, i + 3);

		if (
			[
				"!~",
				"+=",
				"-=",
				"*=",
				"/=",
				"%=",
				"^=",
				"==",
				"!=",
				"<=",
				">=",
				"&&",
				"||",
				"++",
				"--",
				">>",
				"**",
			].includes(twoChar)
		) {
			tokens.push({ type: "OP", value: twoChar });
			i += 2;
			continue;
		}

		if ("+-*/%^<>=!~?:,{}()[]|$@".includes(src[i])) {
			tokens.push({ type: "OP", value: src[i] });
			i++;
			continue;
		}

		// Skip unknown characters
		i++;
	}

	return tokens;
}

// ---- Parser ----

class Parser {
	tokens: Token[];
	pos: number;

	constructor(tokens: Token[]) {
		this.tokens = tokens;
		this.pos = 0;
	}

	peek(): Token | null {
		return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
	}

	consume(): Token {
		return this.tokens[this.pos++];
	}

	expect(value: string): void {
		const t = this.consume();
		if (!t || t.value !== value) {
			throw new Error(`Expected '${value}', got '${t?.value ?? "EOF"}'`);
		}
	}

	skipNewlines(): void {
		while (this.peek()?.type === "NEWLINE") this.consume();
	}

	match(value: string): boolean {
		if (this.peek()?.value === value) {
			this.consume();
			return true;
		}
		return false;
	}

	parseProgram(): AwkRule[] {
		const rules: AwkRule[] = [];
		this.skipNewlines();

		while (this.pos < this.tokens.length) {
			this.skipNewlines();
			if (this.pos >= this.tokens.length) break;

			const tok = this.peek()!;

			if (tok.type === "BEGIN") {
				this.consume();
				this.skipNewlines();
				const action = this.parseBlock();
				rules.push({ pattern: { type: "BEGIN" }, action });
			} else if (tok.type === "END") {
				this.consume();
				this.skipNewlines();
				const action = this.parseBlock();
				rules.push({ pattern: { type: "END" }, action });
			} else if (tok.value === "{") {
				const action = this.parseBlock();
				rules.push({ pattern: null, action });
			} else if (tok.type === "REGEX") {
				this.consume();
				this.skipNewlines();
				let action: AwkStatement[];
				if (this.peek()?.value === "{") {
					action = this.parseBlock();
				} else {
					action = [
						{ type: "print", args: [{ type: "field", index: { type: "number", value: 0 } }] },
					];
				}
				rules.push({
					pattern: { type: "regex", regex: new RegExp(tok.value) },
					action,
				});
			} else if (tok.type === "FUNCTION") {
				// Skip function definitions for now (simplified)
				this.consume();
				this.consume(); // name
				this.expect("(");
				while (this.peek()?.value !== ")") this.consume();
				this.expect(")");
				this.parseBlock();
			} else {
				// Expression pattern
				const expr = this.parseExpr();
				this.skipNewlines();
				let action: AwkStatement[];
				if (this.peek()?.value === ",") {
					// Range pattern
					this.consume();
					this.skipNewlines();
					const end = this.parseExpr();
					this.skipNewlines();
					if (this.peek()?.value === "{") {
						action = this.parseBlock();
					} else {
						action = [
							{ type: "print", args: [{ type: "field", index: { type: "number", value: 0 } }] },
						];
					}
					rules.push({ pattern: { type: "range", start: expr, end }, action });
				} else if (this.peek()?.value === "{") {
					action = this.parseBlock();
					rules.push({ pattern: { type: "expr", expr }, action });
				} else {
					action = [
						{ type: "print", args: [{ type: "field", index: { type: "number", value: 0 } }] },
					];
					rules.push({ pattern: { type: "expr", expr }, action });
				}
			}

			this.skipNewlines();
		}

		return rules;
	}

	parseBlock(): AwkStatement[] {
		this.skipNewlines();
		this.expect("{");
		const stmts = this.parseStatements();
		this.skipNewlines();
		this.expect("}");
		return stmts;
	}

	parseStatements(): AwkStatement[] {
		const stmts: AwkStatement[] = [];
		this.skipNewlines();
		while (this.peek() && this.peek()!.value !== "}") {
			this.skipNewlines();
			if (this.peek()?.value === "}") break;
			const stmt = this.parseStatement();
			if (stmt) stmts.push(stmt);
			this.skipNewlines();
		}
		return stmts;
	}

	parseStatement(): AwkStatement | null {
		const tok = this.peek();
		if (!tok) return null;

		if (tok.type === "PRINT") {
			return this.parsePrint();
		}
		if (tok.type === "PRINTF") {
			return this.parsePrintf();
		}
		if (tok.type === "IF") {
			return this.parseIf();
		}
		if (tok.type === "WHILE") {
			return this.parseWhile();
		}
		if (tok.type === "FOR") {
			return this.parseFor();
		}
		if (tok.type === "DO") {
			return this.parseDoWhile();
		}
		if (tok.type === "BREAK") {
			this.consume();
			return { type: "break" };
		}
		if (tok.type === "CONTINUE") {
			this.consume();
			return { type: "continue" };
		}
		if (tok.type === "NEXT") {
			this.consume();
			return { type: "next" };
		}
		if (tok.type === "EXIT") {
			this.consume();
			let code: AwkExpr | undefined;
			if (
				this.peek() &&
				this.peek()!.type !== "NEWLINE" &&
				this.peek()!.value !== "}" &&
				this.peek()!.value !== ";"
			) {
				code = this.parseExpr();
			}
			return { type: "exit", code };
		}
		if (tok.type === "RETURN") {
			this.consume();
			let value: AwkExpr | undefined;
			if (
				this.peek() &&
				this.peek()!.type !== "NEWLINE" &&
				this.peek()!.value !== "}" &&
				this.peek()!.value !== ";"
			) {
				value = this.parseExpr();
			}
			return { type: "return", value };
		}
		if (tok.type === "DELETE") {
			this.consume();
			const name = this.consume().value;
			this.expect("[");
			const index = this.parseExpr();
			this.expect("]");
			return { type: "delete", name, index };
		}
		if (tok.value === "{") {
			const stmts = this.parseBlock();
			// Flatten a block into individual statements would complicate things
			// Just return the first for simplicity, or wrap
			return stmts.length === 1
				? stmts[0]
				: { type: "if", cond: { type: "number", value: 1 }, then: stmts };
		}

		const expr = this.parseExpr();
		return { type: "expr", expr };
	}

	parsePrint(): AwkStatement {
		this.consume(); // "print"
		const args: AwkExpr[] = [];
		let dest: AwkExpr | undefined;

		if (
			this.peek() &&
			this.peek()!.type !== "NEWLINE" &&
			this.peek()!.value !== ";" &&
			this.peek()!.value !== "}" &&
			this.peek()!.value !== "|" &&
			this.peek()!.value !== ">"
		) {
			args.push(this.parseExpr());
			while (this.peek()?.value === ",") {
				this.consume();
				args.push(this.parseExpr());
			}
		}

		if (this.peek()?.value === ">" || this.peek()?.value === ">>") {
			this.consume();
			dest = this.parsePrimary();
		}

		if (args.length === 0) {
			args.push({ type: "field", index: { type: "number", value: 0 } });
		}

		return { type: "print", args, dest };
	}

	parsePrintf(): AwkStatement {
		this.consume(); // "printf"
		const format = this.parseExpr();
		const args: AwkExpr[] = [];
		let dest: AwkExpr | undefined;

		while (this.peek()?.value === ",") {
			this.consume();
			if (this.peek()?.value === ">" || this.peek()?.value === ">>") break;
			args.push(this.parseExpr());
		}

		if (this.peek()?.value === ">" || this.peek()?.value === ">>") {
			this.consume();
			dest = this.parsePrimary();
		}

		return { type: "printf", format, args, dest };
	}

	parseIf(): AwkStatement {
		this.consume(); // "if"
		this.skipNewlines();
		this.expect("(");
		const cond = this.parseExpr();
		this.expect(")");
		this.skipNewlines();

		let thenStmts: AwkStatement[];
		if (this.peek()?.value === "{") {
			thenStmts = this.parseBlock();
		} else {
			const s = this.parseStatement();
			thenStmts = s ? [s] : [];
		}

		this.skipNewlines();
		let elseStmts: AwkStatement[] | undefined;
		if (this.peek()?.type === "ELSE") {
			this.consume();
			this.skipNewlines();
			if (this.peek()?.value === "{") {
				elseStmts = this.parseBlock();
			} else {
				const s = this.parseStatement();
				elseStmts = s ? [s] : [];
			}
		}

		return { type: "if", cond, then: thenStmts, else: elseStmts };
	}

	parseWhile(): AwkStatement {
		this.consume(); // "while"
		this.skipNewlines();
		this.expect("(");
		const cond = this.parseExpr();
		this.expect(")");
		this.skipNewlines();

		let body: AwkStatement[];
		if (this.peek()?.value === "{") {
			body = this.parseBlock();
		} else {
			const s = this.parseStatement();
			body = s ? [s] : [];
		}

		return { type: "while", cond, body };
	}

	parseFor(): AwkStatement {
		this.consume(); // "for"
		this.skipNewlines();
		this.expect("(");

		// Check for for-in
		const saved = this.pos;
		if (this.peek()?.type === "IDENT") {
			const varName = this.peek()!.value;
			this.consume();
			if (this.peek()?.type === "IN") {
				this.consume();
				const arrayName = this.consume().value;
				this.expect(")");
				this.skipNewlines();
				let body: AwkStatement[];
				if (this.peek()?.value === "{") {
					body = this.parseBlock();
				} else {
					const s = this.parseStatement();
					body = s ? [s] : [];
				}
				return { type: "for_in", varName, arrayName, body };
			}
			this.pos = saved;
		}

		// Regular for
		let init: AwkStatement | null = null;
		if (this.peek()?.value !== ";") {
			const expr = this.parseExpr();
			init = { type: "expr", expr };
		}
		this.expect(";");

		let cond: AwkExpr | null = null;
		if (this.peek()?.value !== ";") {
			cond = this.parseExpr();
		}
		this.expect(";");

		let incr: AwkStatement | null = null;
		if (this.peek()?.value !== ")") {
			const expr = this.parseExpr();
			incr = { type: "expr", expr };
		}
		this.expect(")");
		this.skipNewlines();

		let body: AwkStatement[];
		if (this.peek()?.value === "{") {
			body = this.parseBlock();
		} else {
			const s = this.parseStatement();
			body = s ? [s] : [];
		}

		return { type: "for", init, cond, incr, body };
	}

	parseDoWhile(): AwkStatement {
		this.consume(); // "do"
		this.skipNewlines();
		let body: AwkStatement[];
		if (this.peek()?.value === "{") {
			body = this.parseBlock();
		} else {
			const s = this.parseStatement();
			body = s ? [s] : [];
		}
		this.skipNewlines();
		this.expect("while");
		this.expect("(");
		const cond = this.parseExpr();
		this.expect(")");
		return { type: "do_while", body, cond };
	}

	parseExpr(): AwkExpr {
		return this.parseAssign();
	}

	parseAssign(): AwkExpr {
		const left = this.parseTernary();
		const tok = this.peek();
		if (tok?.value === "=") {
			this.consume();
			const right = this.parseAssign();
			return { type: "assign", target: left, value: right };
		}
		if (tok && ["+=", "-=", "*=", "/=", "%=", "^="].includes(tok.value)) {
			this.consume();
			const right = this.parseAssign();
			return { type: "assign_op", op: tok.value, target: left, value: right };
		}
		return left;
	}

	parseTernary(): AwkExpr {
		const cond = this.parseOr();
		if (this.peek()?.value === "?") {
			this.consume();
			const then = this.parseExpr();
			this.expect(":");
			const els = this.parseExpr();
			return { type: "ternary", cond, then, else: els };
		}
		return cond;
	}

	parseOr(): AwkExpr {
		let left = this.parseAnd();
		while (this.peek()?.value === "||") {
			this.consume();
			const right = this.parseAnd();
			left = { type: "binop", op: "||", left, right };
		}
		return left;
	}

	parseAnd(): AwkExpr {
		let left = this.parseIn();
		while (this.peek()?.value === "&&") {
			this.consume();
			const right = this.parseIn();
			left = { type: "binop", op: "&&", left, right };
		}
		return left;
	}

	parseIn(): AwkExpr {
		const left = this.parseMatch();
		if (this.peek()?.type === "IN") {
			this.consume();
			const name = this.consume().value;
			return { type: "in", name, index: left };
		}
		return left;
	}

	parseMatch(): AwkExpr {
		let left = this.parseComparison();
		while (this.peek()?.value === "~" || this.peek()?.value === "!~") {
			const negate = this.consume().value === "!~";
			const tok = this.peek();
			if (tok?.type === "REGEX") {
				this.consume();
				left = { type: "match", expr: left, regex: new RegExp(tok.value), negate };
			} else {
				const right = this.parseComparison();
				// Dynamic regex from expression
				left = { type: "match", expr: left, regex: /(?:)/, negate };
				// Store the expr for runtime evaluation
				(left as any).dynRegex = right;
			}
		}
		return left;
	}

	parseComparison(): AwkExpr {
		const left = this.parseConcatOrAdd();
		const tok = this.peek();
		if (tok && ["<", "<=", ">", ">=", "==", "!="].includes(tok.value)) {
			this.consume();
			const right = this.parseConcatOrAdd();
			return { type: "binop", op: tok.value, left, right };
		}
		return left;
	}

	parseConcatOrAdd(): AwkExpr {
		let left = this.parseMulDiv();
		while (true) {
			const tok = this.peek();
			if (tok?.value === "+") {
				this.consume();
				const right = this.parseMulDiv();
				left = { type: "binop", op: "+", left, right };
			} else if (tok?.value === "-") {
				this.consume();
				const right = this.parseMulDiv();
				left = { type: "binop", op: "-", left, right };
			} else if (
				tok &&
				tok.type !== "NEWLINE" &&
				tok.value !== ";" &&
				tok.value !== "}" &&
				tok.value !== ")" &&
				tok.value !== "]" &&
				tok.value !== "," &&
				tok.value !== ">" &&
				tok.value !== ">>" &&
				tok.value !== "|" &&
				tok.value !== "?" &&
				tok.value !== ":" &&
				tok.value !== "~" &&
				tok.value !== "!~" &&
				![
					"<",
					"<=",
					">=",
					"==",
					"!=",
					"&&",
					"||",
					"=",
					"+=",
					"-=",
					"*=",
					"/=",
					"%=",
					"^=",
				].includes(tok.value) &&
				tok.type !== "IN" &&
				tok.type !== "ELSE" &&
				(tok.type === "STRING" ||
					tok.type === "IDENT" ||
					tok.type === "NUMBER" ||
					tok.value === "$" ||
					tok.value === "(")
			) {
				// String concatenation
				const right = this.parseMulDiv();
				left = { type: "binop", op: "CONCAT", left, right };
			} else {
				break;
			}
		}
		return left;
	}

	parseMulDiv(): AwkExpr {
		let left = this.parsePower();
		while (this.peek()?.value === "*" || this.peek()?.value === "/" || this.peek()?.value === "%") {
			const op = this.consume().value;
			const right = this.parsePower();
			left = { type: "binop", op, left, right };
		}
		return left;
	}

	parsePower(): AwkExpr {
		let base = this.parseUnary();
		if (this.peek()?.value === "^" || this.peek()?.value === "**") {
			this.consume();
			const exp = this.parseUnary();
			base = { type: "binop", op: "^", left: base, right: exp };
		}
		return base;
	}

	parseUnary(): AwkExpr {
		const tok = this.peek();
		if (tok?.value === "-") {
			this.consume();
			return { type: "unary", op: "-", expr: this.parsePostfix() };
		}
		if (tok?.value === "+") {
			this.consume();
			return this.parsePostfix();
		}
		if (tok?.value === "!") {
			this.consume();
			return { type: "unary", op: "!", expr: this.parseUnary() };
		}
		if (tok?.value === "++") {
			this.consume();
			return { type: "incr", expr: this.parsePostfix(), pre: true };
		}
		if (tok?.value === "--") {
			this.consume();
			return { type: "decr", expr: this.parsePostfix(), pre: true };
		}
		return this.parsePostfix();
	}

	parsePostfix(): AwkExpr {
		const expr = this.parsePrimary();
		if (this.peek()?.value === "++") {
			this.consume();
			return { type: "incr", expr, pre: false };
		}
		if (this.peek()?.value === "--") {
			this.consume();
			return { type: "decr", expr, pre: false };
		}
		return expr;
	}

	parsePrimary(): AwkExpr {
		const tok = this.peek();
		if (!tok) throw new Error("Unexpected end of expression");

		if (tok.value === "$") {
			this.consume();
			const index = this.parsePrimary();
			return { type: "field", index };
		}

		if (tok.value === "(") {
			this.consume();
			const expr = this.parseExpr();
			this.expect(")");
			return expr;
		}

		if (tok.type === "NUMBER") {
			this.consume();
			return { type: "number", value: Number(tok.value) };
		}

		if (tok.type === "STRING") {
			this.consume();
			return { type: "string", value: tok.value };
		}

		if (tok.type === "REGEX") {
			this.consume();
			return { type: "regex_literal", regex: new RegExp(tok.value) };
		}

		if (tok.type === "GETLINE") {
			this.consume();
			return { type: "getline" };
		}

		if (tok.type === "IDENT") {
			const name = tok.value;
			this.consume();

			// Function call
			if (this.peek()?.value === "(") {
				this.consume();
				const args: AwkExpr[] = [];
				if (this.peek()?.value !== ")") {
					args.push(this.parseExpr());
					while (this.peek()?.value === ",") {
						this.consume();
						args.push(this.parseExpr());
					}
				}
				this.expect(")");
				return { type: "call", name, args };
			}

			// Array access
			if (this.peek()?.value === "[") {
				this.consume();
				const index = this.parseExpr();
				this.expect("]");
				return { type: "array_access", name, index };
			}

			return { type: "var", name };
		}

		// Skip unknown token
		this.consume();
		return { type: "number", value: 0 };
	}
}

// ---- Runtime ----

class AwkRuntime {
	vars: Map<string, AwkValue> = new Map();
	arrays: Map<string, Map<string, AwkValue>> = new Map();
	fields: string[] = [];
	lines: string[] = [];
	lineIdx: number = 0;
	outputParts: string[] = [];
	errorParts: string[] = [];

	constructor(
		private fieldSep: string | RegExp,
		private assignVars: Map<string, string>,
	) {
		this.vars.set("FS", typeof fieldSep === "string" ? fieldSep : " ");
		this.vars.set("RS", "\n");
		this.vars.set("OFS", " ");
		this.vars.set("ORS", "\n");
		this.vars.set("NR", 0);
		this.vars.set("NF", 0);
		this.vars.set("FNR", 0);
		this.vars.set("FILENAME", "");
		this.vars.set("SUBSEP", "\x1c");

		for (const [k, v] of assignVars) {
			this.vars.set(k, v);
		}
	}

	setRecord(line: string): void {
		this.vars.set("NR", this.toNum(this.vars.get("NR")) + 1);
		this.vars.set("FNR", this.toNum(this.vars.get("FNR")) + 1);
		this.splitRecord(line);
	}

	splitRecord(line: string): void {
		const fs = this.toStr(this.vars.get("FS"));
		let parts: string[];
		if (fs === " ") {
			parts = line.trim().split(/\s+/);
			if (parts.length === 1 && parts[0] === "") parts = [];
		} else if (fs.length === 1) {
			parts = line.split(fs);
		} else {
			try {
				parts = line.split(new RegExp(fs));
			} catch {
				parts = line.split(fs);
			}
		}

		this.fields = [line, ...parts];
		this.vars.set("NF", parts.length);
	}

	getField(idx: number): string {
		if (idx === 0) return this.fields[0] ?? "";
		return this.fields[idx] ?? "";
	}

	setField(idx: number, val: string): void {
		while (this.fields.length <= idx) {
			this.fields.push("");
		}
		this.fields[idx] = val;
		// Rebuild $0
		const ofs = this.toStr(this.vars.get("OFS"));
		this.fields[0] = this.fields.slice(1).join(ofs);
		this.vars.set("NF", this.fields.length - 1);
	}

	evalExpr(expr: AwkExpr): AwkValue {
		switch (expr.type) {
			case "number":
				return expr.value;
			case "string":
				return expr.value;
			case "field":
				return this.getField(Math.trunc(this.toNum(this.evalExpr(expr.index))));
			case "var":
				return this.vars.get(expr.name) ?? "";
			case "array_access": {
				const arr = this.arrays.get(expr.name);
				const key = this.toStr(this.evalExpr(expr.index));
				return arr?.get(key) ?? "";
			}
			case "assign": {
				const val = this.evalExpr(expr.value);
				this.assignTo(expr.target, val);
				return val;
			}
			case "assign_op": {
				const current = this.toNum(this.evalExpr(expr.target));
				const rhs = this.toNum(this.evalExpr(expr.value));
				let result: number;
				switch (expr.op) {
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
						result = rhs === 0 ? 0 : current / rhs;
						break;
					case "%=":
						result = rhs === 0 ? 0 : current % rhs;
						break;
					case "^=":
						result = current ** rhs;
						break;
					default:
						result = rhs;
				}
				this.assignTo(expr.target, result);
				return result;
			}
			case "binop":
				return this.evalBinop(expr.op, expr.left, expr.right);
			case "unary": {
				const val = this.evalExpr(expr.expr);
				if (expr.op === "-") return -this.toNum(val);
				if (expr.op === "!") return this.isTruthy(val) ? 0 : 1;
				return val;
			}
			case "incr": {
				const cur = this.toNum(this.evalExpr(expr.expr));
				this.assignTo(expr.expr, cur + 1);
				return expr.pre ? cur + 1 : cur;
			}
			case "decr": {
				const cur = this.toNum(this.evalExpr(expr.expr));
				this.assignTo(expr.expr, cur - 1);
				return expr.pre ? cur - 1 : cur;
			}
			case "match": {
				const str = this.toStr(this.evalExpr(expr.expr));
				let regex = expr.regex;
				if ((expr as any).dynRegex) {
					regex = new RegExp(this.toStr(this.evalExpr((expr as any).dynRegex)));
				}
				const result = regex.test(str);
				return result !== expr.negate ? 1 : 0;
			}
			case "regex_literal": {
				// When used as an expression, match against $0
				return expr.regex.test(this.getField(0)) ? 1 : 0;
			}
			case "ternary": {
				return this.isTruthy(this.evalExpr(expr.cond))
					? this.evalExpr(expr.then)
					: this.evalExpr(expr.else);
			}
			case "concat": {
				return expr.parts.map((p) => this.toStr(this.evalExpr(p))).join("");
			}
			case "in": {
				const key = this.toStr(this.evalExpr(expr.index));
				const arr = this.arrays.get(expr.name);
				return arr?.has(key) ? 1 : 0;
			}
			case "call":
				return this.callFunction(expr.name, expr.args);
			case "getline":
				return 0; // simplified
			default:
				return "";
		}
	}

	evalBinop(op: string, leftExpr: AwkExpr, rightExpr: AwkExpr): AwkValue {
		if (op === "||") {
			return this.isTruthy(this.evalExpr(leftExpr))
				? 1
				: this.isTruthy(this.evalExpr(rightExpr))
					? 1
					: 0;
		}
		if (op === "&&") {
			return this.isTruthy(this.evalExpr(leftExpr)) && this.isTruthy(this.evalExpr(rightExpr))
				? 1
				: 0;
		}

		const left = this.evalExpr(leftExpr);
		const right = this.evalExpr(rightExpr);

		if (op === "CONCAT") {
			return this.toStr(left) + this.toStr(right);
		}

		// Comparison operators
		if (["<", "<=", ">", ">=", "==", "!="].includes(op)) {
			const ln = this.toNum(left);
			const rn = this.toNum(right);
			const bothNumeric =
				(typeof left === "number" && typeof right === "number") ||
				(typeof left === "string" &&
					/^-?\d+\.?\d*$/.test(left) &&
					typeof right === "string" &&
					/^-?\d+\.?\d*$/.test(right)) ||
				typeof left === "number" ||
				typeof right === "number";

			if (bothNumeric && !Number.isNaN(ln) && !Number.isNaN(rn)) {
				switch (op) {
					case "<":
						return ln < rn ? 1 : 0;
					case "<=":
						return ln <= rn ? 1 : 0;
					case ">":
						return ln > rn ? 1 : 0;
					case ">=":
						return ln >= rn ? 1 : 0;
					case "==":
						return ln === rn ? 1 : 0;
					case "!=":
						return ln !== rn ? 1 : 0;
				}
			}
			const ls = this.toStr(left);
			const rs = this.toStr(right);
			switch (op) {
				case "<":
					return ls < rs ? 1 : 0;
				case "<=":
					return ls <= rs ? 1 : 0;
				case ">":
					return ls > rs ? 1 : 0;
				case ">=":
					return ls >= rs ? 1 : 0;
				case "==":
					return ls === rs ? 1 : 0;
				case "!=":
					return ls !== rs ? 1 : 0;
			}
		}

		// Arithmetic
		const ln = this.toNum(left);
		const rn = this.toNum(right);
		switch (op) {
			case "+":
				return ln + rn;
			case "-":
				return ln - rn;
			case "*":
				return ln * rn;
			case "/":
				return rn === 0 ? 0 : ln / rn;
			case "%":
				return rn === 0 ? 0 : ln % rn;
			case "^":
				return ln ** rn;
		}

		return "";
	}

	assignTo(target: AwkExpr, value: AwkValue): void {
		if (target.type === "var") {
			this.vars.set(target.name, value);
		} else if (target.type === "field") {
			const idx = Math.trunc(this.toNum(this.evalExpr(target.index)));
			this.setField(idx, this.toStr(value));
		} else if (target.type === "array_access") {
			if (!this.arrays.has(target.name)) {
				this.arrays.set(target.name, new Map());
			}
			const key = this.toStr(this.evalExpr(target.index));
			this.arrays.get(target.name)!.set(key, value);
		}
	}

	callFunction(name: string, argExprs: AwkExpr[]): AwkValue {
		const args = argExprs.map((a) => this.evalExpr(a));

		switch (name) {
			case "length": {
				if (args.length === 0) return this.getField(0).length;
				return this.toStr(args[0]).length;
			}
			case "substr": {
				const str = this.toStr(args[0]);
				const start = Math.max(1, Math.trunc(this.toNum(args[1]))) - 1;
				const len = args.length > 2 ? Math.trunc(this.toNum(args[2])) : str.length - start;
				return str.slice(start, start + len);
			}
			case "index": {
				const str = this.toStr(args[0]);
				const target = this.toStr(args[1]);
				const idx = str.indexOf(target);
				return idx < 0 ? 0 : idx + 1;
			}
			case "split": {
				const str = this.toStr(args[0]);
				const arrName =
					argExprs[1]?.type === "var"
						? argExprs[1].name
						: argExprs[1]?.type === "array_access"
							? argExprs[1].name
							: "ARGV";
				const sep = args.length > 2 ? this.toStr(args[2]) : this.toStr(this.vars.get("FS"));
				let parts: string[];
				if (sep === " ") {
					parts = str.trim().split(/\s+/);
				} else {
					try {
						parts = str.split(new RegExp(sep));
					} catch {
						parts = str.split(sep);
					}
				}
				if (!this.arrays.has(arrName)) this.arrays.set(arrName, new Map());
				const arr = this.arrays.get(arrName)!;
				arr.clear();
				for (let i = 0; i < parts.length; i++) {
					arr.set(String(i + 1), parts[i]);
				}
				return parts.length;
			}
			case "sub": {
				const pattern = args.length > 0 ? this.toStr(args[0]) : "";
				const repl = args.length > 1 ? this.toStr(args[1]) : "";
				// Default target is $0
				const target =
					argExprs[2] ?? ({ type: "field", index: { type: "number", value: 0 } } as AwkExpr);
				const str = this.toStr(this.evalExpr(target));
				let regex: RegExp;
				try {
					regex = new RegExp(pattern);
				} catch {
					return 0;
				}
				const newStr = str.replace(regex, repl.replace(/&/g, "$&"));
				const changed = newStr !== str;
				this.assignTo(target, newStr);
				return changed ? 1 : 0;
			}
			case "gsub": {
				const pattern = args.length > 0 ? this.toStr(args[0]) : "";
				const repl = args.length > 1 ? this.toStr(args[1]) : "";
				const target =
					argExprs[2] ?? ({ type: "field", index: { type: "number", value: 0 } } as AwkExpr);
				const str = this.toStr(this.evalExpr(target));
				let regex: RegExp;
				try {
					regex = new RegExp(pattern, "g");
				} catch {
					return 0;
				}
				let count = 0;
				const newStr = str.replace(regex, () => {
					count++;
					return repl;
				});
				this.assignTo(target, newStr);
				return count;
			}
			case "match": {
				const str = this.toStr(args[0]);
				const pattern = this.toStr(args[1]);
				let regex: RegExp;
				try {
					regex = new RegExp(pattern);
				} catch {
					return 0;
				}
				const m = str.match(regex);
				if (m) {
					this.vars.set("RSTART", m.index! + 1);
					this.vars.set("RLENGTH", m[0].length);
					return m.index! + 1;
				}
				this.vars.set("RSTART", 0);
				this.vars.set("RLENGTH", -1);
				return 0;
			}
			case "tolower":
				return this.toStr(args[0]).toLowerCase();
			case "toupper":
				return this.toStr(args[0]).toUpperCase();
			case "sprintf":
				return this.formatStr(this.toStr(args[0]), args.slice(1));
			case "int":
				return Math.trunc(this.toNum(args[0]));
			case "sin":
				return Math.sin(this.toNum(args[0]));
			case "cos":
				return Math.cos(this.toNum(args[0]));
			case "sqrt":
				return Math.sqrt(this.toNum(args[0]));
			case "log":
				return Math.log(this.toNum(args[0]));
			case "exp":
				return Math.exp(this.toNum(args[0]));
			case "atan2":
				return Math.atan2(this.toNum(args[0]), this.toNum(args[1] ?? 0));
			case "rand":
				return Math.random();
			case "srand": {
				// In a virtual shell, srand just returns the seed
				return args.length > 0 ? this.toNum(args[0]) : 0;
			}
			case "systime":
				return Math.floor(Date.now() / 1000);
			case "strftime": {
				// Simplified
				return new Date().toISOString();
			}
			default:
				return "";
		}
	}

	execStatements(stmts: AwkStatement[]): void {
		for (const stmt of stmts) {
			this.execStatement(stmt);
		}
	}

	execStatement(stmt: AwkStatement): void {
		switch (stmt.type) {
			case "expr":
				this.evalExpr(stmt.expr);
				break;
			case "print": {
				const ofs = this.toStr(this.vars.get("OFS"));
				const ors = this.toStr(this.vars.get("ORS"));
				const values = stmt.args.map((a) => this.toStr(this.evalExpr(a)));
				const line = values.join(ofs) + ors;
				if (stmt.dest) {
					const file = this.toStr(this.evalExpr(stmt.dest));
					// In virtual shell, just output to stdout
					this.outputParts.push(line);
				} else {
					this.outputParts.push(line);
				}
				break;
			}
			case "printf": {
				const fmt = this.toStr(this.evalExpr(stmt.format));
				const args = stmt.args.map((a) => this.evalExpr(a));
				const result = this.formatStr(fmt, args);
				this.outputParts.push(result);
				break;
			}
			case "if": {
				if (this.isTruthy(this.evalExpr(stmt.cond))) {
					this.execStatements(stmt.then);
				} else if (stmt.else) {
					this.execStatements(stmt.else);
				}
				break;
			}
			case "while": {
				let iterations = 0;
				while (this.isTruthy(this.evalExpr(stmt.cond)) && iterations < 100000) {
					try {
						this.execStatements(stmt.body);
					} catch (e) {
						if (e instanceof BreakSignal) break;
						if (e instanceof ContinueSignal) {
							iterations++;
							continue;
						}
						throw e;
					}
					iterations++;
				}
				break;
			}
			case "for": {
				if (stmt.init) this.execStatement(stmt.init);
				let iterations = 0;
				while ((!stmt.cond || this.isTruthy(this.evalExpr(stmt.cond))) && iterations < 100000) {
					try {
						this.execStatements(stmt.body);
					} catch (e) {
						if (e instanceof BreakSignal) break;
						if (e instanceof ContinueSignal) {
							if (stmt.incr) this.execStatement(stmt.incr);
							iterations++;
							continue;
						}
						throw e;
					}
					if (stmt.incr) this.execStatement(stmt.incr);
					iterations++;
				}
				break;
			}
			case "for_in": {
				const arr = this.arrays.get(stmt.arrayName);
				if (arr) {
					for (const key of arr.keys()) {
						this.vars.set(stmt.varName, key);
						try {
							this.execStatements(stmt.body);
						} catch (e) {
							if (e instanceof BreakSignal) break;
							if (e instanceof ContinueSignal) continue;
							throw e;
						}
					}
				}
				break;
			}
			case "do_while": {
				let iterations = 0;
				do {
					try {
						this.execStatements(stmt.body);
					} catch (e) {
						if (e instanceof BreakSignal) break;
						if (e instanceof ContinueSignal) {
							iterations++;
							continue;
						}
						throw e;
					}
					iterations++;
				} while (this.isTruthy(this.evalExpr(stmt.cond)) && iterations < 100000);
				break;
			}
			case "break":
				throw new BreakSignal();
			case "continue":
				throw new ContinueSignal();
			case "next":
				throw new NextSignal();
			case "exit":
				throw new ExitSignal(stmt.code ? Math.trunc(this.toNum(this.evalExpr(stmt.code))) : 0);
			case "return":
				throw new ReturnSignal(stmt.value ? this.evalExpr(stmt.value) : "");
			case "delete": {
				const arr = this.arrays.get(stmt.name);
				if (arr) {
					const key = this.toStr(this.evalExpr(stmt.index));
					arr.delete(key);
				}
				break;
			}
		}
	}

	formatStr(fmt: string, args: AwkValue[]): string {
		let result = "";
		let argIdx = 0;
		let i = 0;

		while (i < fmt.length) {
			if (fmt[i] === "\\") {
				i++;
				if (i < fmt.length) {
					switch (fmt[i]) {
						case "n":
							result += "\n";
							break;
						case "t":
							result += "\t";
							break;
						case "\\":
							result += "\\";
							break;
						case '"':
							result += '"';
							break;
						default:
							result += "\\" + fmt[i];
					}
					i++;
				}
				continue;
			}

			if (fmt[i] === "%" && i + 1 < fmt.length) {
				i++;
				if (fmt[i] === "%") {
					result += "%";
					i++;
					continue;
				}

				let flags = "";
				while (i < fmt.length && "-+ 0#".includes(fmt[i])) {
					flags += fmt[i];
					i++;
				}

				let width = "";
				if (fmt[i] === "*") {
					width = String(Math.trunc(this.toNum(args[argIdx++] ?? 0)));
					i++;
				} else {
					while (i < fmt.length && /[0-9]/.test(fmt[i])) {
						width += fmt[i];
						i++;
					}
				}

				let prec = "";
				if (fmt[i] === ".") {
					i++;
					if (fmt[i] === "*") {
						prec = String(Math.trunc(this.toNum(args[argIdx++] ?? 0)));
						i++;
					} else {
						while (i < fmt.length && /[0-9]/.test(fmt[i])) {
							prec += fmt[i];
							i++;
						}
					}
				}

				const spec = fmt[i] ?? "";
				i++;

				const arg = args[argIdx++] ?? "";
				const w = width ? Number.parseInt(width, 10) : 0;
				const p = prec ? Number.parseInt(prec, 10) : -1;
				const leftAlign = flags.includes("-");
				const zeroPad = flags.includes("0");

				let formatted = "";
				switch (spec) {
					case "d":
					case "i": {
						formatted = String(Math.trunc(this.toNum(arg)));
						if (w > 0) {
							if (leftAlign) {
								formatted = formatted.padEnd(w, " ");
							} else {
								formatted = formatted.padStart(w, zeroPad ? "0" : " ");
							}
						}
						break;
					}
					case "f": {
						const n = this.toNum(arg);
						formatted = p >= 0 ? n.toFixed(p) : n.toFixed(6);
						if (w > 0) {
							if (leftAlign) {
								formatted = formatted.padEnd(w, " ");
							} else {
								formatted = formatted.padStart(w, zeroPad ? "0" : " ");
							}
						}
						break;
					}
					case "e":
					case "E": {
						const n = this.toNum(arg);
						formatted = p >= 0 ? n.toExponential(p) : n.toExponential(6);
						if (spec === "E") formatted = formatted.toUpperCase();
						if (w > 0) {
							formatted = leftAlign ? formatted.padEnd(w) : formatted.padStart(w);
						}
						break;
					}
					case "g":
					case "G": {
						const n = this.toNum(arg);
						formatted = p >= 0 ? n.toPrecision(p) : String(n);
						if (spec === "G") formatted = formatted.toUpperCase();
						if (w > 0) {
							formatted = leftAlign ? formatted.padEnd(w) : formatted.padStart(w);
						}
						break;
					}
					case "s": {
						formatted = this.toStr(arg);
						if (p >= 0) formatted = formatted.slice(0, p);
						if (w > 0) {
							formatted = leftAlign ? formatted.padEnd(w) : formatted.padStart(w);
						}
						break;
					}
					case "c": {
						const s = this.toStr(arg);
						if (s.length > 0) {
							formatted = s[0];
						} else {
							const n = this.toNum(arg);
							formatted = String.fromCharCode(n);
						}
						break;
					}
					case "o": {
						formatted = Math.trunc(this.toNum(arg)).toString(8);
						if (w > 0) {
							formatted = leftAlign
								? formatted.padEnd(w)
								: formatted.padStart(w, zeroPad ? "0" : " ");
						}
						break;
					}
					case "x":
					case "X": {
						formatted = Math.trunc(this.toNum(arg)).toString(16);
						if (spec === "X") formatted = formatted.toUpperCase();
						if (w > 0) {
							formatted = leftAlign
								? formatted.padEnd(w)
								: formatted.padStart(w, zeroPad ? "0" : " ");
						}
						break;
					}
					default:
						formatted = this.toStr(arg);
				}
				result += formatted;
			} else {
				result += fmt[i];
				i++;
			}
		}

		return result;
	}

	toNum(val: AwkValue | undefined): number {
		if (val === undefined || val === "") return 0;
		if (typeof val === "number") return val;
		const n = Number(val);
		return Number.isNaN(n) ? 0 : n;
	}

	toStr(val: AwkValue | undefined): string {
		if (val === undefined) return "";
		if (typeof val === "string") return val;
		if (Number.isInteger(val)) return String(val);
		return String(val);
	}

	isTruthy(val: AwkValue): boolean {
		if (typeof val === "number") return val !== 0;
		return val !== "" && val !== "0";
	}
}

// ---- Command ----

export const awk = command("awk")
	.description("Pattern scanning and text processing language")
	.option("-F, --field-separator <sep>", "Set field separator")
	.option("-v, --assign <var=val>", "Assign variable", { multiple: true })
	.option("-f, --file <progfile>", "Read program from file")
	.argument("[args...]", "Program and input files")
	.stopAfterFirstPositional()
	.action((ctx, { raw }) => {
		// awk has complex arg parsing: -F, -v (repeatable), -f, then first
		// non-flag arg is the program, remaining are files
		let fieldSep: string | RegExp = " ";
		let program: string | null = null;
		const assignVars = new Map<string, string>();
		const files: string[] = [];
		let i = 0;

		while (i < raw.length) {
			const arg = raw[i];
			if (arg === "-F" && i + 1 < raw.length) {
				i++;
				fieldSep = raw[i];
			} else if (arg.startsWith("-F")) {
				fieldSep = arg.slice(2);
			} else if (arg === "-v" && i + 1 < raw.length) {
				i++;
				const eq = raw[i].indexOf("=");
				if (eq >= 0) {
					assignVars.set(raw[i].slice(0, eq), raw[i].slice(eq + 1));
				}
			} else if (arg.startsWith("-v")) {
				const rest = arg.slice(2);
				const eq = rest.indexOf("=");
				if (eq >= 0) {
					assignVars.set(rest.slice(0, eq), rest.slice(eq + 1));
				}
			} else if (arg === "-f" && i + 1 < raw.length) {
				i++;
				try {
					program = ctx.fs.readFile(ctx.resolve(raw[i]));
				} catch {
					ctx.stderr.writeln(`awk: can't open file '${raw[i]}': No such file or directory`);
					return 2;
				}
			} else if (program === null && !arg.startsWith("-")) {
				program = arg;
			} else if (program !== null && !arg.startsWith("-")) {
				files.push(arg);
			}
			i++;
		}

		if (program === null) {
			ctx.stderr.writeln("awk: missing program");
			return 1;
		}

		// Parse
		let rules: AwkRule[];
		try {
			const tokens = tokenize(program);
			const parser = new Parser(tokens);
			rules = parser.parseProgram();
		} catch (e: any) {
			ctx.stderr.writeln(`awk: syntax error: ${e.message ?? e}`);
			return 2;
		}

		// Run
		const runtime = new AwkRuntime(fieldSep, assignVars);

		// BEGIN rules
		const beginRules = rules.filter((r) => r.pattern?.type === "BEGIN");
		const endRules = rules.filter((r) => r.pattern?.type === "END");
		const mainRules = rules.filter((r) => r.pattern?.type !== "BEGIN" && r.pattern?.type !== "END");

		let exitCode = 0;
		const rangeActive = new Map<number, boolean>();

		try {
			for (const rule of beginRules) {
				runtime.execStatements(rule.action);
			}

			// Get input
			let inputs: string[];
			if (files.length === 0) {
				inputs = [ctx.stdin];
			} else {
				inputs = [];
				for (const file of files) {
					if (file === "-") {
						inputs.push(ctx.stdin);
					} else {
						try {
							inputs.push(ctx.fs.readFile(ctx.resolve(file)));
							runtime.vars.set("FILENAME", file);
						} catch {
							ctx.stderr.writeln(`awk: can't open file '${file}': No such file or directory`);
							return 2;
						}
					}
				}
			}

			for (const input of inputs) {
				const rs = runtime.toStr(runtime.vars.get("RS"));
				const lines = rs === "\n" ? input.split("\n") : input.split(rs);
				if (input.endsWith(rs) && lines.length > 0 && lines[lines.length - 1] === "") {
					lines.pop();
				}

				for (const line of lines) {
					runtime.setRecord(line);

					for (let ruleIdx = 0; ruleIdx < mainRules.length; ruleIdx++) {
						const rule = mainRules[ruleIdx];
						let matches = false;

						if (rule.pattern === null) {
							matches = true;
						} else if (rule.pattern.type === "regex") {
							matches = rule.pattern.regex.test(line);
						} else if (rule.pattern.type === "expr") {
							matches = runtime.isTruthy(runtime.evalExpr(rule.pattern.expr));
						} else if (rule.pattern.type === "range") {
							const active = rangeActive.get(ruleIdx) ?? false;
							if (active) {
								matches = true;
								if (runtime.isTruthy(runtime.evalExpr(rule.pattern.end))) {
									rangeActive.set(ruleIdx, false);
								}
							} else if (runtime.isTruthy(runtime.evalExpr(rule.pattern.start))) {
								matches = true;
								rangeActive.set(ruleIdx, true);
							}
						}

						if (matches) {
							try {
								runtime.execStatements(rule.action);
							} catch (e) {
								if (e instanceof NextSignal) break;
								throw e;
							}
						}
					}
				}
			}

			// END rules
			for (const rule of endRules) {
				runtime.execStatements(rule.action);
			}
		} catch (e) {
			if (e instanceof ExitSignal) {
				exitCode = e.code;
			} else {
				ctx.stderr.writeln(`awk: runtime error: ${e}`);
				exitCode = 2;
			}
		}

		ctx.stdout.write(runtime.outputParts.join(""));
		if (runtime.errorParts.length > 0) {
			ctx.stderr.write(runtime.errorParts.join(""));
		}

		return exitCode;
	})
	.toHandler();
