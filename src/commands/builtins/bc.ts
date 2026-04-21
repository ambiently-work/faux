import { command } from "../builder.js";

export const bc = command("bc")
	.description("An arbitrary precision calculator language")
	.flag("-l, --mathlib", "Use the standard math library")
	.argument("[files...]", "Input files")
	.action((ctx, { args }) => {
		let input = ctx.stdin.trim();
		if (args.length > 0) {
			// Read from files
			const parts: string[] = [];
			for (const file of args) {
				try {
					parts.push(ctx.fs.readFile(ctx.resolve(file)));
				} catch {
					ctx.stderr.writeln(`bc: ${file}: No such file or directory`);
					return 1;
				}
			}
			if (parts.length > 0) input = parts.join("\n");
		}

		if (!input) return 0;

		let scale = 0;
		const vars = new Map<string, number>();

		const lines = input.split("\n");
		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (line === "" || line === "quit" || line === "q") continue;

			// Handle scale setting
			const scaleMatch = line.match(/^scale\s*=\s*(\d+)$/);
			if (scaleMatch) {
				scale = Number.parseInt(scaleMatch[1], 10);
				continue;
			}

			// Handle variable assignment
			const assignMatch = line.match(/^([a-z_]\w*)\s*=\s*(.+)$/);
			if (assignMatch) {
				const value = evalExpr(assignMatch[2], vars, scale);
				if (value !== null) {
					vars.set(assignMatch[1], value);
				} else {
					ctx.stderr.writeln(`bc: syntax error: ${line}`);
				}
				continue;
			}

			// Evaluate expression
			const result = evalExpr(line, vars, scale);
			if (result !== null) {
				if (scale > 0) {
					ctx.stdout.writeln(result.toFixed(scale));
				} else {
					ctx.stdout.writeln(String(Math.trunc(result)));
				}
			} else {
				ctx.stderr.writeln(`bc: syntax error: ${line}`);
			}
		}

		return 0;
	})
	.toHandler();

function evalExpr(expr: string, vars: Map<string, number>, scale: number): number | null {
	const tokens = tokenize(expr.trim());
	if (tokens === null) return null;

	let pos = 0;

	const peek = (): string | undefined => tokens[pos];
	const consume = (): string => tokens[pos++];

	const parseExpr = (): number | null => {
		let left = parseTerm();
		if (left === null) return null;
		while (peek() === "+" || peek() === "-") {
			const op = consume();
			const right = parseTerm();
			if (right === null) return null;
			left = op === "+" ? left + right : left - right;
		}
		return left;
	};

	const parseTerm = (): number | null => {
		let left = parsePower();
		if (left === null) return null;
		while (peek() === "*" || peek() === "/" || peek() === "%") {
			const op = consume();
			const right = parsePower();
			if (right === null) return null;
			if (op === "*") {
				left = left * right;
			} else if (op === "/") {
				if (right === 0) return null;
				if (scale > 0) {
					left = left / right;
				} else {
					left = Math.trunc(left / right);
				}
			} else {
				if (right === 0) return null;
				left = left % right;
			}
		}
		return left;
	};

	const parsePower = (): number | null => {
		let base = parseUnary();
		if (base === null) return null;
		if (peek() === "^") {
			consume();
			const exp = parsePower();
			if (exp === null) return null;
			base = base ** exp;
		}
		return base;
	};

	const parseUnary = (): number | null => {
		if (peek() === "-") {
			consume();
			const val = parsePrimary();
			if (val === null) return null;
			return -val;
		}
		if (peek() === "+") {
			consume();
		}
		return parsePrimary();
	};

	const parsePrimary = (): number | null => {
		const tok = peek();
		if (tok === undefined) return null;

		if (tok === "(") {
			consume();
			const val = parseExpr();
			if (peek() === ")") consume();
			return val;
		}

		// Built-in functions
		if (tok === "sqrt" || tok === "s" || tok === "c" || tok === "l" || tok === "e" || tok === "a") {
			const fn = consume();
			if (peek() === "(") {
				consume();
				const val = parseExpr();
				if (peek() === ")") consume();
				if (val === null) return null;
				switch (fn) {
					case "sqrt":
						return Math.sqrt(val);
					case "s":
						return Math.sin(val);
					case "c":
						return Math.cos(val);
					case "l":
						return Math.log(val);
					case "e":
						return Math.exp(val);
					case "a":
						return Math.atan(val);
				}
			}
			// Fall through to variable lookup
			return vars.get(fn) ?? 0;
		}

		// Number
		if (/^[0-9]/.test(tok) || tok === ".") {
			consume();
			return Number.parseFloat(tok);
		}

		// Variable
		if (/^[a-z_]/.test(tok)) {
			consume();
			return vars.get(tok) ?? 0;
		}

		return null;
	};

	const result = parseExpr();
	if (pos < tokens.length) return null;
	return result;
}

function tokenize(expr: string): string[] | null {
	const tokens: string[] = [];
	let i = 0;
	while (i < expr.length) {
		if (expr[i] === " " || expr[i] === "\t") {
			i++;
			continue;
		}
		if ("+-*/%^()".includes(expr[i])) {
			tokens.push(expr[i]);
			i++;
			continue;
		}
		if (/[0-9.]/.test(expr[i])) {
			let num = "";
			while (i < expr.length && /[0-9.]/.test(expr[i])) {
				num += expr[i];
				i++;
			}
			tokens.push(num);
			continue;
		}
		if (/[a-z_]/i.test(expr[i])) {
			let ident = "";
			while (i < expr.length && /[a-z_0-9]/i.test(expr[i])) {
				ident += expr[i];
				i++;
			}
			tokens.push(ident);
			continue;
		}
		return null;
	}
	return tokens;
}
