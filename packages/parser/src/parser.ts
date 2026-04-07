import type {
	AssignmentNode,
	AstNode,
	BraceGroupNode,
	CaseNode,
	CommandNode,
	ForNode,
	FunctionNode,
	IfNode,
	ListNode,
	PipelineNode,
	Redirect,
	SelectNode,
	SubshellNode,
	UntilNode,
	WhileNode,
	Word,
	WordPart,
} from "./ast.js";
import type { Token, TokenType } from "./tokenizer.js";
import { Tokenizer } from "./tokenizer.js";

export class Parser {
	private tokenizer: Tokenizer;
	private pushedBack: Token | null = null;

	constructor(input: string) {
		this.tokenizer = new Tokenizer(input);
	}

	parse(): AstNode {
		this.skipNewlines();
		if (this.peek().type === "EOF") {
			return {
				type: "command",
				name: [],
				prefix: [],
				args: [],
				redirects: [],
			};
		}
		const node = this.parseCompoundList();
		this.skipNewlines();
		if (this.peek().type !== "EOF") {
			throw this.error(`Unexpected token: '${this.peek().value}'`);
		}
		return node;
	}

	private peek(): Token {
		if (this.pushedBack) return this.pushedBack;
		return this.tokenizer.peek();
	}

	private next(): Token {
		if (this.pushedBack) {
			const t = this.pushedBack;
			this.pushedBack = null;
			return t;
		}
		return this.tokenizer.next();
	}

	private eat(type: TokenType): Token {
		const t = this.next();
		if (t.type !== type) {
			throw this.error(`Expected ${type} but got ${t.type} ('${t.value}')`, t);
		}
		return t;
	}

	private check(...types: TokenType[]): boolean {
		return types.includes(this.peek().type);
	}

	private eatKeyword(keyword: string): Token {
		const t = this.next();
		if (t.value !== keyword) {
			throw this.error(`Expected '${keyword}' but got '${t.value}'`, t);
		}
		return t;
	}

	/** Check if next token is a keyword by value, regardless of whether the tokenizer classified it as reserved. */
	private isKeyword(value: string): boolean {
		return this.peek().value === value;
	}

	/** Check if the next token is a keyword that terminates a compound list. */
	private isListTerminator(): boolean {
		const v = this.peek().value;
		return (
			v === "then" ||
			v === "else" ||
			v === "elif" ||
			v === "fi" ||
			v === "do" ||
			v === "done" ||
			v === "esac"
		);
	}

	private skipNewlines(): void {
		while (this.peek().type === "NEWLINE") {
			this.next();
		}
	}

	private isRedirectOp(type: TokenType): boolean {
		return (
			type === "LESS" ||
			type === "GREAT" ||
			type === "DLESS" ||
			type === "DGREAT" ||
			type === "LESSAND" ||
			type === "GREATAND" ||
			type === "LESSGREAT" ||
			type === "DLESSDASH" ||
			type === "CLOBBER" ||
			type === "AND_GREAT" ||
			type === "AND_DGREAT" ||
			type === "TLESS"
		);
	}

	private isCompoundStart(): boolean {
		const t = this.peek();
		return (
			t.type === "LPAREN" ||
			t.type === "LBRACE" ||
			t.value === "if" ||
			t.value === "for" ||
			t.value === "while" ||
			t.value === "until" ||
			t.value === "case" ||
			t.value === "select"
		);
	}

	// ---- Compound list / list parsing ----

	private parseCompoundList(): AstNode {
		this.skipNewlines();
		let node = this.parseAndOr();

		while (true) {
			const t = this.peek();
			if (t.type === "SEMI" || t.type === "AMP") {
				const op = this.next();
				this.skipNewlines();
				if (
					this.peek().type === "EOF" ||
					this.peek().type === "RPAREN" ||
					this.peek().type === "RBRACE" ||
					this.peek().type === "DSEMI" ||
					this.peek().type === "SEMI_AND" ||
					this.peek().type === "DSEMI_AND" ||
					this.isListTerminator()
				) {
					if (op.type === "AMP") {
						node = {
							type: "list",
							left: node,
							right: {
								type: "command",
								name: [],
								prefix: [],
								args: [],
								redirects: [],
							},
							operator: "&",
						} satisfies ListNode;
					}
					break;
				}
				const right = this.parseAndOr();
				node = {
					type: "list",
					left: node,
					right,
					operator: op.type === "AMP" ? "&" : ";",
				} satisfies ListNode;
			} else if (t.type === "NEWLINE") {
				this.next();
				this.skipNewlines();
				if (
					this.peek().type === "EOF" ||
					this.peek().type === "RPAREN" ||
					this.peek().type === "RBRACE" ||
					this.peek().type === "DSEMI" ||
					this.peek().type === "SEMI_AND" ||
					this.peek().type === "DSEMI_AND" ||
					this.isListTerminator()
				) {
					break;
				}
				const right = this.parseAndOr();
				node = {
					type: "list",
					left: node,
					right,
					operator: ";",
				} satisfies ListNode;
			} else {
				break;
			}
		}

		return node;
	}

