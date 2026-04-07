import { describe, expect, test } from "bun:test";
import { parse } from "../index.js";
import type { AstNode, CommandNode, PipelineNode, ListNode, IfNode, ForNode, FunctionNode } from "../ast.js";

describe("Parser", () => {
	describe("simple commands", () => {
		test("parses single command", () => {
			const ast = parse("echo hello") as CommandNode;
			expect(ast.type).toBe("command");
			expect(ast.name[0]).toEqual({ type: "literal", value: "echo" });
			expect(ast.args).toHaveLength(1);
			expect(ast.args[0][0]).toEqual({ type: "literal", value: "hello" });
		});

		test("parses command with multiple args", () => {
			const ast = parse("ls -la /tmp") as CommandNode;
			expect(ast.type).toBe("command");
			expect(ast.args).toHaveLength(2);
		});

		test("parses empty input as empty command", () => {
			const ast = parse("") as CommandNode;
			expect(ast.type).toBe("command");
			expect(ast.name).toHaveLength(0);
		});
	});

	describe("pipes", () => {
		test("parses simple pipe", () => {
			const ast = parse("echo hello | grep hell") as PipelineNode;
			expect(ast.type).toBe("pipeline");
			expect(ast.commands).toHaveLength(2);
		});

		test("parses multi-stage pipe", () => {
			const ast = parse("cat file | grep foo | wc -l") as PipelineNode;
			expect(ast.type).toBe("pipeline");
			expect(ast.commands).toHaveLength(3);
		});
	});

	describe("operators", () => {
		test("parses && operator", () => {
			const ast = parse("true && echo ok") as ListNode;
			expect(ast.type).toBe("list");
			expect(ast.operator).toBe("&&");
		});

		test("parses || operator", () => {
			const ast = parse("false || echo fallback") as ListNode;
			expect(ast.type).toBe("list");
			expect(ast.operator).toBe("||");
		});

		test("parses ; operator", () => {
			const ast = parse("echo a; echo b") as ListNode;
			expect(ast.type).toBe("list");
			expect(ast.operator).toBe(";");
		});
	});

	describe("quoting", () => {
		test("parses single quotes", () => {
			const ast = parse("echo 'hello world'") as CommandNode;
			expect(ast.args[0][0]).toEqual({ type: "singleQuoted", value: "hello world" });
		});

		test("parses double quotes with literal", () => {
			const ast = parse('echo "hello"') as CommandNode;
			expect(ast.args[0][0]).toHaveProperty("type", "doubleQuoted");
		});
	});

	describe("variables", () => {
		test("parses $VAR", () => {
			const ast = parse("echo $HOME") as CommandNode;
			expect(ast.args[0][0]).toEqual({ type: "variable", name: "HOME" });
		});

		test("parses ${VAR:-default}", () => {
			const ast = parse("echo ${VAR:-default}") as CommandNode;
			const part = ast.args[0][0];
			expect(part.type).toBe("variableExpansion");
		});
	});

	describe("redirects", () => {
		test("parses output redirect", () => {
			const ast = parse("echo hello > /tmp/out") as CommandNode;
			expect(ast.redirects).toHaveLength(1);
			expect(ast.redirects[0].op).toBe(">");
		});

		test("parses append redirect", () => {
			const ast = parse("echo hello >> /tmp/out") as CommandNode;
			expect(ast.redirects).toHaveLength(1);
			expect(ast.redirects[0].op).toBe(">>");
		});

		test("parses input redirect", () => {
			const ast = parse("cat < /tmp/in") as CommandNode;
			expect(ast.redirects).toHaveLength(1);
			expect(ast.redirects[0].op).toBe("<");
		});
	});

	describe("control flow", () => {
		test("parses if statement", () => {
			const ast = parse("if true; then echo yes; fi") as IfNode;
			expect(ast.type).toBe("if");
			expect(ast.clauses).toHaveLength(1);
		});

		test("parses if-else", () => {
			const ast = parse("if false; then echo no; else echo yes; fi") as IfNode;
			expect(ast.type).toBe("if");
			expect(ast.elseBody).toBeDefined();
		});

		test("parses for loop", () => {
			const ast = parse("for x in a b c; do echo $x; done") as ForNode;
			expect(ast.type).toBe("for");
			expect(ast.variable).toBe("x");
			expect(ast.words).toHaveLength(3);
		});
	});

	describe("functions", () => {
		test("parses function definition", () => {
			const ast = parse("greet() { echo hello; }") as FunctionNode;
			expect(ast.type).toBe("function");
			expect(ast.name).toBe("greet");
		});
	});

	describe("subshells", () => {
		test("parses subshell", () => {
			const ast = parse("(cd /tmp && ls)");
			expect(ast.type).toBe("subshell");
		});
	});

	describe("command substitution", () => {
		test("parses $(cmd)", () => {
			const ast = parse("echo $(whoami)") as CommandNode;
			expect(ast.args[0][0].type).toBe("commandSubstitution");
		});
	});

	describe("assignments", () => {
		test("parses variable assignment", () => {
			const ast = parse("X=hello");
			expect(ast.type).toBe("assignment");
		});
	});
});
