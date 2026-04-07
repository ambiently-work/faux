export type TokenType =
	| "WORD"
	| "ASSIGNMENT_WORD"
	| "NEWLINE"
	| "EOF"
	| "PIPE"
	| "PIPE_AND"
	| "AND"
	| "OR"
	| "SEMI"
	| "AMP"
	| "DSEMI"
	| "SEMI_AND"
	| "DSEMI_AND"
	| "LESS"
	| "GREAT"
	| "DLESS"
	| "DGREAT"
	| "LESSAND"
	| "GREATAND"
	| "LESSGREAT"
	| "DLESSDASH"
	| "CLOBBER"
	| "AND_GREAT"
	| "AND_DGREAT"
	| "TLESS"
	| "LPAREN"
	| "RPAREN"
	| "LBRACE"
	| "RBRACE"
	| "BANG"
	| "IF"
	| "THEN"
	| "ELSE"
	| "ELIF"
	| "FI"
	| "FOR"
	| "WHILE"
	| "UNTIL"
	| "DO"
	| "DONE"
	| "CASE"
	| "ESAC"
	| "IN"
	| "SELECT"
	| "FUNCTION"
	| "COPROC"
	| "TIME";

export interface Position {
	line: number;
	column: number;
	offset: number;
}

export interface Token {
	type: TokenType;
	value: string;
	position: Position;
}

const RESERVED_WORDS: Record<string, TokenType> = {
	if: "IF",
	// biome-ignore lint/suspicious/noThenProperty: shell keyword lookup table, not a thenable
	then: "THEN",
	else: "ELSE",
	elif: "ELIF",
	fi: "FI",
	for: "FOR",
	while: "WHILE",
	until: "UNTIL",
	do: "DO",
	done: "DONE",
	case: "CASE",
	esac: "ESAC",
	in: "IN",
	select: "SELECT",
	function: "FUNCTION",
	coproc: "COPROC",
	time: "TIME",
};

export class Tokenizer {
	private input: string;
	private pos: number;
	private line: number;
	private column: number;
	private peeked: Token | null;
	private reservedWordContext: boolean;
	private pendingHeredocs: {
		delimiter: string;
		stripTabs: boolean;
		quoted: boolean;
		token: Token;
	}[];

	constructor(input: string) {
		this.input = input;
		this.pos = 0;
		this.line = 1;
		this.column = 1;
		this.peeked = null;
		this.reservedWordContext = true;
		this.pendingHeredocs = [];
	}

	private ch(): string {
		return this.pos < this.input.length ? this.input[this.pos] : "";
	}

	private lookahead(n: number): string {
		return this.pos + n < this.input.length ? this.input[this.pos + n] : "";
	}

	private advance(): string {
		const c = this.input[this.pos];
		this.pos++;
		if (c === "\n") {
			this.line++;
			this.column = 1;
		} else {
			this.column++;
		}
		return c;
	}

	private position(): Position {
		return { line: this.line, column: this.column, offset: this.pos };
	}

	private skipWhitespace(): void {
		while (this.pos < this.input.length) {
			const c = this.ch();
			if (c === " " || c === "\t") {
				this.advance();
			} else if (c === "\\" && this.lookahead(1) === "\n") {
				// Line continuation
				this.advance();
				this.advance();
			} else {
				break;
			}
		}
	}

	private skipComment(): void {
		if (this.ch() === "#") {
			while (this.pos < this.input.length && this.ch() !== "\n") {
				this.advance();
			}
		}
	}

	private readSingleQuoted(): string {
		// Opening quote already consumed
		let value = "";
		while (this.pos < this.input.length) {
			const c = this.ch();
			if (c === "'") {
				this.advance();
				return value;
			}
			value += this.advance();
		}
		throw this.error("Unterminated single quote");
	}

	private readDoubleQuoted(): string {
		// Opening quote already consumed
		let value = "";
		while (this.pos < this.input.length) {
			const c = this.ch();
			if (c === '"') {
				this.advance();
				return value;
			}
			if (c === "\\") {
				const next = this.lookahead(1);
				if (next === "$" || next === "`" || next === '"' || next === "\\" || next === "\n") {
					this.advance();
					if (next === "\n") {
						this.advance();
						continue;
					}
					value += this.advance();
					continue;
				}
			}
			if (c === "$") {
				value += this.readDollarRaw();
				continue;
			}
			if (c === "`") {
				value += this.readBacktickRaw();
				continue;
			}
			value += this.advance();
		}
		throw this.error("Unterminated double quote");
	}