	private parseAndOr(): AstNode {
		let node = this.parsePipeline();

		while (this.check("AND", "OR")) {
			const op = this.next();
			this.skipNewlines();
			const right = this.parsePipeline();
			node = {
				type: "list",
				left: node,
				right,
				operator: op.type === "AND" ? "&&" : "||",
			} satisfies ListNode;
		}

		return node;
	}

	private parsePipeline(): AstNode {
		let negated = false;
		if (this.peek().type === "BANG") {
			this.next();
			negated = true;
		}

		// Check for time keyword
		if (this.isKeyword("time")) {
			this.next();
			// TIME is treated as a prefix; parse rest as pipeline
		}

		const first = this.parseCommand();
		const commands: AstNode[] = [first];
		let pipeStderr = false;

		while (this.check("PIPE", "PIPE_AND")) {
			const pipeToken = this.next();
			if (pipeToken.type === "PIPE_AND") {
				pipeStderr = true;
			}
			this.skipNewlines();
			commands.push(this.parseCommand());
		}

		if (commands.length === 1 && !negated) {
			return first;
		}

		return {
			type: "pipeline",
			commands,
			negated,
			pipeStderr,
		} satisfies PipelineNode;
	}

	private parseCommand(): AstNode {
		const t = this.peek();

		// Function definition: name () { ... }
		if (t.type === "WORD" || t.type === "ASSIGNMENT_WORD") {
			// Check for function def pattern: WORD ( )
			if (this.isFunctionDef()) {
				return this.parseFunctionDef();
			}
		}

		// function keyword
		if (t.value === "function") {
			return this.parseFunctionKeyword();
		}

		// Compound commands
		if (this.isCompoundStart()) {
			const node = this.parseCompoundCommand();
			const redirects = this.parseRedirects();
			this.applyRedirects(node, redirects);
			return node;
		}

		// Simple command (includes assignments)
		return this.parseSimpleCommand();
	}

	private isFunctionDef(): boolean {
		// We need to lookahead past the word to see if ( ) follows
		// Save state via peek
		const t1 = this.peek();
		if (t1.type !== "WORD") return false;

		// We can't easily lookahead two tokens with the current tokenizer,
		// but we can check if the word value contains = (then it's assignment, not function)
		if (t1.value.includes("=")) return false;

		// We'll attempt function def parsing in parseSimpleCommand when we see LPAREN
		return false;
	}

	private parseFunctionDef(): AstNode {
		// Should not normally be called; handled in parseSimpleCommand
		throw this.error("Internal: parseFunctionDef should not be called directly");
	}

	private parseFunctionKeyword(): FunctionNode {
		this.eatKeyword("function");
		const nameToken = this.next();
		const name = nameToken.value;

		// Optional ( )
		if (this.peek().type === "LPAREN") {
			this.next();
			this.eat("RPAREN");
		}

		this.skipNewlines();
		const body = this.parseCompoundCommand();
		const redirects = this.parseRedirects();

		return {
			type: "function",
			name,
			body,
			redirects,
		};
	}

	private parseCompoundCommand(): AstNode {
		const t = this.peek();

		if (t.type === "LPAREN") return this.parseSubshell();
		if (t.type === "LBRACE") return this.parseBraceGroup();

		switch (t.value) {
			case "if":
				return this.parseIf();
			case "for":
				return this.parseFor();
			case "while":
				return this.parseWhile();
			case "until":
				return this.parseUntil();
			case "case":
				return this.parseCase();
			case "select":
				return this.parseSelect();
			default:
				throw this.error(`Expected compound command, got ${t.type} ('${t.value}')`, t);
		}
	}

