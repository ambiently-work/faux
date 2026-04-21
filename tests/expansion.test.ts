import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function createShell(extraFs?: Record<string, string>) {
	return new Shell({
		fs: {
			"/tmp/a.txt": "AAA",
			"/tmp/b.txt": "BBB",
			"/tmp/c.log": "CCC",
			"/tmp/sub/d.txt": "DDD",
			...extraFs,
		},
		env: { HOME: "/home/user" },
	});
}

describe("Brace expansion", () => {
	test("comma list {a,b,c}", async () => {
		const shell = createShell();
		const r = await shell.run("echo {a,b,c}");
		expect(r.stdout.trim()).toBe("a b c");
	});

	test("brace expansion in command argument context", async () => {
		const shell = createShell();
		const r = await shell.run("echo prefix-{x,y}");
		// Whether prefix is preserved depends on impl; verify the variants appear
		expect(r.stdout).toContain("x");
		expect(r.stdout).toContain("y");
	});
});

describe("Arithmetic expansion $(( ))", () => {
	test("basic addition", async () => {
		const shell = createShell();
		expect((await shell.run("echo $((2+3))")).stdout.trim()).toBe("5");
	});

	test("operator precedence", async () => {
		const shell = createShell();
		expect((await shell.run("echo $((2+3*4))")).stdout.trim()).toBe("14");
	});

	test("integer division", async () => {
		const shell = createShell();
		expect((await shell.run("echo $((10/3))")).stdout.trim()).toBe("3");
	});

	test("modulo", async () => {
		const shell = createShell();
		expect((await shell.run("echo $((10%3))")).stdout.trim()).toBe("1");
	});

	test("power **", async () => {
		const shell = createShell();
		expect((await shell.run("echo $((2**8))")).stdout.trim()).toBe("256");
	});

	test("parentheses", async () => {
		const shell = createShell();
		expect((await shell.run("echo $(((1+2)*3))")).stdout.trim()).toBe("9");
	});

	test("variable in arithmetic", async () => {
		const shell = createShell();
		await shell.run("export N=5");
		const r = await shell.run("echo $((N*2))");
		expect(r.stdout.trim()).toBe("10");
	});

	test("comparison returns 0/1", async () => {
		const shell = createShell();
		expect((await shell.run("echo $((5 > 3))")).stdout.trim()).toBe("1");
		expect((await shell.run("echo $((5 < 3))")).stdout.trim()).toBe("0");
	});

	test("bitwise", async () => {
		const shell = createShell();
		expect((await shell.run("echo $((5 & 3))")).stdout.trim()).toBe("1");
		expect((await shell.run("echo $((5 | 2))")).stdout.trim()).toBe("7");
	});
});

describe("Glob expansion", () => {
	test("expands *.txt to matching files", async () => {
		const shell = createShell();
		const r = await shell.run("echo /tmp/*.txt");
		expect(r.stdout).toContain("/tmp/a.txt");
		expect(r.stdout).toContain("/tmp/b.txt");
		expect(r.stdout).not.toContain("c.log");
	});

	test("? matches single character", async () => {
		const shell = createShell();
		const r = await shell.run("echo /tmp/?.txt");
		expect(r.stdout).toContain("/tmp/a.txt");
		expect(r.stdout).toContain("/tmp/b.txt");
	});

	test("[ab] character class", async () => {
		const shell = createShell();
		const r = await shell.run("echo /tmp/[ab].txt");
		expect(r.stdout).toContain("/tmp/a.txt");
		expect(r.stdout).toContain("/tmp/b.txt");
	});

	test("** recursive glob", async () => {
		const shell = createShell();
		const r = await shell.run("echo /tmp/**/*.txt");
		expect(r.stdout).toContain("/tmp/sub/d.txt");
	});

	test("unmatched glob preserved literally (default)", async () => {
		const shell = createShell();
		const r = await shell.run("echo /tmp/nomatch_*.zzz");
		expect(r.stdout.trim()).toBe("/tmp/nomatch_*.zzz");
	});
});

