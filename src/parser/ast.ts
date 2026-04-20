// Word parts — handle quoting, expansion, globs
export type WordPart =
	| { type: "literal"; value: string }
	| { type: "singleQuoted"; value: string }
	| { type: "doubleQuoted"; parts: WordPart[] }
	| { type: "variable"; name: string; indirect?: boolean }
	| { type: "variableExpansion"; name: string; op: string; arg: Word }
	| { type: "variableLength"; name: string }
	| { type: "commandSubstitution"; body: AstNode }
	| { type: "arithmeticExpansion"; expression: string }
	| { type: "processSubstitution"; direction: "in" | "out"; body: AstNode }
	| { type: "glob"; pattern: string }
	| { type: "tilde"; user: string }
	| { type: "braceExpansion"; parts: Word[] };

export type Word = WordPart[];

export interface Redirect {
	fd: number;
	op: ">" | ">>" | "<" | "<<" | "<<<" | ">&" | "<&" | "&>" | "&>>" | "<>";
	target: Word;
	heredocDelimiter?: string;
	heredocBody?: string;
	heredocQuoted?: boolean;
}

export type AstNode =
	| CommandNode
	| PipelineNode
	| ListNode
	| SubshellNode
	| BraceGroupNode
	| AssignmentNode
	| IfNode
	| ForNode
	| WhileNode
	| UntilNode
	| CaseNode
	| SelectNode
	| FunctionNode
	| ArithmeticNode;

export interface CommandNode {
	type: "command";
	name: Word;
	prefix: AssignmentNode[];
	args: Word[];
	redirects: Redirect[];
}

export interface PipelineNode {
	type: "pipeline";
	commands: AstNode[];
	negated: boolean;
	pipeStderr: boolean;
}

export interface ListNode {
	type: "list";
	left: AstNode;
	right: AstNode;
	operator: "&&" | "||" | ";" | "&";
}

export interface SubshellNode {
	type: "subshell";
	body: AstNode;
	redirects: Redirect[];
}

export interface BraceGroupNode {
	type: "braceGroup";
	body: AstNode;
	redirects: Redirect[];
}

export interface AssignmentNode {
	type: "assignment";
	name: string;
	value: Word;
	append: boolean;
	export: boolean;
	local: boolean;
	readonly: boolean;
}

export interface IfNode {
	type: "if";
	clauses: { condition: AstNode; body: AstNode }[];
	elseBody?: AstNode;
	redirects: Redirect[];
}

export interface ForNode {
	type: "for";
	variable: string;
	words?: Word[];
	body: AstNode;
	redirects: Redirect[];
}

export interface WhileNode {
	type: "while";
	condition: AstNode;
	body: AstNode;
	redirects: Redirect[];
}

export interface UntilNode {
	type: "until";
	condition: AstNode;
	body: AstNode;
	redirects: Redirect[];
}

export interface CaseNode {
	type: "case";
	word: Word;
	items: {
		patterns: Word[];
		body: AstNode | null;
		terminator: ";;" | ";&" | ";;&";
	}[];
	redirects: Redirect[];
}

export interface SelectNode {
	type: "select";
	variable: string;
	words?: Word[];
	body: AstNode;
	redirects: Redirect[];
}

export interface FunctionNode {
	type: "function";
	name: string;
	body: AstNode;
	redirects: Redirect[];
}

export interface ArithmeticNode {
	type: "arithmetic";
	expression: string;
}