	private readDollarRaw(): string {
		let result = "";
		result += this.advance(); // $
		const c = this.ch();

		if (c === "(") {
			if (this.lookahead(1) === "(") {
				// $(( ... ))
				result += this.advance(); // (
				result += this.advance(); // (
				let depth = 1;
				while (this.pos < this.input.length && depth > 0) {
					if (this.ch() === "(" && this.lookahead(1) === "(") {
						depth++;
						result += this.advance();
						result += this.advance();
					} else if (this.ch() === ")" && this.lookahead(1) === ")") {
						depth--;
						result += this.advance();
						result += this.advance();
					} else {
						result += this.advance();
					}
				}
			} else {
				// $( ... )
				result += this.advance(); // (
				let depth = 1;
				while (this.pos < this.input.length && depth > 0) {
					const ch = this.ch();
					if (ch === "(") depth++;
					if (ch === ")") depth--;
					if (depth > 0) {
						if (ch === "'") {
							result += this.advance();
							while (this.pos < this.input.length && this.ch() !== "'") {
								result += this.advance();
							}
							if (this.ch() === "'") result += this.advance();
						} else if (ch === '"') {
							result += this.advance();
							result += this.readDoubleQuoted();
							result += '"';
						} else {
							result += this.advance();
						}
					} else {
						result += this.advance();
					}
				}
			}
		} else if (c === "{") {
			result += this.advance(); // {
			let depth = 1;
			while (this.pos < this.input.length && depth > 0) {
				const ch = this.ch();
				if (ch === "{") depth++;
				if (ch === "}") depth--;
				if (depth > 0) {
					if (ch === "'") {
						result += this.advance();
						while (this.pos < this.input.length && this.ch() !== "'") {
							result += this.advance();
						}
						if (this.ch() === "'") result += this.advance();
					} else if (ch === '"') {
						result += this.advance();
						result += this.readDoubleQuoted();
						result += '"';
					} else {
						result += this.advance();
					}
				} else {
					result += this.advance();
				}
			}
		} else if (isNameChar(c) || isSpecialParam(c)) {
			if (isSpecialParam(c)) {
				result += this.advance();
			} else {
				while (this.pos < this.input.length && isNameChar(this.ch())) {
					result += this.advance();
				}
			}
		}

		return result;
	}

	private readBacktickRaw(): string {
		let result = "";
		result += this.advance(); // `
		while (this.pos < this.input.length) {
			const c = this.ch();
			if (c === "`") {
				result += this.advance();
				return result;
			}
			if (c === "\\") {
				result += this.advance();
				if (this.pos < this.input.length) {
					result += this.advance();
				}
				continue;
			}
			result += this.advance();
		}
		throw this.error("Unterminated backtick");
	}

	private readWord(): string {
		let word = "";
		while (this.pos < this.input.length) {
			const c = this.ch();

			if (c === "\\") {
				this.advance();
				if (this.pos < this.input.length) {
					if (this.ch() === "\n") {
						this.advance();
						continue;
					}
					word += this.advance();
				}
				continue;
			}

			if (c === "'") {
				word += c;
				this.advance();
				word += this.readSingleQuoted();
				word += "'";
				continue;
			}

			if (c === '"') {
				word += c;
				this.advance();
				word += this.readDoubleQuoted();
				word += '"';
				continue;
			}

			if (c === "$") {
				word += this.readDollarRaw();
				continue;
			}

			if (c === "`") {
				word += this.readBacktickRaw();
				continue;
			}

			if (isMetaChar(c)) {
				break;
			}

			word += this.advance();
		}
		return word;
	}

	private isAssignmentWord(word: string): boolean {
		// Check if word matches NAME=... or NAME+=...
		let i = 0;
		if (i < word.length && (isLetter(word[i]) || word[i] === "_")) {
			i++;
			while (i < word.length && isNameChar(word[i])) {
				i++;
			}
			if (i < word.length) {
				if (word[i] === "=") return true;
				if (word[i] === "+" && i + 1 < word.length && word[i + 1] === "=") return true;
			}
		}
		return false;
	}