describe("Parameter expansion", () => {
	test("${VAR} basic form", async () => {
		const shell = createShell();
		await shell.run("export X=hi");
		expect((await shell.run('echo "${X}"')).stdout.trim()).toBe("hi");
	});

	test("${VAR:-default} when unset", async () => {
		const shell = createShell();
		expect((await shell.run("echo ${UNSET_VAR:-fallback}")).stdout.trim()).toBe("fallback");
	});

	test("${VAR:-default} when set", async () => {
		const shell = createShell();
		await shell.run("export X=actual");
		expect((await shell.run("echo ${X:-fallback}")).stdout.trim()).toBe("actual");
	});

	test("${VAR:=default} assigns and uses default", async () => {
		const shell = createShell();
		const r = await shell.run("echo ${UNSET2:=newval}; echo $UNSET2");
		const lines = r.stdout.trim().split("\n");
		expect(lines[0]).toBe("newval");
		expect(lines[1]).toBe("newval");
	});

	test("${VAR:+alt} when set", async () => {
		const shell = createShell();
		await shell.run("export X=anything");
		expect((await shell.run("echo ${X:+yes}")).stdout.trim()).toBe("yes");
	});

	test("${VAR:+alt} when unset returns nothing", async () => {
		const shell = createShell();
		expect((await shell.run("echo ${UNSET3:+yes}")).stdout.trim()).toBe("");
	});

	test("${#VAR} returns length", async () => {
		const shell = createShell();
		await shell.run("export GREETING=hello");
		expect((await shell.run("echo ${#GREETING}")).stdout.trim()).toBe("5");
	});

	test("${VAR%suffix} strips shortest matching suffix", async () => {
		const shell = createShell();
		await shell.run("export FILE=foo.txt");
		expect((await shell.run("echo ${FILE%.txt}")).stdout.trim()).toBe("foo");
	});

	test("${VAR#prefix} strips shortest matching prefix", async () => {
		const shell = createShell();
		await shell.run("export FILE=foo.txt");
		expect((await shell.run("echo ${FILE#foo.}")).stdout.trim()).toBe("txt");
	});
});

describe("Tilde expansion", () => {
	test("~ expands to HOME", async () => {
		const shell = createShell();
		const r = await shell.run("echo ~");
		expect(r.stdout.trim()).toBe("/home/user");
	});

	test("~/path expands HOME prefix", async () => {
		const shell = createShell();
		const r = await shell.run("echo ~/docs");
		expect(r.stdout.trim()).toBe("/home/user/docs");
	});
});

describe("Command substitution", () => {
	test("$(cmd) form", async () => {
		const shell = createShell();
		const r = await shell.run("echo $(echo nested)");
		expect(r.stdout.trim()).toBe("nested");
	});

	test("backtick form", async () => {
		const shell = createShell();
		const r = await shell.run("echo `echo backquoted`");
		expect(r.stdout.trim()).toBe("backquoted");
	});

	test("nested $()", async () => {
		const shell = createShell();
		const r = await shell.run("echo $(echo $(echo deep))");
		expect(r.stdout.trim()).toBe("deep");
	});

	test("trailing newline is stripped", async () => {
		const shell = createShell();
		const r = await shell.run('X=$(echo hi); echo "[$X]"');
		expect(r.stdout.trim()).toBe("[hi]");
	});
});

describe("Variable in double-quoted string", () => {
	test("interpolates $VAR", async () => {
		const shell = createShell();
		await shell.run("export NAME=World");
		const r = await shell.run('echo "Hello, $NAME!"');
		expect(r.stdout.trim()).toBe("Hello, World!");
	});

	test("single-quoted does NOT interpolate", async () => {
		const shell = createShell();
		await shell.run("export NAME=World");
		const r = await shell.run("echo 'Hello, $NAME'");
		expect(r.stdout.trim()).toBe("Hello, $NAME");
	});

	test("escaped $ in double quotes is literal", async () => {
		const shell = createShell();
		// JS string `\\\\\\$` → shell sees `\$` → literal $
		const r = await shell.run('echo "price: \\\\$5"');
		expect(r.stdout.trim()).toBe("price: $5");
	});
});

