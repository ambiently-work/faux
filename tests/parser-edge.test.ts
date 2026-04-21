import { describe, expect, test } from "bun:test";
import type {
	AssignmentNode,
	BraceGroupNode,
	CaseNode,
	CommandNode,
	FunctionNode,
	ListNode,
	PipelineNode,
	SubshellNode,
	UntilNode,
	WhileNode,
} from "../src/parser/ast.js";
import { parse } from "../src/parser/index.js";

describe("Parser — control flow", () => {
	test("while loop", () => {
		const ast = parse("while true; do echo x; done") as WhileNode;
		expect(ast.type).toBe("while");
		expect(ast.condition).toBeDefined();
		expect(ast.body).toBeDefined();
	});

	test("until loop", () => {
		const ast = parse("until false; do echo x; done") as UntilNode;
		expect(ast.type).toBe("until");
	});

	test("case statement with multiple patterns", () => {
		const ast = parse("case x in a) cmd1 ;; b|c) cmd2 ;; *) cmd3 ;; esac") as CaseNode;
		expect(ast.type).toBe("case");
		expect(ast.items).toHaveLength(3);
		expect(ast.items[1].patterns).toHaveLength(2); // b|c → 2 patterns
	});

	test("case terminator types preserved", () => {
		const ast = parse("case x in a) cmd ;; esac") as CaseNode;
		expect(ast.items[0].terminator).toBe(";;");
	});

	test("brace group { ; }", () => {
		const ast = parse("{ echo a; echo b; }") as BraceGroupNode;
		expect(ast.type).toBe("braceGroup");
	});
});

describe("Parser — pipelines & lists", () => {
	test("pipeline with stderr |& sets pipeStderr", () => {
		const ast = parse("echo a |& cat") as PipelineNode;
		expect(ast.type).toBe("pipeline");
		expect(ast.pipeStderr).toBe(true);
	});

	test("negated pipeline ! cmd", () => {
		const ast = parse("! true") as PipelineNode;
		expect(ast.type).toBe("pipeline");
		expect(ast.negated).toBe(true);
	});

	test("background operator & creates list", () => {
		const ast = parse("echo a & echo b") as ListNode;
		expect(ast.type).toBe("list");
		expect(ast.operator).toBe("&");
	});

	test("chained ; semicolons nest as lists", () => {
		const ast = parse("a; b; c") as ListNode;
		expect(ast.type).toBe("list");
		// Either left-nested or right-nested; just check it's a list of lists
		const hasNested = ast.left.type === "list" || ast.right.type === "list";
		expect(hasNested).toBe(true);
	});
});

describe("Parser — redirects", () => {
	test("2>&1 produces a >& redirect on fd 2 to '1'", () => {
		const ast = parse("echo a > out 2>&1") as CommandNode;
		expect(ast.redirects).toHaveLength(2);
		const dup = ast.redirects.find((r) => r.fd === 2);
		expect(dup?.op).toBe(">&");
		expect(dup?.target[0]).toEqual({ type: "literal", value: "1" });
	});

	test("&> redirects both stdout and stderr", () => {
		const ast = parse("echo a &> /tmp/x") as CommandNode;
		expect(ast.redirects).toHaveLength(1);
		expect(ast.redirects[0].op).toBe("&>");
	});

	test("here-string <<<", () => {
		const ast = parse("cat <<<input") as CommandNode;
		expect(ast.redirects).toHaveLength(1);
		expect(ast.redirects[0].op).toBe("<<<");
	});

	test("heredoc <<EOF parses delimiter", () => {
		const ast = parse("cat <<EOF") as CommandNode;
		const r = ast.redirects[0];
		expect(r.op).toBe("<<");
		expect(r.heredocDelimiter).toBe("EOF");
		expect(r.heredocQuoted).toBe(false);
	});

	test("custom fd > redirect", () => {
		const ast = parse("cmd 5> out") as CommandNode;
		expect(ast.redirects[0].fd).toBe(5);
	});
});