	private parseSubshell(): SubshellNode {
		this.eat("LPAREN");
		const body = this.parseCompoundList();
		this.eat("RPAREN");
		return {
			type: "subshell",
			body,
			redirects: [],
		};
	}

	private parseBraceGroup(): BraceGroupNode {
		this.eat("LBRACE");
		const body = this.parseCompoundList();
		this.eat("RBRACE");
		return {
			type: "braceGroup",
			body,
			redirects: [],
		};
	}

	private parseIf(): IfNode {
		this.eatKeyword("if");
		const clauses: { condition: AstNode; body: AstNode }[] = [];

		const condition = this.parseCompoundList();
		this.eatKeyword("then");
		const body = this.parseCompoundList();
		clauses.push({ condition, body });

		while (this.isKeyword("elif")) {
			this.next();
			const elifCondition = this.parseCompoundList();
			this.eatKeyword("then");
			const elifBody = this.parseCompoundList();
			clauses.push({ condition: elifCondition, body: elifBody });
		}

		let elseBody: AstNode | undefined;
		if (this.isKeyword("else")) {
			this.next();
			elseBody = this.parseCompoundList();
		}

		this.eatKeyword("fi");

		return {
			type: "if",
			clauses,
			elseBody,
			redirects: [],
		};
	}

	private parseFor(): ForNode {
		this.eatKeyword("for");

		// Check for arithmetic for: for (( expr; expr; expr ))
		if (this.peek().type === "LPAREN") {
			// Arithmetic for — not yet supported, treat as error for now
			// Actually let's handle it by reading the double-paren as an expression
		}

		const varToken = this.next();
		const variable = varToken.value;

		let words: Word[] | undefined;

		this.skipNewlines();

		if (this.isKeyword("in")) {
			this.next();
			words = [];
			while (!this.isKeyword("do") && !this.check("SEMI", "NEWLINE", "EOF")) {
				words.push(this.parseWord());
			}
			// Consume separator
			if (this.check("SEMI", "NEWLINE")) {
				this.next();
			}
		} else if (this.check("SEMI", "NEWLINE")) {
			this.next();
		}

		this.skipNewlines();
		const body = this.parseDoGroup();

		return {
			type: "for",
			variable,
			words,
			body,
			redirects: [],
		};
	}

	private parseWhile(): WhileNode {
		this.eatKeyword("while");
		const condition = this.parseCompoundList();
		const body = this.parseDoGroup();
		return {
			type: "while",
			condition,
			body,
			redirects: [],
		};
	}

	private parseUntil(): UntilNode {
		this.eatKeyword("until");
		const condition = this.parseCompoundList();
		const body = this.parseDoGroup();
		return {
			type: "until",
			condition,
			body,
			redirects: [],
		};
	}

	private parseDoGroup(): AstNode {
		this.eatKeyword("do");
		const body = this.parseCompoundList();
		this.eatKeyword("done");
		return body;
	}

	private parseCase(): CaseNode {
		this.eatKeyword("case");
		const word = this.parseWord();
		this.skipNewlines();
		this.eatKeyword("in");
		this.skipNewlines();

		const items: CaseNode["items"] = [];

		while (!this.isKeyword("esac")) {
			// Optional leading (
			if (this.peek().type === "LPAREN") {
				this.next();
			}

			// Patterns
			const patterns: Word[] = [this.parseWord()];
			while (this.peek().type === "PIPE") {
				this.next();
				patterns.push(this.parseWord());
			}

			this.eat("RPAREN");
			this.skipNewlines();

			// Body (may be empty)
			let body: AstNode | null = null;
			let terminator: ";;" | ";&" | ";;&" = ";;";

			if (!this.check("DSEMI", "SEMI_AND", "DSEMI_AND", "ESAC")) {
				body = this.parseCompoundList();
			}

			if (this.check("DSEMI", "SEMI_AND", "DSEMI_AND")) {
				const t = this.next();
				if (t.type === "DSEMI") terminator = ";;";
				else if (t.type === "SEMI_AND") terminator = ";&";
				else terminator = ";;&";
			}

			this.skipNewlines();

			items.push({ patterns, body, terminator });
		}

		this.eatKeyword("esac");

		return {
			type: "case",
			word,
			items,
			redirects: [],
		};
	}