	private readHeredocBodies(): void {
		if (this.pendingHeredocs.length === 0) return;

		for (const hd of this.pendingHeredocs) {
			let body = "";
			while (this.pos < this.input.length) {
				const _lineStart = this.pos;
				let line = "";

				// Read a line
				while (this.pos < this.input.length && this.ch() !== "\n") {
					line += this.advance();
				}
				if (this.pos < this.input.length) {
					this.advance(); // consume \n
				}

				const trimmedLine = hd.stripTabs ? line.replace(/^\t+/, "") : line;

				if (trimmedLine === hd.delimiter) {
					// End of heredoc
					break;
				}

				body += `${line}\n`;
			}

			// Attach body to the token — we store it in the value with a special encoding
			// The parser will extract it
			hd.token.value = `${hd.token.value}\x00${body}\x00${hd.quoted ? "1" : "0"}`;
		}

		this.pendingHeredocs = [];
	}

	next(): Token {
		if (this.peeked) {
			const t = this.peeked;
			this.peeked = null;
			return t;
		}
		return this.readToken();
	}

	peek(): Token {
		if (!this.peeked) {
			this.peeked = this.readToken();
		}
		return this.peeked;
	}

	private readToken(): Token {
		this.skipWhitespace();
		this.skipComment();

		if (this.pos >= this.input.length) {
			return { type: "EOF", value: "", position: this.position() };
		}

		const pos = this.position();
		const c = this.ch();

		// Newline
		if (c === "\n") {
			this.advance();
			this.readHeredocBodies();
			this.reservedWordContext = true;
			return { type: "NEWLINE", value: "\n", position: pos };
		}

		// Operators
		const op = this.tryReadOperator(pos);
		if (op) {
			// After operators that start a new command context, reserved words are valid
			if (
				op.type === "PIPE" ||
				op.type === "PIPE_AND" ||
				op.type === "AND" ||
				op.type === "OR" ||
				op.type === "SEMI" ||
				op.type === "AMP" ||
				op.type === "LPAREN"
			) {
				this.reservedWordContext = true;
			} else {
				this.reservedWordContext = false;
			}
			return op;
		}

		// Words
		const word = this.readWord();
		if (word === "") {
			throw this.error(`Unexpected character: '${this.ch()}'`);
		}

		// Check for fd number followed by redirect
		if (/^\d+$/.test(word)) {
			const nextCh = this.ch();
			if (nextCh === "<" || nextCh === ">") {
				// This is a fd prefix to a redirect — put the number back and let
				// the caller handle it. Actually, we return it as WORD and let the
				// parser figure it out.
			}
		}

		// Check if it's an assignment word (only in assignment-valid positions)
		if (this.isAssignmentWord(word)) {
			this.reservedWordContext = true;
			return { type: "ASSIGNMENT_WORD", value: word, position: pos };
		}

		// Check for reserved words
		if (this.reservedWordContext && word in RESERVED_WORDS) {
			const type = RESERVED_WORDS[word];
			// After certain reserved words, the next token can also be reserved
			if (
				type === "IF" ||
				type === "THEN" ||
				type === "ELSE" ||
				type === "ELIF" ||
				type === "DO" ||
				type === "WHILE" ||
				type === "UNTIL" ||
				type === "FOR" ||
				type === "SELECT" ||
				type === "CASE" ||
				type === "TIME" ||
				type === "FUNCTION"
			) {
				this.reservedWordContext = true;
			} else {
				this.reservedWordContext = false;
			}
			return { type, value: word, position: pos };
		}

		this.reservedWordContext = false;
		return { type: "WORD", value: word, position: pos };
	}