describe("Parser — quoting & expansions", () => {
	test("double-quoted preserves variable parts inline", () => {
		const ast = parse('echo "hi $NAME"') as CommandNode;
		const dq = ast.args[0][0];
		expect(dq.type).toBe("doubleQuoted");
		if (dq.type === "doubleQuoted") {
			expect(dq.parts.some((p) => p.type === "variable" && p.name === "NAME")).toBe(true);
		}
	});

	test("single-quoted is literal (no expansion)", () => {
		const ast = parse("echo 'hi $NAME'") as CommandNode;
		expect(ast.args[0][0]).toEqual({ type: "singleQuoted", value: "hi $NAME" });
	});

	test("brace expansion {a,b,c}", () => {
		const ast = parse("echo {a,b,c}") as CommandNode;
		const part = ast.args[0].find((p) => p.type === "braceExpansion");
		expect(part).toBeDefined();
		if (part?.type === "braceExpansion") {
			expect(part.parts).toHaveLength(3);
		}
	});

	test("tilde expansion ~", () => {
		const ast = parse("echo ~") as CommandNode;
		expect(ast.args[0][0].type).toBe("tilde");
	});

	test("tilde with username ~user", () => {
		const ast = parse("echo ~someuser") as CommandNode;
		const t = ast.args[0][0];
		expect(t.type).toBe("tilde");
		if (t.type === "tilde") expect(t.user).toBe("someuser");
	});

	test("arithmetic expansion $((1+2))", () => {
		const ast = parse("echo $((1+2))") as CommandNode;
		const part = ast.args[0][0];
		expect(part.type).toBe("arithmeticExpansion");
		if (part.type === "arithmeticExpansion") expect(part.expression.replace(/\s/g, "")).toBe("1+2");
	});

	test("glob pattern *.txt", () => {
		const ast = parse("ls *.txt") as CommandNode;
		const hasGlob = ast.args[0].some((p) => p.type === "glob");
		expect(hasGlob).toBe(true);
	});

	test("backtick command substitution", () => {
		const ast = parse("echo `whoami`") as CommandNode;
		expect(ast.args[0][0].type).toBe("commandSubstitution");
	});

	test("variable expansion ${VAR:-default}", () => {
		const ast = parse("echo ${VAR:-default}") as CommandNode;
		const part = ast.args[0][0];
		expect(part.type).toBe("variableExpansion");
		if (part.type === "variableExpansion") {
			expect(part.name).toBe("VAR");
			expect(part.op).toBe(":-");
		}
	});

	test("variable length ${#VAR}", () => {
		const ast = parse("echo ${#VAR}") as CommandNode;
		expect(ast.args[0][0].type).toBe("variableLength");
	});
});

describe("Parser — assignments & functions", () => {
	test("inline command-prefix assignments", () => {
		const ast = parse("X=1 Y=2 cmd") as CommandNode;
		expect(ast.type).toBe("command");
		expect(ast.prefix).toHaveLength(2);
		expect(ast.prefix[0].name).toBe("X");
		expect(ast.prefix[1].name).toBe("Y");
	});

	test("VAR+=value sets append flag", () => {
		const ast = parse("VAR+=more") as AssignmentNode;
		expect(ast.type).toBe("assignment");
		expect(ast.append).toBe(true);
	});

	test("function keyword form", () => {
		const ast = parse("function foo { echo x; }") as FunctionNode;
		expect(ast.type).toBe("function");
		expect(ast.name).toBe("foo");
	});

	test("posix function form name() { ... }", () => {
		const ast = parse("foo() { echo x; }") as FunctionNode;
		expect(ast.type).toBe("function");
		expect(ast.name).toBe("foo");
	});
});

describe("Parser — subshell with redirects", () => {
	test("subshell stores body and redirects", () => {
		const ast = parse("(echo a) > out") as SubshellNode;
		expect(ast.type).toBe("subshell");
		expect(ast.redirects).toHaveLength(1);
	});
});

describe("Parser — error handling", () => {
	test("unclosed quote throws", () => {
		expect(() => parse("echo 'unterminated")).toThrow();
	});

	test("unterminated subshell throws", () => {
		expect(() => parse("(echo")).toThrow();
	});
});