	private parseSelect(): SelectNode {
		this.eatKeyword("select");
		const varToken = this.next();
		const variable = varToken.value;

		let words: Word[] | undefined;

		this.skipNewlines();

		if (this.isKeyword("in")) {
			this.next();
			words = [];
			while (!this.isKeyword("do") && !this.check("SEMI", "NEWLINE", "EOF")) {
				words.push(this.parseWord());
			}
			if (this.check("SEMI", "NEWLINE")) {
				this.next();
			}
		} else if (this.check("SEMI", "NEWLINE")) {
			this.next();
		}

		this.skipNewlines();
		const body = this.parseDoGroup();

		return {
			type: "select",
			variable,
			words,
			body,
			redirects: [],
		};
	}

	private parseSimpleCommand(): AstNode {
		const prefix: AssignmentNode[] = [];
		const redirects: Redirect[] = [];
		const args: Word[] = [];
		let name: Word | null = null;

		// Parse prefix assignments and redirects
		while (true) {
			if (this.peek().type === "ASSIGNMENT_WORD") {
				prefix.push(this.parseAssignment());
				continue;
			}

			const fdRedirect = this.tryParseRedirect();
			if (fdRedirect) {
				redirects.push(fdRedirect);
				continue;
			}

			break;
		}

		// Parse command name
		if (this.peek().type === "WORD" || this.peek().type === "BANG" || this.peek().type === "TIME") {
			const nameWord = this.parseWord();

			// Check for function definition: name () compound_command
			if (this.peek().type === "LPAREN") {
				this.next(); // (
				this.eat("RPAREN"); // )
				this.skipNewlines();
				const body = this.parseCompoundCommand();
				const funcRedirects = this.parseRedirects();
				return {
					type: "function",
					name: wordToString(nameWord),
					body,
					redirects: funcRedirects,
				} satisfies FunctionNode;
			}

			name = nameWord;

			// Parse remaining args and redirects
			while (true) {
				const redirect = this.tryParseRedirect();
				if (redirect) {
					redirects.push(redirect);
					continue;
				}

				if (this.peek().type === "WORD" || this.peek().type === "ASSIGNMENT_WORD") {
					// After command name, ASSIGNMENT_WORD is treated as regular arg
					args.push(this.parseWord());
					continue;
				}

				break;
			}
		}

		// If we only have assignments and no command name, check if there's a compound command
		if (!name && prefix.length === 0 && redirects.length === 0) {
			throw this.error(`Expected command, got ${this.peek().type} ('${this.peek().value}')`);
		}

		// If only assignments, return them as a list-like structure or single assignment
		if (!name && prefix.length > 0 && redirects.length === 0) {
			if (prefix.length === 1) {
				return prefix[0];
			}
			// Multiple assignments - chain them
			let result: AstNode = prefix[0];
			for (let i = 1; i < prefix.length; i++) {
				result = {
					type: "list",
					left: result,
					right: prefix[i],
					operator: ";",
				} satisfies ListNode;
			}
			return result;
		}

		return {
			type: "command",
			name: name ?? [],
			prefix,
			args,
			redirects,
		} satisfies CommandNode;
	}

	private parseAssignment(): AssignmentNode {
		const token = this.eat("ASSIGNMENT_WORD");
		const value = token.value;

		let append = false;
		const eqIdx = value.indexOf("=");
		let name: string;

		if (eqIdx > 0 && value[eqIdx - 1] === "+") {
			append = true;
			name = value.substring(0, eqIdx - 1);
		} else {
			name = value.substring(0, eqIdx);
		}

		const rawValue = value.substring(eqIdx + 1);
		const wordValue = this.parseWordString(rawValue);

		return {
			type: "assignment",
			name,
			value: wordValue,
			append,
			export: false,
			local: false,
			readonly: false,
		};
	}

	private tryParseRedirect(): Redirect | null {
		const t = this.peek();

		// Direct redirect operator
		if (this.isRedirectOp(t.type)) {
			return this.parseRedirect(-1);
		}

		// Check for fd-number prefix: WORD(digits) followed by redirect op
		if (t.type === "WORD" && /^\d+$/.test(t.value)) {
			const saved = this.next(); // consume the digit WORD
			if (this.isRedirectOp(this.peek().type)) {
				return this.parseRedirect(Number.parseInt(saved.value, 10));
			}
			// Not a redirect — push back
			this.pushedBack = saved;
			return null;
		}

		return null;
	}