	private tryReadOperator(pos: Position): Token | null {
		const c = this.ch();
		const c2 = this.lookahead(1);
		const c3 = this.lookahead(2);

		switch (c) {
			case "|":
				if (c2 === "|") {
					this.advance();
					this.advance();
					return { type: "OR", value: "||", position: pos };
				}
				if (c2 === "&") {
					this.advance();
					this.advance();
					return { type: "PIPE_AND", value: "|&", position: pos };
				}
				this.advance();
				return { type: "PIPE", value: "|", position: pos };

			case "&":
				if (c2 === "&") {
					this.advance();
					this.advance();
					return { type: "AND", value: "&&", position: pos };
				}
				if (c2 === ">") {
					if (c3 === ">") {
						this.advance();
						this.advance();
						this.advance();
						return { type: "AND_DGREAT", value: "&>>", position: pos };
					}
					this.advance();
					this.advance();
					return { type: "AND_GREAT", value: "&>", position: pos };
				}
				this.advance();
				return { type: "AMP", value: "&", position: pos };

			case ";":
				if (c2 === ";") {
					if (c3 === "&") {
						this.advance();
						this.advance();
						this.advance();
						return { type: "DSEMI_AND", value: ";;&", position: pos };
					}
					this.advance();
					this.advance();
					return { type: "DSEMI", value: ";;", position: pos };
				}
				if (c2 === "&") {
					this.advance();
					this.advance();
					return { type: "SEMI_AND", value: ";&", position: pos };
				}
				this.advance();
				return { type: "SEMI", value: ";", position: pos };

			case "<":
				if (c2 === "<") {
					if (c3 === "<") {
						this.advance();
						this.advance();
						this.advance();
						return { type: "TLESS", value: "<<<", position: pos };
					}
					if (c3 === "-") {
						this.advance();
						this.advance();
						this.advance();
						return { type: "DLESSDASH", value: "<<-", position: pos };
					}
					this.advance();
					this.advance();
					return { type: "DLESS", value: "<<", position: pos };
				}
				if (c2 === "&") {
					this.advance();
					this.advance();
					return { type: "LESSAND", value: "<&", position: pos };
				}
				if (c2 === ">") {
					this.advance();
					this.advance();
					return { type: "LESSGREAT", value: "<>", position: pos };
				}
				// Process substitution <( is not an operator, let readWord handle it
				if (c2 === "(") {
					return null;
				}
				this.advance();
				return { type: "LESS", value: "<", position: pos };

			case ">":
				if (c2 === ">") {
					this.advance();
					this.advance();
					return { type: "DGREAT", value: ">>", position: pos };
				}
				if (c2 === "&") {
					this.advance();
					this.advance();
					return { type: "GREATAND", value: ">&", position: pos };
				}
				if (c2 === "|") {
					this.advance();
					this.advance();
					return { type: "CLOBBER", value: ">|", position: pos };
				}
				// Process substitution >( handled by readWord
				if (c2 === "(") {
					return null;
				}
				this.advance();
				return { type: "GREAT", value: ">", position: pos };

			case "(":
				this.advance();
				return { type: "LPAREN", value: "(", position: pos };

			case ")":
				this.advance();
				return { type: "RPAREN", value: ")", position: pos };

			case "!":
				// ! is only a reserved word at command position
				// Check if it's followed by a meta char or space
				if (c2 === "" || c2 === " " || c2 === "\t" || c2 === "\n" || isMetaChar(c2)) {
					this.advance();
					return { type: "BANG", value: "!", position: pos };
				}
				return null;

			case "{":
				// { is a reserved word, only recognized as token if followed by whitespace
				if (c2 === " " || c2 === "\t" || c2 === "\n" || c2 === "") {
					this.advance();
					this.reservedWordContext = true;
					return { type: "LBRACE", value: "{", position: pos };
				}
				return null;

			case "}":
				this.advance();
				return { type: "RBRACE", value: "}", position: pos };
		}

		return null;
	}

	registerHeredoc(token: Token, delimiter: string, stripTabs: boolean, quoted: boolean): void {
		this.pendingHeredocs.push({ delimiter, stripTabs, quoted, token });
	}

	error(message: string): Error {
		return new Error(`Tokenizer error at line ${this.line}, column ${this.column}: ${message}`);
	}
}

function isLetter(c: string): boolean {
	return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

function isNameChar(c: string): boolean {
	return isLetter(c) || c === "_" || (c >= "0" && c <= "9");
}

function isSpecialParam(c: string): boolean {
	return c === "@" || c === "*" || c === "#" || c === "?" || c === "-" || c === "$" || c === "!";
}

function isMetaChar(c: string): boolean {
	return (
		c === " " ||
		c === "\t" ||
		c === "\n" ||
		c === "|" ||
		c === "&" ||
		c === ";" ||
		c === "(" ||
		c === ")" ||
		c === "<" ||
		c === ">"
	);
}
