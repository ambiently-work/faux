import type { AstNode } from "./ast.js";
import { Parser } from "./parser.js";

export type {
	ArithmeticNode,
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
export { Parser } from "./parser.js";
export type { Position, Token, TokenType } from "./tokenizer.js";
export { Tokenizer } from "./tokenizer.js";

let wasmParse: ((input: string) => AstNode) | null = null;

export function useWasmParser(module: { parse(input: string): AstNode }): void {
	wasmParse = (input) => module.parse(input);
}

export function parse(input: string): AstNode {
	if (wasmParse) return wasmParse(input);
	const parser = new Parser(input);
	return parser.parse();
}