	private parseRedirect(fd: number): Redirect {
		const opToken = this.next();
		const op = this.mapRedirectOp(opToken.type);

		// Determine default fd
		if (fd === -1) {
			if (
				opToken.type === "LESS" ||
				opToken.type === "DLESS" ||
				opToken.type === "DLESSDASH" ||
				opToken.type === "LESSAND" ||
				opToken.type === "LESSGREAT" ||
				opToken.type === "TLESS"
			) {
				fd = 0;
			} else {
				fd = 1;
			}
		}

		// For &> and &>>, fd is special
		if (opToken.type === "AND_GREAT" || opToken.type === "AND_DGREAT") {
			fd = 1; // redirects both stdout and stderr
		}

		// Handle heredoc
		if (opToken.type === "DLESS" || opToken.type === "DLESSDASH") {
			const delimWord = this.parseWord();
			const delimStr = wordToString(delimWord);
			const _stripTabs = opToken.type === "DLESSDASH";

			// Check if delimiter was quoted
			const rawValue = this.peekLastTokenValue();
			const quoted = rawValue.includes("'") || rawValue.includes('"') || rawValue.includes("\\");

			const redirect: Redirect = {
				fd,
				op: "<<",
				target: delimWord,
				heredocDelimiter: delimStr,
				heredocQuoted: quoted,
			};

			// Register heredoc with tokenizer for body reading on next newline
			// The tokenizer will attach body to this redirect's token later
			// For now, we store the delimiter info
			return redirect;
		}

		const target = this.parseWord();

		return {
			fd,
			op,
			target,
		};
	}

	private lastParsedTokenValue = "";

	private peekLastTokenValue(): string {
		return this.lastParsedTokenValue;
	}

	private mapRedirectOp(type: TokenType): Redirect["op"] {
		switch (type) {
			case "LESS":
				return "<";
			case "GREAT":
				return ">";
			case "DLESS":
				return "<<";
			case "DGREAT":
				return ">>";
			case "LESSAND":
				return "<&";
			case "GREATAND":
				return ">&";
			case "LESSGREAT":
				return "<>";
			case "DLESSDASH":
				return "<<";
			case "CLOBBER":
				return ">";
			case "AND_GREAT":
				return "&>";
			case "AND_DGREAT":
				return "&>>";
			case "TLESS":
				return "<<<";
			default:
				throw this.error(`Unknown redirect operator: ${type}`);
		}
	}

	private parseRedirects(): Redirect[] {
		const redirects: Redirect[] = [];
		while (true) {
			const r = this.tryParseRedirect();
			if (!r) break;
			redirects.push(r);
		}
		return redirects;
	}

	private applyRedirects(node: AstNode, redirects: Redirect[]): void {
		if (redirects.length === 0) return;

		if ("redirects" in node) {
			(node as { redirects: Redirect[] }).redirects.push(...redirects);
		}
	}

	// ---- Word parsing (from token value to WordPart[]) ----

	private parseWord(): Word {
		const t = this.next();
		if (t.type !== "WORD" && t.type !== "ASSIGNMENT_WORD" && !isWordToken(t.type)) {
			throw this.error(`Expected word, got ${t.type} ('${t.value}')`, t);
		}
		this.lastParsedTokenValue = t.value;
		return this.parseWordString(t.value);
	}