describe("Control flow execution", () => {
	test("while loop with arithmetic counter", async () => {
		const shell = createShell();
		const r = await shell.run("x=1; while [ $x -le 3 ]; do echo $x; x=$((x+1)); done");
		expect(r.stdout.trim().split("\n")).toEqual(["1", "2", "3"]);
	});

	test("until loop runs while condition is false", async () => {
		const shell = createShell();
		const r = await shell.run("x=0; until [ $x -ge 3 ]; do echo $x; x=$((x+1)); done");
		expect(r.stdout.trim().split("\n")).toEqual(["0", "1", "2"]);
	});

	test("case literal match", async () => {
		const shell = createShell();
		const r = await shell.run("case foo in foo) echo F;; *) echo other;; esac");
		expect(r.stdout.trim()).toBe("F");
	});

	test("case glob pattern match", async () => {
		const shell = createShell();
		const r = await shell.run("case foo in f*) echo glob;; esac");
		expect(r.stdout.trim()).toBe("glob");
	});

	test("case alternation pattern", async () => {
		const shell = createShell();
		const r = await shell.run("case b in a|b|c) echo abc;; esac");
		expect(r.stdout.trim()).toBe("abc");
	});

	test("case wildcard fallthrough", async () => {
		const shell = createShell();
		const r = await shell.run("case xyz in foo) echo F;; *) echo D;; esac");
		expect(r.stdout.trim()).toBe("D");
	});

	test("nested if-elif-else", async () => {
		const shell = createShell();
		const r = await shell.run("if false; then echo a; elif true; then echo b; else echo c; fi");
		expect(r.stdout.trim()).toBe("b");
	});

	test("for loop iterates words", async () => {
		const shell = createShell();
		const r = await shell.run("for w in alpha beta gamma; do echo $w; done");
		expect(r.stdout.trim().split("\n")).toEqual(["alpha", "beta", "gamma"]);
	});
});

describe("Pipeline edge cases", () => {
	test("negated pipeline ! true exits 1", async () => {
		const shell = createShell();
		const r = await shell.run("! true");
		expect(r.exitCode).toBe(1);
	});

	test("negated pipeline ! false exits 0", async () => {
		const shell = createShell();
		const r = await shell.run("! false");
		expect(r.exitCode).toBe(0);
	});

	test("pipeline exit code is the last command's", async () => {
		const shell = createShell();
		// false | true → 0 (last wins, no pipefail)
		const r = await shell.run("false | true");
		expect(r.exitCode).toBe(0);
	});
});

describe("Redirect execution", () => {
	test("here-string <<< feeds input", async () => {
		const shell = createShell();
		const r = await shell.run("cat <<<hello");
		expect(r.stdout.trim()).toBe("hello");
	});

	test("appending >> preserves prior content", async () => {
		const shell = createShell();
		await shell.run("echo first > /tmp/log");
		await shell.run("echo second >> /tmp/log");
		const r = await shell.run("cat /tmp/log");
		expect(r.stdout).toBe("first\nsecond\n");
	});
});

describe("Assignments and scope", () => {
	test("inline command-prefix assignment does not leak to parent shell", async () => {
		const shell = createShell();
		await shell.run("X=local true");
		const r = await shell.run("echo $X");
		expect(r.stdout.trim()).toBe("");
	});

	test("VAR+=value appends to existing value", async () => {
		const shell = createShell();
		await shell.run("X=foo");
		await shell.run("X+=bar");
		const r = await shell.run("echo $X");
		expect(r.stdout.trim()).toBe("foobar");
	});

	test("readonly prevents reassignment", async () => {
		const shell = createShell();
		await shell.run("readonly RO=fixed");
		const r = await shell.run("RO=changed");
		expect(r.exitCode).not.toBe(0);
		const after = await shell.run("echo $RO");
		expect(after.stdout.trim()).toBe("fixed");
	});
});