	private parseWordString(input: string): Word {
		const parts: WordPart[] = [];
		let i = 0;
		let literal = "";

		const flush = () => {
			if (literal.length > 0) {
				parts.push({ type: "literal", value: literal });
				literal = "";
			}
		};

		while (i < input.length) {
			const c = input[i];

			if (c === "\\") {
				i++;
				if (i < input.length) {
					literal += input[i];
					i++;
				}
				continue;
			}

			if (c === "'") {
				flush();
				i++;
				let value = "";
				while (i < input.length && input[i] !== "'") {
					value += input[i];
					i++;
				}
				i++; // closing '
				parts.push({ type: "singleQuoted", value });
				continue;
			}

			if (c === '"') {
				flush();
				i++;
				const dqParts = this.parseDoubleQuotedParts(input, i);
				parts.push({ type: "doubleQuoted", parts: dqParts.parts });
				i = dqParts.end;
				continue;
			}

			if (c === "$") {
				flush();
				const result = this.parseDollarExpansion(input, i);
				parts.push(result.part);
				i = result.end;
				continue;
			}

			if (c === "`") {
				flush();
				i++;
				let cmdStr = "";
				while (i < input.length && input[i] !== "`") {
					if (input[i] === "\\") {
						i++;
						if (i < input.length) {
							cmdStr += input[i];
							i++;
						}
						continue;
					}
					cmdStr += input[i];
					i++;
				}
				i++; // closing `
				const subParser = new Parser(cmdStr);
				const body = subParser.parse();
				parts.push({ type: "commandSubstitution", body });
				continue;
			}

			if (c === "~" && parts.length === 0 && literal.length === 0) {
				i++;
				let user = "";
				while (i < input.length && isNameCharStatic(input[i])) {
					user += input[i];
					i++;
				}
				parts.push({ type: "tilde", user });
				continue;
			}

			if (c === "*" || c === "?" || c === "[") {
				flush();
				let pattern = "";
				if (c === "[") {
					pattern += input[i];
					i++;
					while (i < input.length && input[i] !== "]") {
						pattern += input[i];
						i++;
					}
					if (i < input.length) {
						pattern += input[i];
						i++;
					}
				} else {
					pattern += input[i];
					i++;
				}
				parts.push({ type: "glob", pattern });
				continue;
			}

			if (c === "{" && i + 1 < input.length) {
				// Check for brace expansion: {a,b} or {1..3}
				const braceResult = this.tryParseBraceExpansion(input, i);
				if (braceResult) {
					flush();
					parts.push(braceResult.part);
					i = braceResult.end;
					continue;
				}
			}

			if (c === "<" && i + 1 < input.length && input[i + 1] === "(") {
				flush();
				const result = this.parseProcessSubstitution(input, i, "in");
				parts.push(result.part);
				i = result.end;
				continue;
			}

			if (c === ">" && i + 1 < input.length && input[i + 1] === "(") {
				flush();
				const result = this.parseProcessSubstitution(input, i, "out");
				parts.push(result.part);
				i = result.end;
				continue;
			}

			literal += c;
			i++;
		}

		flush();
		return parts;
	}

	private parseDoubleQuotedParts(input: string, start: number): { parts: WordPart[]; end: number } {
		const parts: WordPart[] = [];
		let i = start;
		let literal = "";

		const flush = () => {
			if (literal.length > 0) {
				parts.push({ type: "literal", value: literal });
				literal = "";
			}
		};

		while (i < input.length && input[i] !== '"') {
			const c = input[i];

			if (c === "\\") {
				i++;
				if (i < input.length) {
					const next = input[i];
					if (next === "$" || next === "`" || next === '"' || next === "\\") {
						literal += next;
						i++;
					} else {
						literal += "\\";
						literal += next;
						i++;
					}
				}
				continue;
			}

			if (c === "$") {
				flush();
				const result = this.parseDollarExpansion(input, i);
				parts.push(result.part);
				i = result.end;
				continue;
			}

			if (c === "`") {
				flush();
				i++;
				let cmdStr = "";
				while (i < input.length && input[i] !== "`") {
					if (input[i] === "\\") {
						i++;
						if (i < input.length) {
							cmdStr += input[i];
							i++;
						}
						continue;
					}
					cmdStr += input[i];
					i++;
				}
				i++; // closing `
				const subParser = new Parser(cmdStr);
				const body = subParser.parse();
				parts.push({ type: "commandSubstitution", body });
				continue;
			}

			literal += c;
			i++;
		}

		flush();

		if (i < input.length && input[i] === '"') {
			i++; // consume closing "
		}

		return { parts, end: i };
	}

	private parseDollarExpansion(input: string, start: number): { part: WordPart; end: number } {
		let i = start + 1; // skip $

		if (i >= input.length) {
			return { part: { type: "literal", value: "$" }, end: i };
		}

		const c = input[i];

		// $(( ... )) — arithmetic expansion
		if (c === "(" && i + 1 < input.length && input[i + 1] === "(") {
			i += 2;
			let depth = 1;
			let expr = "";
			while (i < input.length && depth > 0) {
				if (input[i] === "(" && i + 1 < input.length && input[i + 1] === "(") {
					depth++;
					expr += input[i];
					expr += input[i + 1];
					i += 2;
				} else if (input[i] === ")" && i + 1 < input.length && input[i + 1] === ")") {
					depth--;
					if (depth > 0) {
						expr += input[i];
						expr += input[i + 1];
					}
					i += 2;
				} else {
					expr += input[i];
					i++;
				}
			}
			return { part: { type: "arithmeticExpansion", expression: expr }, end: i };
		}

		// $( ... ) — command substitution
		if (c === "(") {
			i++;
			let depth = 1;
			let cmdStr = "";
			while (i < input.length && depth > 0) {
				if (input[i] === "(") depth++;
				if (input[i] === ")") depth--;
				if (depth > 0) {
					if (input[i] === "'") {
						cmdStr += input[i];
						i++;
						while (i < input.length && input[i] !== "'") {
							cmdStr += input[i];
							i++;
						}
						if (i < input.length) {
							cmdStr += input[i];
							i++;
						}
					} else if (input[i] === '"') {
						cmdStr += input[i];
						i++;
						while (i < input.length && input[i] !== '"') {
							if (input[i] === "\\") {
								cmdStr += input[i];
								i++;
								if (i < input.length) {
									cmdStr += input[i];
									i++;
								}
								continue;
							}
							cmdStr += input[i];
							i++;
						}
						if (i < input.length) {
							cmdStr += input[i];
							i++;
						}
					} else {
						cmdStr += input[i];
						i++;
					}
				} else {
					i++; // consume closing )
				}
			}
			const subParser = new Parser(cmdStr);
			const body = subParser.parse();
			return { part: { type: "commandSubstitution", body }, end: i };
		}

		// ${ ... } — variable expansion
		if (c === "{") {
			i++;

			// ${# — length
			if (i < input.length && input[i] === "#") {
				const afterHash = i + 1;
				// ${#VAR}
				if (afterHash < input.length && input[afterHash] !== "}") {
					i++; // skip #
					let name = "";
					while (i < input.length && input[i] !== "}") {
						name += input[i];
						i++;
					}
					if (i < input.length) i++; // }
					return { part: { type: "variableLength", name }, end: i };
				}
			}

			// ${! — indirect
			let indirect = false;
			if (i < input.length && input[i] === "!") {
				indirect = true;
				i++;
			}

			// Read name
			let name = "";
			while (
				i < input.length &&
				input[i] !== "}" &&
				input[i] !== ":" &&
				input[i] !== "/" &&
				input[i] !== "%" &&
				input[i] !== "#" &&
				input[i] !== "-" &&
				input[i] !== "+" &&
				input[i] !== "=" &&
				input[i] !== "?" &&
				input[i] !== "[" &&
				input[i] !== "^" &&
				input[i] !== ","
			) {
				name += input[i];
				i++;
			}

			if (i < input.length && input[i] === "}") {
				i++;
				return { part: { type: "variable", name, indirect: indirect || undefined }, end: i };
			}

			// Expansion operator
			let op = "";
			if (i < input.length) {
				// Two-char operators like :-, :+, :=, :?
				if (input[i] === ":") {
					op += input[i];
					i++;
					if (
						i < input.length &&
						(input[i] === "-" || input[i] === "+" || input[i] === "=" || input[i] === "?")
					) {
						op += input[i];
						i++;
					}
				} else if (input[i] === "/" && i + 1 < input.length && input[i + 1] === "/") {
					op = "//";
					i += 2;
				} else if (input[i] === "%" && i + 1 < input.length && input[i + 1] === "%") {
					op = "%%";
					i += 2;
				} else if (input[i] === "#" && i + 1 < input.length && input[i + 1] === "#") {
					op = "##";
					i += 2;
				} else if (input[i] === "^" && i + 1 < input.length && input[i + 1] === "^") {
					op = "^^";
					i += 2;
				} else if (input[i] === "," && i + 1 < input.length && input[i + 1] === ",") {
					op = ",,";
					i += 2;
				} else {
					op += input[i];
					i++;
				}
			}

			// Read argument (the rest until })
			let argStr = "";
			let braceDepth = 1;
			while (i < input.length && braceDepth > 0) {
				if (input[i] === "{") braceDepth++;
				if (input[i] === "}") {
					braceDepth--;
					if (braceDepth === 0) {
						i++;
						break;
					}
				}
				argStr += input[i];
				i++;
			}

			const arg = this.parseWordString(argStr);

			return {
				part: { type: "variableExpansion", name, op, arg },
				end: i,
			};
		}

		// $VAR — simple variable
		if (isSpecialParamChar(c)) {
			i++;
			return { part: { type: "variable", name: c }, end: i };
		}

		if (isNameStartChar(c)) {
			let name = "";
			while (i < input.length && isNameCharStatic(input[i])) {
				name += input[i];
				i++;
			}
			return { part: { type: "variable", name }, end: i };
		}

		// Lone $ — treat as literal
		return { part: { type: "literal", value: "$" }, end: i };
	}

	private parseProcessSubstitution(
		input: string,
		start: number,
		direction: "in" | "out",
	): { part: WordPart; end: number } {
		let i = start + 2; // skip <( or >(
		let depth = 1;
		let cmdStr = "";
		while (i < input.length && depth > 0) {
			if (input[i] === "(") depth++;
			if (input[i] === ")") {
				depth--;
				if (depth === 0) {
					i++;
					break;
				}
			}
			cmdStr += input[i];
			i++;
		}
		const subParser = new Parser(cmdStr);
		const body = subParser.parse();
		return { part: { type: "processSubstitution", direction, body }, end: i };
	}

	private tryParseBraceExpansion(
		input: string,
		start: number,
	): { part: WordPart; end: number } | null {
		// Look for { ... , ... } or { ... .. ... }
		let i = start + 1;
		let depth = 1;
		let hasComma = false;
		let hasDotDot = false;

		// Scan ahead to validate
		const scanStart = i;
		while (i < input.length && depth > 0) {
			if (input[i] === "{") depth++;
			if (input[i] === "}") {
				depth--;
				if (depth === 0) break;
			}
			if (depth === 1 && input[i] === ",") hasComma = true;
			if (depth === 1 && input[i] === "." && i + 1 < input.length && input[i + 1] === ".") {
				hasDotDot = true;
			}
			i++;
		}

		if (depth !== 0) return null;
		if (!hasComma && !hasDotDot) return null;

		// Parse the content
		const content = input.substring(scanStart, i);
		i++; // skip closing }

		if (hasComma) {
			// Split by commas at depth 0
			const segments: string[] = [];
			let seg = "";
			let d = 0;
			for (let j = 0; j < content.length; j++) {
				if (content[j] === "{") d++;
				if (content[j] === "}") d--;
				if (d === 0 && content[j] === ",") {
					segments.push(seg);
					seg = "";
				} else {
					seg += content[j];
				}
			}
			segments.push(seg);

			const branceParts: Word[] = segments.map((s) => this.parseWordString(s));
			return {
				part: { type: "braceExpansion", parts: branceParts },
				end: i,
			};
		}

		// Range expansion like {1..10} — represent as literal for now
		return {
			part: { type: "literal", value: `{${content}}` },
			end: i,
		};
	}

	private error(message: string, token?: Token): Error {
		if (token) {
			return new Error(
				`Parse error at line ${token.position.line}, column ${token.position.column}: ${message}`,
			);
		}
		const pos = this.peek().position;
		return new Error(`Parse error at line ${pos.line}, column ${pos.column}: ${message}`);
	}
}

function wordToString(word: Word): string {
	return word
		.map((p) => {
			switch (p.type) {
				case "literal":
					return p.value;
				case "singleQuoted":
					return p.value;
				case "doubleQuoted":
					return wordToString(p.parts);
				case "variable":
					return `$${p.name}`;
				case "tilde":
					return `~${p.user}`;
				case "glob":
					return p.pattern;
				default:
					return "";
			}
		})
		.join("");
}

function isWordToken(type: TokenType): boolean {
	return (
		type === "WORD" ||
		type === "ASSIGNMENT_WORD" ||
		type === "BANG" ||
		type === "TIME" ||
		// Reserved words can appear as words in non-reserved positions
		type === "IF" ||
		type === "THEN" ||
		type === "ELSE" ||
		type === "ELIF" ||
		type === "FI" ||
		type === "FOR" ||
		type === "WHILE" ||
		type === "UNTIL" ||
		type === "DO" ||
		type === "DONE" ||
		type === "CASE" ||
		type === "ESAC" ||
		type === "IN" ||
		type === "SELECT" ||
		type === "FUNCTION" ||
		type === "COPROC"
	);
}

function isNameStartChar(c: string): boolean {
	return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function isNameCharStatic(c: string): boolean {
	return isNameStartChar(c) || (c >= "0" && c <= "9");
}

function isSpecialParamChar(c: string): boolean {
	return (
		c === "@" ||
		c === "*" ||
		c === "#" ||
		c === "?" ||
		c === "-" ||
		c === "$" ||
		c === "!" ||
		c === "0"
	);
}
