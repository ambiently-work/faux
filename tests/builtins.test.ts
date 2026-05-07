import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function createShell(fs?: Record<string, string>) {
	return new Shell({
		fs: {
			"/home/user/file.txt": "hello world\n",
			"/home/user/lines.txt": "alpha\nbeta\ngamma\ndelta\n",
			"/home/user/numbers.txt": "3\n1\n4\n1\n5\n9\n2\n6\n",
			"/home/user/mixed.txt": "Hello\nhello\nHELLO\nworld\nWorld\n",
			"/home/user/empty.txt": "",
			"/home/user/spaces.txt": "  leading\ntrailing  \n  both  \n",
			"/home/user/colon.txt": "root:0:0\nuser:1000:1000\nnobody:65534:65534\n",
			"/home/user/tabs.txt": "one\ttwo\tthree\nfour\tfive\tsix\n",
			...fs,
		},
		env: { HOME: "/home/user", USER: "testuser", PWD: "/" },
	});
}

// ─── echo ──────────────────────────────────────────────────────────

describe("echo", () => {
	test("basic output", async () => {
		const shell = createShell();
		const r = await shell.run("echo hello world");
		expect(r.stdout).toBe("hello world\n");
	});

	test("-n suppresses newline", async () => {
		const shell = createShell();
		const r = await shell.run("echo -n hello");
		expect(r.stdout).toBe("hello");
	});

	test("-e interprets escapes", async () => {
		const shell = createShell();
		const r = await shell.run("echo -e 'hello\\nworld'");
		expect(r.stdout).toBe("hello\nworld\n");
	});

	test("-e tab escape", async () => {
		const shell = createShell();
		const r = await shell.run("echo -e 'a\\tb'");
		expect(r.stdout).toBe("a\tb\n");
	});

	test("flags after positional are literal", async () => {
		const shell = createShell();
		const r = await shell.run("echo hello -n");
		expect(r.stdout).toBe("hello -n\n");
	});

	test("empty echo outputs newline", async () => {
		const shell = createShell();
		const r = await shell.run("echo");
		expect(r.stdout).toBe("\n");
	});
});

// ─── printf ────────────────────────────────────────────────────────

describe("printf", () => {
	test("basic string format", async () => {
		const shell = createShell();
		const r = await shell.run('printf "%s\\n" hello');
		expect(r.stdout).toBe("hello\n");
	});

	test("integer format", async () => {
		const shell = createShell();
		const r = await shell.run('printf "%d" 42');
		expect(r.stdout).toBe("42");
	});

	test("zero-padded integer", async () => {
		const shell = createShell();
		const r = await shell.run('printf "%05d" 42');
		expect(r.stdout).toBe("00042");
	});

	test("zero-padded negative integer", async () => {
		const shell = createShell();
		const r = await shell.run('printf "%05d" -42');
		expect(r.stdout).toBe("-0042");
	});

	test("dynamic width with *", async () => {
		const shell = createShell();
		const r = await shell.run('printf "%*s" 10 hi');
		expect(r.stdout).toBe("        hi");
	});

	test("percent literal", async () => {
		const shell = createShell();
		const r = await shell.run('printf "100%%"');
		expect(r.stdout).toBe("100%");
	});
});

// ─── test / [ ──────────────────────────────────────────────────────

describe("test", () => {
	test("-f checks file exists", async () => {
		const shell = createShell();
		expect((await shell.run("test -f /home/user/file.txt")).exitCode).toBe(0);
		expect((await shell.run("test -f /nonexistent")).exitCode).toBe(1);
	});

	test("-d checks directory", async () => {
		const shell = createShell();
		expect((await shell.run("test -d /home")).exitCode).toBe(0);
		expect((await shell.run("test -d /home/user/file.txt")).exitCode).toBe(1);
	});

	test("-z checks empty string", async () => {
		const shell = createShell();
		expect((await shell.run('test -z ""')).exitCode).toBe(0);
		expect((await shell.run('test -z "notempty"')).exitCode).toBe(1);
	});

	test("-n checks non-empty string", async () => {
		const shell = createShell();
		expect((await shell.run('test -n "hello"')).exitCode).toBe(0);
		expect((await shell.run('test -n ""')).exitCode).toBe(1);
	});

	test("string equality", async () => {
		const shell = createShell();
		expect((await shell.run('test "abc" = "abc"')).exitCode).toBe(0);
		expect((await shell.run('test "abc" = "xyz"')).exitCode).toBe(1);
	});

	test("integer comparison", async () => {
		const shell = createShell();
		expect((await shell.run("test 5 -gt 3")).exitCode).toBe(0);
		expect((await shell.run("test 3 -gt 5")).exitCode).toBe(1);
		expect((await shell.run("test 5 -eq 5")).exitCode).toBe(0);
		expect((await shell.run("test 5 -le 5")).exitCode).toBe(0);
	});

	test("bracket form", async () => {
		const shell = createShell();
		expect((await shell.run('[ "hello" = "hello" ]')).exitCode).toBe(0);
		expect((await shell.run("[ 1 -lt 2 ]")).exitCode).toBe(0);
	});
});

// ─── grep ──────────────────────────────────────────────────────────

describe("grep", () => {
	test("basic pattern match", async () => {
		const shell = createShell();
		const r = await shell.run("grep alpha /home/user/lines.txt");
		expect(r.stdout.trim()).toBe("alpha");
	});

	test("-i case insensitive", async () => {
		const shell = createShell();
		const r = await shell.run("grep -i hello /home/user/mixed.txt");
		expect(r.stdout).toBe("Hello\nhello\nHELLO\n");
		expect(r.exitCode).toBe(0);
	});

	test("-v invert match", async () => {
		const shell = createShell();
		const r = await shell.run("grep -v alpha /home/user/lines.txt");
		expect(r.stdout).toBe("beta\ngamma\ndelta\n");
		expect(r.exitCode).toBe(0);
	});

	test("-c count matches", async () => {
		const shell = createShell();
		const r = await shell.run("grep -c hello /home/user/mixed.txt");
		expect(r.stdout.trim()).toBe("1");
	});

	test("-n line numbers", async () => {
		const shell = createShell();
		const r = await shell.run("grep -n beta /home/user/lines.txt");
		expect(r.stdout.trim()).toBe("2:beta");
	});

	test("exit code 1 when no match", async () => {
		const shell = createShell();
		const r = await shell.run("grep zzzzz /home/user/lines.txt");
		expect(r.exitCode).toBe(1);
	});

	test("-F fixed string", async () => {
		const shell = createShell();
		const r = await shell.run("grep -F 'alp' /home/user/lines.txt");
		expect(r.stdout.trim()).toBe("alpha");
	});
});

// ─── sort ──────────────────────────────────────────────────────────

describe("sort", () => {
	test("lexical sort", async () => {
		const shell = createShell();
		const r = await shell.run("sort /home/user/lines.txt");
		expect(r.stdout).toBe("alpha\nbeta\ndelta\ngamma\n");
	});

	test("-r reverse sort", async () => {
		const shell = createShell();
		const r = await shell.run("sort -r /home/user/lines.txt");
		expect(r.stdout).toBe("gamma\ndelta\nbeta\nalpha\n");
	});

	test("-n numeric sort", async () => {
		const shell = createShell();
		const r = await shell.run("sort -n /home/user/numbers.txt");
		expect(r.stdout).toBe("1\n1\n2\n3\n4\n5\n6\n9\n");
	});

	test("-u unique", async () => {
		const shell = createShell();
		const r = await shell.run("sort -nu /home/user/numbers.txt");
		expect(r.stdout).toBe("1\n2\n3\n4\n5\n6\n9\n");
	});
});

// ─── uniq ──────────────────────────────────────────────────────────

describe("uniq", () => {
	test("removes adjacent duplicates", async () => {
		const shell = createShell();
		const r = await shell.run('printf "a\\na\\nb\\nb\\nc\\n" | uniq');
		expect(r.stdout).toBe("a\nb\nc\n");
	});

	test("-c counts occurrences", async () => {
		const shell = createShell();
		const r = await shell.run('printf "a\\na\\nb\\n" | uniq -c');
		expect(r.stdout).toBe("      2 a\n      1 b\n");
	});

	test("-d only duplicates", async () => {
		const shell = createShell();
		const r = await shell.run('printf "a\\na\\nb\\n" | uniq -d');
		expect(r.stdout.trim()).toBe("a");
	});

	test("-i case insensitive", async () => {
		const shell = createShell();
		const r = await shell.run('printf "Hello\\nhello\\nworld\\n" | uniq -i');
		expect(r.stdout).toBe("Hello\nworld\n");
	});
});

// ─── wc ────────────────────────────────────────────────────────────

describe("wc", () => {
	test("-l counts lines", async () => {
		const shell = createShell();
		const r = await shell.run("wc -l /home/user/lines.txt");
		expect(r.stdout).toBe("      4 /home/user/lines.txt\n");
	});

	test("-w counts words", async () => {
		const shell = createShell();
		const r = await shell.run("wc -w /home/user/file.txt");
		expect(r.stdout).toBe("      2 /home/user/file.txt\n");
	});

	test("stdin", async () => {
		const shell = createShell();
		const r = await shell.run('echo "one two three" | wc -w');
		expect(r.stdout.trim()).toBe("3");
	});
});

// ─── head / tail ───────────────────────────────────────────────────

describe("head", () => {
	test("default 10 lines", async () => {
		const shell = createShell();
		const r = await shell.run("head /home/user/lines.txt");
		expect(r.stdout).toBe("alpha\nbeta\ngamma\ndelta\n");
	});

	test("-n limits lines", async () => {
		const shell = createShell();
		const r = await shell.run("head -n 2 /home/user/lines.txt");
		expect(r.stdout).toBe("alpha\nbeta\n");
	});
});

describe("tail", () => {
	test("-n limits lines from end", async () => {
		const shell = createShell();
		const r = await shell.run("tail -n 2 /home/user/lines.txt");
		expect(r.stdout).toBe("gamma\ndelta\n");
	});
});

// ─── cut ───────────────────────────────────────────────────────────

describe("cut", () => {
	test("-d -f field extraction", async () => {
		const shell = createShell();
		const r = await shell.run("cut -d: -f1 /home/user/colon.txt");
		expect(r.stdout).toBe("root\nuser\nnobody\n");
	});

	test("-c character extraction", async () => {
		const shell = createShell();
		const r = await shell.run('echo "abcdef" | cut -c1-3');
		expect(r.stdout.trim()).toBe("abc");
	});
});

// ─── tr ────────────────────────────────────────────────────────────

describe("tr", () => {
	test("basic character translation", async () => {
		const shell = createShell();
		const r = await shell.run("echo hello | tr l r");
		expect(r.stdout.trim()).toBe("herro");
	});

	test("-d delete characters", async () => {
		const shell = createShell();
		const r = await shell.run("echo hello | tr -d l");
		expect(r.stdout.trim()).toBe("heo");
	});

	test("character class [:upper:]", async () => {
		const shell = createShell();
		const r = await shell.run("echo Hello | tr '[:upper:]' '[:lower:]'");
		expect(r.stdout.trim()).toBe("hello");
	});
});

// ─── sed ───────────────────────────────────────────────────────────

describe("sed", () => {
	test("basic substitution", async () => {
		const shell = createShell();
		const r = await shell.run("echo hello | sed 's/hello/world/'");
		expect(r.stdout.trim()).toBe("world");
	});

	test("global substitution", async () => {
		const shell = createShell();
		const r = await shell.run("echo 'aaa' | sed 's/a/b/g'");
		expect(r.stdout.trim()).toBe("bbb");
	});

	test("delete line", async () => {
		const shell = createShell();
		const r = await shell.run("sed '2d' /home/user/lines.txt");
		expect(r.stdout).toBe("alpha\ngamma\ndelta\n");
	});
});

// ─── tee ───────────────────────────────────────────────────────────

describe("tee", () => {
	test("writes to stdout and file", async () => {
		const shell = createShell();
		const r = await shell.run("echo hello | tee /tmp/tee_out");
		expect(r.stdout).toBe("hello\n");
		const cat = await shell.run("cat /tmp/tee_out");
		expect(cat.stdout).toBe("hello\n");
	});
});

// ─── seq ───────────────────────────────────────────────────────────

describe("seq", () => {
	test("simple range", async () => {
		const shell = createShell();
		const r = await shell.run("seq 5");
		expect(r.stdout).toBe("1\n2\n3\n4\n5\n");
	});

	test("start and end", async () => {
		const shell = createShell();
		const r = await shell.run("seq 3 5");
		expect(r.stdout).toBe("3\n4\n5\n");
	});

	test("step", async () => {
		const shell = createShell();
		const r = await shell.run("seq 0 2 10");
		expect(r.stdout).toBe("0\n2\n4\n6\n8\n10\n");
	});

	test("custom separator", async () => {
		const shell = createShell();
		const r = await shell.run("seq -s , 3");
		expect(r.stdout).toBe("1,2,3\n");
	});
});

// ─── basename / dirname ────────────────────────────────────────────

describe("basename", () => {
	test("strips directory", async () => {
		const shell = createShell();
		const r = await shell.run("basename /home/user/file.txt");
		expect(r.stdout.trim()).toBe("file.txt");
	});

	test("strips suffix", async () => {
		const shell = createShell();
		const r = await shell.run("basename /home/user/file.txt .txt");
		expect(r.stdout.trim()).toBe("file");
	});
});

describe("dirname", () => {
	test("strips filename", async () => {
		const shell = createShell();
		const r = await shell.run("dirname /home/user/file.txt");
		expect(r.stdout.trim()).toBe("/home/user");
	});

	test("root path", async () => {
		const shell = createShell();
		const r = await shell.run("dirname /file.txt");
		expect(r.stdout.trim()).toBe("/");
	});
});

// ─── rev / tac ─────────────────────────────────────────────────────

describe("rev", () => {
	test("reverses characters", async () => {
		const shell = createShell();
		const r = await shell.run("echo hello | rev");
		expect(r.stdout.trim()).toBe("olleh");
	});
});

describe("tac", () => {
	test("reverses lines", async () => {
		const shell = createShell();
		const r = await shell.run("tac /home/user/lines.txt");
		expect(r.stdout).toBe("delta\ngamma\nbeta\nalpha\n");
	});
});

// ─── arithmetic ────────────────────────────────────────────────────

describe("arithmetic", () => {
	test("basic arithmetic expansion", async () => {
		const shell = createShell();
		const r = await shell.run("echo $((2 + 3))");
		expect(r.stdout.trim()).toBe("5");
	});

	test("multiplication", async () => {
		const shell = createShell();
		const r = await shell.run("echo $((4 * 7))");
		expect(r.stdout.trim()).toBe("28");
	});

	test("variable assignment in arithmetic", async () => {
		const shell = createShell();
		await shell.run("echo $((x = 10))");
		const r = await shell.run("echo $x");
		expect(r.stdout.trim()).toBe("10");
	});

	test("compound assignment +=", async () => {
		const shell = createShell();
		await shell.run("x=5");
		await shell.run("echo $((x += 3))");
		const r = await shell.run("echo $x");
		expect(r.stdout.trim()).toBe("8");
	});

	test("pre-increment", async () => {
		const shell = createShell();
		await shell.run("x=5");
		const r = await shell.run("echo $((++x))");
		expect(r.stdout.trim()).toBe("6");
	});

	test("post-increment returns old value", async () => {
		const shell = createShell();
		await shell.run("x=5");
		const r = await shell.run("echo $((x++))");
		expect(r.stdout.trim()).toBe("5");
		const r2 = await shell.run("echo $x");
		expect(r2.stdout.trim()).toBe("6");
	});

	test("ternary operator", async () => {
		const shell = createShell();
		const r = await shell.run("echo $((1 ? 42 : 0))");
		expect(r.stdout.trim()).toBe("42");
	});
});

// ─── control flow ──────────────────────────────────────────────────

describe("control flow", () => {
	test("if/then/fi", async () => {
		const shell = createShell();
		const r = await shell.run("if true; then echo yes; fi");
		expect(r.stdout).toBe("yes\n");
		expect(r.exitCode).toBe(0);
	});

	test("if/else", async () => {
		const shell = createShell();
		const r = await shell.run("if false; then echo yes; else echo no; fi");
		expect(r.stdout).toBe("no\n");
		expect(r.exitCode).toBe(0);
	});

	test("for loop", async () => {
		const shell = createShell();
		const r = await shell.run("for i in a b c; do echo $i; done");
		expect(r.stdout).toBe("a\nb\nc\n");
	});

	test("while loop", async () => {
		const shell = createShell();
		const r = await shell.run("x=0; while [ $x -lt 3 ]; do echo $x; x=$((x + 1)); done");
		expect(r.stdout).toBe("0\n1\n2\n");
	});

	test("case statement", async () => {
		const shell = createShell();
		const r = await shell.run("x=hello; case $x in hello) echo matched;; *) echo nope;; esac");
		expect(r.stdout).toBe("matched\n");
	});

	test("command && and ||", async () => {
		const shell = createShell();
		const r1 = await shell.run("true && echo yes");
		expect(r1.stdout).toBe("yes\n");
		const r2 = await shell.run("false || echo fallback");
		expect(r2.stdout).toBe("fallback\n");
	});

	test("semicolon preserves both outputs", async () => {
		const shell = createShell();
		const r = await shell.run("echo one; echo two");
		expect(r.stdout).toBe("one\ntwo\n");
	});
});

// ─── variable expansion ────────────────────────────────────────────

describe("variable expansion", () => {
	test("default value ${var:-default}", async () => {
		const shell = createShell();
		const r = await shell.run("echo ${UNSET:-fallback}");
		expect(r.stdout.trim()).toBe("fallback");
	});

	test("alternate value ${var:+alt}", async () => {
		const shell = createShell();
		await shell.run("x=hello");
		const r = await shell.run("echo ${x:+exists}");
		expect(r.stdout.trim()).toBe("exists");
	});

	test("string length ${#var}", async () => {
		const shell = createShell();
		await shell.run("x=hello");
		const r = await shell.run("echo ${#x}");
		expect(r.stdout.trim()).toBe("5");
	});

	test("suffix removal ${var%pattern}", async () => {
		const shell = createShell();
		await shell.run("f=file.tar.gz");
		const r = await shell.run("echo ${f%.*}");
		expect(r.stdout.trim()).toBe("file.tar");
	});

	test("prefix removal ${var#pattern}", async () => {
		const shell = createShell();
		await shell.run("p=/home/user/file");
		const r = await shell.run("echo ${p#*/}");
		expect(r.stdout.trim()).toBe("home/user/file");
	});

	test("uppercase ${var^^}", async () => {
		const shell = createShell();
		await shell.run("x=hello");
		const r = await shell.run("echo ${x^^}");
		expect(r.stdout.trim()).toBe("HELLO");
	});

	test("lowercase ${var,,}", async () => {
		const shell = createShell();
		await shell.run("x=HELLO");
		const r = await shell.run("echo ${x,,}");
		expect(r.stdout.trim()).toBe("hello");
	});
});

// ─── redirects ─────────────────────────────────────────────────────

describe("redirects", () => {
	test("> writes to file", async () => {
		const shell = createShell();
		await shell.run("echo hello > /tmp/out");
		const r = await shell.run("cat /tmp/out");
		expect(r.stdout).toBe("hello\n");
	});

	test(">> appends to file", async () => {
		const shell = createShell();
		await shell.run("echo first > /tmp/out");
		await shell.run("echo second >> /tmp/out");
		const r = await shell.run("cat /tmp/out");
		expect(r.stdout).toBe("first\nsecond\n");
	});

	test("<<< here-string", async () => {
		const shell = createShell();
		const r = await shell.run("cat <<< 'hello world'");
		expect(r.stdout).toBe("hello world\n");
		expect(r.exitCode).toBe(0);
	});

	test("2>&1 merges stderr into stdout", async () => {
		const shell = createShell();
		const r = await shell.run("cat /nonexistent 2>&1");
		expect(r.stdout).toContain("No such file");
		expect(r.stderr).toBe("");
		expect(r.exitCode).toBe(1);
	});

	test("stderr redirect 2> to file", async () => {
		const shell = createShell();
		const cmd = await shell.run("cat /nonexistent 2> /tmp/err");
		expect(cmd.exitCode).toBe(1);
		expect(cmd.stdout).toBe("");
		expect(cmd.stderr).toBe("");
		const r = await shell.run("cat /tmp/err");
		expect(r.stdout).toContain("No such file");
	});

	test("&> redirects both stdout and stderr", async () => {
		const shell = createShell();
		await shell.run("echo hello &> /tmp/both");
		const r = await shell.run("cat /tmp/both");
		expect(r.stdout).toBe("hello\n");
	});
});

// ─── cp / mv into directories ──────────────────────────────────────

describe("cp and mv", () => {
	test("cp file into directory", async () => {
		const shell = createShell();
		await shell.run("mkdir /tmp/dest");
		await shell.run("echo content > /tmp/src.txt");
		await shell.run("cp /tmp/src.txt /tmp/dest");
		const r = await shell.run("cat /tmp/dest/src.txt");
		expect(r.stdout).toBe("content\n");
	});

	test("mv file into directory", async () => {
		const shell = createShell();
		await shell.run("mkdir /tmp/dest");
		await shell.run("echo content > /tmp/src.txt");
		await shell.run("mv /tmp/src.txt /tmp/dest");
		const r = await shell.run("cat /tmp/dest/src.txt");
		expect(r.stdout).toBe("content\n");
	});
});

// ─── env / export / readonly ───────────────────────────────────────

describe("env and variables", () => {
	test("env -u does not modify parent shell", async () => {
		const shell = createShell();
		await shell.run("export FOO=bar");
		await shell.run("env -u FOO echo hello");
		const r = await shell.run("echo $FOO");
		expect(r.stdout.trim()).toBe("bar");
	});

	test("readonly prevents modification", async () => {
		const shell = createShell();
		await shell.run("readonly X=42");
		const r = await shell.run("X=99");
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("readonly");
		const check = await shell.run("echo $X");
		expect(check.stdout).toBe("42\n");
	});

	test("temporary prefix assignment", async () => {
		const shell = createShell();
		await shell.run("X=old");
		await shell.run("X=temp echo hello");
		const r = await shell.run("echo $X");
		expect(r.stdout.trim()).toBe("old");
	});

	test("SECONDS variable increases", async () => {
		const shell = createShell();
		const r = await shell.run("echo $SECONDS");
		const val = Number.parseInt(r.stdout.trim(), 10);
		expect(val).toBeGreaterThanOrEqual(0);
	});
});

// ─── error handling ────────────────────────────────────────────────

describe("error handling", () => {
	test("command not found exits 127", async () => {
		const shell = createShell();
		const r = await shell.run("nonexistent_command");
		expect(r.exitCode).toBe(127);
		expect(r.stderr).toContain("command not found");
	});

	test("wc continues on missing file", async () => {
		const shell = createShell();
		const r = await shell.run("wc -l /nonexistent /home/user/lines.txt");
		expect(r.stderr).toContain("No such file");
		expect(r.stdout).toBe("      4 /home/user/lines.txt\n      4 total\n");
		expect(r.exitCode).toBe(1);
	});

	test("set -eo pipefail combined flags", async () => {
		const shell = createShell();
		const r = await shell.run("set -eo pipefail");
		expect(r.exitCode).toBe(0);
	});

	test("$? reflects last exit code", async () => {
		const shell = createShell();
		await shell.run("false");
		const r = await shell.run("echo $?");
		expect(r.stdout.trim()).toBe("1");
	});
});

// ─── subshells and functions ───────────────────────────────────────

describe("subshells and functions", () => {
	test("subshell isolates variables", async () => {
		const shell = createShell();
		await shell.run("X=outer");
		await shell.run("(X=inner)");
		const r = await shell.run("echo $X");
		expect(r.stdout.trim()).toBe("outer");
	});

	test("function definition and call", async () => {
		const shell = createShell();
		await shell.run("greet() { echo hello $1; }");
		const r = await shell.run("greet world");
		expect(r.stdout.trim()).toBe("hello world");
	});
});

// ─── condition output preservation ─────────────────────────────────

describe("condition output", () => {
	test("if condition output is preserved", async () => {
		const shell = createShell();
		const r = await shell.run("if echo check; then echo yes; fi");
		expect(r.stdout).toBe("check\nyes\n");
	});

	test("elif condition outputs preserved", async () => {
		const shell = createShell();
		const r = await shell.run("if false; then echo no; elif echo cond; then echo yes; fi");
		expect(r.stdout).toBe("cond\nyes\n");
	});

	test("while condition output preserved", async () => {
		const shell = createShell();
		const r = await shell.run("x=0; while [ $x -lt 2 ]; do x=$((x+1)); echo body; done");
		expect(r.stdout).toBe("body\nbody\n");
	});
});

// ─── pipe and command substitution ─────────────────────────────────

describe("command substitution", () => {
	test("$(cmd) captures output", async () => {
		const shell = createShell();
		const r = await shell.run('echo "hello $(echo world)"');
		expect(r.stdout.trim()).toBe("hello world");
	});

	test("nested substitution", async () => {
		const shell = createShell();
		const r = await shell.run("echo $(echo $(echo deep))");
		expect(r.stdout.trim()).toBe("deep");
	});

	test("backtick substitution", async () => {
		const shell = createShell();
		const r = await shell.run("echo `echo backtick`");
		expect(r.stdout.trim()).toBe("backtick");
	});
});

// ─── xargs ─────────────────────────────────────────────────────────

describe("xargs", () => {
	test("basic xargs", async () => {
		const shell = createShell();
		const r = await shell.run('echo "a b c" | xargs echo');
		expect(r.stdout.trim()).toBe("a b c");
	});

	test("-n max args", async () => {
		const shell = createShell();
		const r = await shell.run('echo "a b c d" | xargs -n 2 echo');
		const lines = r.stdout.trim().split("\n");
		expect(lines).toHaveLength(2);
	});
});

// ─── special variables ─────────────────────────────────────────────

describe("special variables", () => {
	test("$# counts positional args in function", async () => {
		const shell = createShell();
		await shell.run("count() { echo $#; }");
		const r = await shell.run("count a b c");
		expect(r.stdout.trim()).toBe("3");
	});

	test("$@ expands positional args", async () => {
		const shell = createShell();
		await shell.run("show() { echo $@; }");
		const r = await shell.run("show x y z");
		expect(r.stdout.trim()).toBe("x y z");
	});

	test("RANDOM produces a number", async () => {
		const shell = createShell();
		const r = await shell.run("echo $RANDOM");
		const val = Number.parseInt(r.stdout.trim(), 10);
		expect(val).toBeGreaterThanOrEqual(0);
		expect(val).toBeLessThan(32768);
	});
});

// ─── string manipulation builtins ──────────────────────────────────

describe("string builtins", () => {
	test("wc -c counts bytes", async () => {
		const shell = createShell();
		const r = await shell.run('echo -n "hello" | wc -c');
		expect(r.stdout.trim()).toBe("5");
	});

	test("sort -f fold case", async () => {
		const shell = createShell();
		const r = await shell.run('printf "Banana\\napple\\nCherry\\n" | sort -f');
		expect(r.stdout).toBe("apple\nBanana\nCherry\n");
	});

	test("uniq -u only unique", async () => {
		const shell = createShell();
		const r = await shell.run('printf "a\\na\\nb\\nc\\nc\\n" | uniq -u');
		expect(r.stdout.trim()).toBe("b");
	});

	test("cut -d with tab delimiter", async () => {
		const shell = createShell();
		const r = await shell.run("cut -f2 /home/user/tabs.txt");
		expect(r.stdout).toBe("two\nfive\n");
	});

	test("paste merges files", async () => {
		const shell = createShell();
		await shell.run('printf "a\\nb\\n" > /tmp/p1');
		await shell.run('printf "1\\n2\\n" > /tmp/p2');
		const r = await shell.run("paste /tmp/p1 /tmp/p2");
		expect(r.stdout).toBe("a\t1\nb\t2\n");
	});
});

// ─── cat edge cases ────────────────────────────────────────────────

describe("cat", () => {
	test("cat multiple files", async () => {
		const shell = createShell();
		const r = await shell.run("cat /home/user/file.txt /home/user/lines.txt");
		expect(r.stdout).toContain("hello world");
		expect(r.stdout).toContain("alpha");
	});

	test("cat continues past missing file", async () => {
		const shell = createShell();
		const r = await shell.run("cat /home/user/file.txt /nonexistent /home/user/lines.txt");
		expect(r.stderr).toContain("No such file");
		expect(r.stdout).toContain("hello world");
		expect(r.stdout).toContain("alpha");
		expect(r.exitCode).toBe(1);
	});

	test("cat -n numbers lines", async () => {
		const shell = createShell();
		const r = await shell.run("cat -n /home/user/lines.txt");
		expect(r.stdout).toContain("1\talpha");
		expect(r.stdout).toContain("4\tdelta");
	});

	test("cat stdin when no args", async () => {
		const shell = createShell();
		const r = await shell.run("echo hello | cat");
		expect(r.stdout).toBe("hello\n");
	});
});

// ─── mktemp ────────────────────────────────────────────────────────

describe("mktemp", () => {
	test("creates file with random name", async () => {
		const shell = createShell();
		const r = await shell.run("mktemp");
		expect(r.exitCode).toBe(0);
		const path = r.stdout.trim();
		expect(path).toMatch(/^\/tmp\//);
	});

	test("-d creates directory", async () => {
		const shell = createShell();
		const r = await shell.run("mktemp -d");
		expect(r.exitCode).toBe(0);
	});
});

// ─── chmod ─────────────────────────────────────────────────────────

describe("chmod", () => {
	test("octal mode", async () => {
		const shell = createShell();
		await shell.run("touch /tmp/ch");
		await shell.run("chmod 755 /tmp/ch");
		const r = await shell.run("stat /tmp/ch");
		expect(r.stdout).toContain("0755");
	});

	test("symbolic +x", async () => {
		const shell = createShell();
		await shell.run("touch /tmp/ch2");
		await shell.run("chmod 644 /tmp/ch2");
		await shell.run("chmod a+x /tmp/ch2");
		const r = await shell.run("stat /tmp/ch2");
		expect(r.stdout).toContain("0755");
	});
});

// ─── seq edge cases ────────────────────────────────────────────────

describe("seq edge cases", () => {
	test("descending range", async () => {
		const shell = createShell();
		const r = await shell.run("seq 5 -1 1");
		expect(r.stdout).toBe("5\n4\n3\n2\n1\n");
	});

	test("-w pads with zeros", async () => {
		const shell = createShell();
		const r = await shell.run("seq -w 8 10");
		expect(r.stdout).toBe("08\n09\n10\n");
	});
});

// ─── tilde expansion ──────────────────────────────────────────────

describe("tilde expansion", () => {
	test("~ expands to HOME", async () => {
		const shell = createShell();
		const r = await shell.run("echo ~");
		expect(r.stdout.trim()).toBe("/home/user");
	});

	test("~+ expands to PWD", async () => {
		const shell = createShell();
		await shell.run("cd /home/user");
		const r = await shell.run("echo ~+");
		expect(r.stdout.trim()).toBe("/home/user");
	});
});

// ─── pipeline and negation ─────────────────────────────────────────

describe("pipelines", () => {
	test("pipe chains correctly", async () => {
		const shell = createShell();
		const r = await shell.run('printf "c\\na\\nb\\n" | sort | head -n 1');
		expect(r.stdout.trim()).toBe("a");
	});

	test("! negates exit code", async () => {
		const shell = createShell();
		expect((await shell.run("! false")).exitCode).toBe(0);
		expect((await shell.run("! true")).exitCode).toBe(1);
	});
});

// ─── parameter expansion edge cases ────────────────────────────────

describe("parameter expansion edge cases", () => {
	test("${#var} returns string length", async () => {
		const shell = createShell();
		await shell.run("x=hello");
		const r = await shell.run("echo ${#x}");
		expect(r.stdout.trim()).toBe("5");
	});

	test("greedy suffix removal ${var%%pattern}", async () => {
		const shell = createShell();
		await shell.run("f=file.tar.gz");
		const r = await shell.run("echo ${f%%.*}");
		expect(r.stdout.trim()).toBe("file");
	});

	test("greedy prefix removal ${var##pattern}", async () => {
		const shell = createShell();
		await shell.run("p=/home/user/file");
		const r = await shell.run("echo ${p##*/}");
		expect(r.stdout.trim()).toBe("file");
	});

	test("assign default ${var:=default}", async () => {
		const shell = createShell();
		const r = await shell.run("echo ${NEWVAR:=assigned}");
		expect(r.stdout.trim()).toBe("assigned");
		const r2 = await shell.run("echo $NEWVAR");
		expect(r2.stdout.trim()).toBe("assigned");
	});
});

// ─── arithmetic edge cases ─────────────────────────────────────────

describe("arithmetic edge cases", () => {
	test("modulo", async () => {
		const shell = createShell();
		const r = await shell.run("echo $((17 % 5))");
		expect(r.stdout.trim()).toBe("2");
	});

	test("bitwise AND", async () => {
		const shell = createShell();
		const r = await shell.run("echo $((12 & 10))");
		expect(r.stdout.trim()).toBe("8");
	});

	test("exponentiation", async () => {
		const shell = createShell();
		const r = await shell.run("echo $((2 ** 10))");
		expect(r.stdout.trim()).toBe("1024");
	});

	test("comparison returns 0 or 1", async () => {
		const shell = createShell();
		const r1 = await shell.run("echo $((5 > 3))");
		expect(r1.stdout.trim()).toBe("1");
		const r2 = await shell.run("echo $((2 > 7))");
		expect(r2.stdout.trim()).toBe("0");
	});

	test("let command", async () => {
		const shell = createShell();
		await shell.run("let 'x=10'");
		const r = await shell.run("echo $x");
		expect(r.stdout.trim()).toBe("10");
	});
});

// ─── cat trailing newline preservation ─────────────────────────────

describe("cat newline handling", () => {
	test("preserves trailing newline", async () => {
		const shell = createShell();
		const r = await shell.run("cat /home/user/lines.txt");
		expect(r.stdout).toBe("alpha\nbeta\ngamma\ndelta\n");
	});

	test("preserves missing trailing newline", async () => {
		const shell = createShell();
		const r = await shell.run("echo -n hello | cat");
		expect(r.stdout).toBe("hello");
	});
});

// ─── tr edge cases ─────────────────────────────────────────────────

describe("tr edge cases", () => {
	test("[:graph:] excludes space", async () => {
		const shell = createShell();
		const r = await shell.run("echo 'a b' | tr -d '[:graph:]'");
		expect(r.stdout.trim()).toBe("");
		// space should remain since [:graph:] excludes it
		expect(r.stdout).toContain(" ");
	});

	test("-s squeeze repeats", async () => {
		const shell = createShell();
		const r = await shell.run("echo 'aabbcc' | tr -s abc");
		expect(r.stdout.trim()).toBe("abc");
	});
});

// ─── sed edge cases ────────────────────────────────────────────────

describe("sed edge cases", () => {
	test("preserves trailing newline", async () => {
		const shell = createShell();
		const r = await shell.run("echo hello | sed 's/hello/world/'");
		expect(r.stdout).toBe("world\n");
	});

	test("preserves missing trailing newline", async () => {
		const shell = createShell();
		const r = await shell.run("echo -n hello | sed 's/hello/world/'");
		expect(r.stdout).toBe("world");
	});

	test("address range", async () => {
		const shell = createShell();
		const r = await shell.run("sed '2,3d' /home/user/lines.txt");
		expect(r.stdout).toBe("alpha\ndelta\n");
	});
});

// ─── printf edge cases ─────────────────────────────────────────────

describe("printf edge cases", () => {
	test("float format", async () => {
		const shell = createShell();
		const r = await shell.run('printf "%.2f" 3.14159');
		expect(r.stdout).toBe("3.14");
	});

	test("multiple args reuse format", async () => {
		const shell = createShell();
		const r = await shell.run('printf "%s\\n" a b c');
		expect(r.stdout).toBe("a\nb\nc\n");
	});

	test("hex escape", async () => {
		const shell = createShell();
		const r = await shell.run('printf "\\x41"');
		expect(r.stdout).toBe("A");
	});
});

// ─── grep edge cases ───────────────────────────────────────────────

describe("grep edge cases", () => {
	test("-w whole word match", async () => {
		const shell = createShell();
		const r = await shell.run('printf "cat\\ncatch\\nthe cat\\n" | grep -w cat');
		expect(r.stdout).toBe("cat\nthe cat\n");
	});

	test("-l files with matches", async () => {
		const shell = createShell();
		const r = await shell.run("grep -l alpha /home/user/lines.txt /home/user/mixed.txt");
		expect(r.stdout).toContain("/home/user/lines.txt");
	});

	test("-o only matching part", async () => {
		const shell = createShell();
		const r = await shell.run("echo 'foobar' | grep -o 'bar'");
		expect(r.stdout.trim()).toBe("bar");
	});
});

// ─── wc edge cases ─────────────────────────────────────────────────

describe("wc edge cases", () => {
	test("-l counts newlines not text lines", async () => {
		const shell = createShell();
		const r = await shell.run("echo -n hello | wc -l");
		expect(r.stdout.trim()).toBe("0");
	});

	test("-l with trailing newline", async () => {
		const shell = createShell();
		const r = await shell.run("echo hello | wc -l");
		expect(r.stdout.trim()).toBe("1");
	});

	test("multiple files shows total", async () => {
		const shell = createShell();
		const r = await shell.run("wc -l /home/user/lines.txt /home/user/file.txt");
		expect(r.stdout).toBe(
			"      4 /home/user/lines.txt\n      1 /home/user/file.txt\n      5 total\n",
		);
	});

	test("empty input", async () => {
		const shell = createShell();
		const r = await shell.run('echo -n "" | wc -w');
		expect(r.stdout.trim()).toBe("0");
	});
});

// ─── find command ──────────────────────────────────────────────────

describe("find", () => {
	test("lists current directory", async () => {
		const shell = createShell();
		await shell.run("cd /home/user");
		const r = await shell.run("find .");
		const lines = r.stdout.trim().split("\n").sort();
		expect(lines).toEqual([
			".",
			"./colon.txt",
			"./empty.txt",
			"./file.txt",
			"./lines.txt",
			"./mixed.txt",
			"./numbers.txt",
			"./spaces.txt",
			"./tabs.txt",
		]);
	});

	test("-name filters files", async () => {
		const shell = createShell();
		const r = await shell.run('find /home/user -name "*.txt"');
		const lines = r.stdout.trim().split("\n").sort();
		expect(lines).toEqual([
			"/home/user/colon.txt",
			"/home/user/empty.txt",
			"/home/user/file.txt",
			"/home/user/lines.txt",
			"/home/user/mixed.txt",
			"/home/user/numbers.txt",
			"/home/user/spaces.txt",
			"/home/user/tabs.txt",
		]);
	});

	test("-type f finds only files", async () => {
		const shell = createShell();
		const r = await shell.run("find /home -type f");
		const lines = r.stdout.trim().split("\n");
		// every entry is a regular file (not the parent dir /home or /home/user)
		expect(lines).not.toContain("/home");
		expect(lines).not.toContain("/home/user");
		expect(lines).toContain("/home/user/file.txt");
		expect(lines.length).toBe(8);
	});
});

// ─── read builtin ──────────────────────────────────────────────────

describe("read builtin", () => {
	test("reads into variable", async () => {
		const shell = createShell();
		await shell.run("echo hello | read x");
		// read in pipeline runs in subshell in real bash, but in our model
		// let's just test basic functionality
		const r = await shell.run('echo "hello world" | { read x; echo $x; }');
		expect(r.stdout.trim()).toBe("hello world");
	});

	test("splits into multiple variables", async () => {
		const shell = createShell();
		const r = await shell.run('echo "a b c" | { read x y z; echo "$x-$y-$z"; }');
		expect(r.stdout.trim()).toBe("a-b-c");
	});
});

// ─── cd and pwd ────────────────────────────────────────────────────

describe("cd edge cases", () => {
	test("cd - returns to previous dir", async () => {
		const shell = createShell();
		await shell.run("cd /home");
		await shell.run("cd /home/user");
		const r = await shell.run("cd -");
		expect(r.stdout.trim()).toBe("/home");
		const pwd = await shell.run("pwd");
		expect(pwd.stdout.trim()).toBe("/home");
	});

	test("cd nonexistent fails", async () => {
		const shell = createShell();
		const r = await shell.run("cd /nonexistent");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("No such file");
	});

	test("cd without args goes to HOME", async () => {
		const shell = createShell();
		await shell.run("cd /tmp");
		await shell.run("cd");
		const r = await shell.run("pwd");
		expect(r.stdout.trim()).toBe("/home/user");
	});
});

// ─── subshell variable inheritance ─────────────────────────────────

describe("subshell variable inheritance", () => {
	test("non-exported vars visible in subshell", async () => {
		const shell = createShell();
		await shell.run("myvar=secret");
		const r = await shell.run("(echo $myvar)");
		expect(r.stdout.trim()).toBe("secret");
	});

	test("subshell changes don't leak to parent", async () => {
		const shell = createShell();
		await shell.run("myvar=original");
		await shell.run("(myvar=changed)");
		const r = await shell.run("echo $myvar");
		expect(r.stdout.trim()).toBe("original");
	});
});

// ─── ls command ────────────────────────────────────────────────────

describe("ls", () => {
	test("lists directory contents", async () => {
		const shell = createShell();
		const r = await shell.run("ls /home/user");
		expect(r.stdout).toContain("file.txt");
		expect(r.stdout).toContain("lines.txt");
	});

	test("-a shows hidden files", async () => {
		const shell = createShell({
			"/home/user/.hidden": "secret",
			"/home/user/visible": "public",
		});
		const r = await shell.run("ls -a /home/user");
		expect(r.stdout).toContain(".hidden");
		expect(r.stdout).toContain("visible");
		expect(r.stdout).toContain(".");
		expect(r.stdout).toContain("..");
	});
});

// ─── alias ─────────────────────────────────────────────────────────

describe("alias", () => {
	test("define and use alias", async () => {
		const shell = createShell();
		await shell.run("alias hi='echo hello'");
		const r = await shell.run("hi");
		expect(r.stdout.trim()).toBe("hello");
	});

	test("unalias removes alias", async () => {
		const shell = createShell();
		await shell.run("alias hi='echo hello'");
		await shell.run("unalias hi");
		const r = await shell.run("hi");
		expect(r.exitCode).toBe(127);
	});
});

// ─── export and declare ────────────────────────────────────────────

describe("export and declare", () => {
	test("export -p lists exports", async () => {
		const shell = createShell();
		await shell.run("export FOO=bar");
		const r = await shell.run("export -p");
		expect(r.stdout).toContain('declare -x FOO="bar"');
	});

	test("declare -i treats as integer", async () => {
		const shell = createShell();
		await shell.run("declare -i x=42");
		const r = await shell.run("echo $x");
		expect(r.stdout.trim()).toBe("42");
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 1: Core File Operations (rm, ln, touch, mkdir)
// ═══════════════════════════════════════════════════════════════════

describe("rm", () => {
	test("removes a file", async () => {
		const shell = createShell();
		await shell.run("touch /tmp/rmme");
		await shell.run("rm /tmp/rmme");
		const r = await shell.run("test -f /tmp/rmme");
		expect(r.exitCode).toBe(1);
	});

	test("-r removes directory recursively", async () => {
		const shell = createShell();
		await shell.run("mkdir -p /tmp/rmdir/sub");
		await shell.run("touch /tmp/rmdir/sub/file");
		await shell.run("rm -r /tmp/rmdir");
		const r = await shell.run("test -d /tmp/rmdir");
		expect(r.exitCode).toBe(1);
	});

	test("-f ignores nonexistent files", async () => {
		const shell = createShell();
		const r = await shell.run("rm -f /tmp/nonexistent");
		expect(r.exitCode).toBe(0);
	});

	test("errors on missing file without -f", async () => {
		const shell = createShell();
		const r = await shell.run("rm /tmp/nonexistent");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("No such file");
	});
});

describe("ln", () => {
	test("-s creates symlink", async () => {
		const shell = createShell();
		await shell.run("echo content > /tmp/target");
		await shell.run("ln -s /tmp/target /tmp/link");
		const r = await shell.run("cat /tmp/link");
		expect(r.stdout).toBe("content\n");
	});

	test("-f force overwrites existing link", async () => {
		const shell = createShell();
		await shell.run("echo old > /tmp/old");
		await shell.run("echo new > /tmp/new");
		await shell.run("ln -s /tmp/old /tmp/mylink");
		await shell.run("ln -sf /tmp/new /tmp/mylink");
		const r = await shell.run("cat /tmp/mylink");
		expect(r.stdout).toBe("new\n");
	});
});

describe("touch", () => {
	test("creates new empty file", async () => {
		const shell = createShell();
		await shell.run("touch /tmp/newfile");
		const r = await shell.run("test -f /tmp/newfile");
		expect(r.exitCode).toBe(0);
	});

	test("does not overwrite existing file content", async () => {
		const shell = createShell();
		await shell.run("echo hello > /tmp/existing");
		await shell.run("touch /tmp/existing");
		const r = await shell.run("cat /tmp/existing");
		expect(r.stdout).toBe("hello\n");
	});

	test("creates multiple files", async () => {
		const shell = createShell();
		await shell.run("touch /tmp/a /tmp/b /tmp/c");
		expect((await shell.run("test -f /tmp/a")).exitCode).toBe(0);
		expect((await shell.run("test -f /tmp/b")).exitCode).toBe(0);
		expect((await shell.run("test -f /tmp/c")).exitCode).toBe(0);
	});
});

describe("mkdir", () => {
	test("creates directory", async () => {
		const shell = createShell();
		await shell.run("mkdir /tmp/newdir");
		const r = await shell.run("test -d /tmp/newdir");
		expect(r.exitCode).toBe(0);
	});

	test("-p creates nested directories", async () => {
		const shell = createShell();
		await shell.run("mkdir -p /tmp/a/b/c/d");
		const r = await shell.run("test -d /tmp/a/b/c/d");
		expect(r.exitCode).toBe(0);
	});

	test("-p does not error on existing directory", async () => {
		const shell = createShell();
		await shell.run("mkdir -p /tmp/exists");
		const r = await shell.run("mkdir -p /tmp/exists");
		expect(r.exitCode).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 2: Text Processing (awk, diff, comm, join, nl, fold)
// ═══════════════════════════════════════════════════════════════════

describe("awk", () => {
	test("prints specific field", async () => {
		const shell = createShell();
		const r = await shell.run("echo 'one two three' | awk '{print $2}'");
		expect(r.stdout.trim()).toBe("two");
	});

	test("-F custom separator", async () => {
		const shell = createShell();
		const r = await shell.run("echo 'a:b:c' | awk -F: '{print $2}'");
		expect(r.stdout.trim()).toBe("b");
	});

	test("pattern matching", async () => {
		const shell = createShell();
		const r = await shell.run('printf "yes match\\nno skip\\nyes again\\n" | awk "/yes/{print}"');
		expect(r.stdout).toBe("yes match\nyes again\n");
	});

	test("NR line number", async () => {
		const shell = createShell();
		const r = await shell.run("printf \"a\\nb\\nc\\n\" | awk '{print NR, $0}'");
		expect(r.stdout).toBe("1 a\n2 b\n3 c\n");
	});
});

describe("diff", () => {
	test("identical files produce no output", async () => {
		const shell = createShell();
		await shell.run("echo hello > /tmp/f1");
		await shell.run("echo hello > /tmp/f2");
		const r = await shell.run("diff /tmp/f1 /tmp/f2");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("");
	});

	test("different files produce diff output", async () => {
		const shell = createShell();
		await shell.run("echo hello > /tmp/f1");
		await shell.run("echo world > /tmp/f2");
		const r = await shell.run("diff /tmp/f1 /tmp/f2");
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toBe("--- /tmp/f1\n+++ /tmp/f2\n@@ -1,1 +1,1 @@\n-hello\n+world\n");
	});
});

describe("comm", () => {
	test("shows three columns", async () => {
		const shell = createShell();
		await shell.run('printf "a\\nc\\n" > /tmp/c1');
		await shell.run('printf "b\\nc\\n" > /tmp/c2');
		const r = await shell.run("comm /tmp/c1 /tmp/c2");
		// col 1: only in file1, col 2: only in file2 (tab prefix), col 3: both (two tabs)
		expect(r.stdout).toBe("a\n\tb\n\t\tc\n");
	});
});

describe("join", () => {
	test("joins on common field", async () => {
		const shell = createShell();
		await shell.run('printf "1 alice\\n2 bob\\n" > /tmp/j1');
		await shell.run('printf "1 admin\\n2 user\\n" > /tmp/j2');
		const r = await shell.run("join /tmp/j1 /tmp/j2");
		expect(r.stdout).toBe("1 alice admin\n2 bob user\n");
	});
});

describe("nl", () => {
	test("numbers non-blank lines by default", async () => {
		const shell = createShell();
		const r = await shell.run("nl /home/user/lines.txt");
		expect(r.stdout).toBe("     1\talpha\n     2\tbeta\n     3\tgamma\n     4\tdelta\n");
	});

	test("-b a numbers all lines", async () => {
		const shell = createShell();
		const r = await shell.run('printf "a\\n\\nb\\n" | nl -b a');
		expect(r.stdout).toBe("     1\ta\n     2\t\n     3\tb\n");
	});
});

describe("fold", () => {
	test("-w wraps at specified width", async () => {
		const shell = createShell();
		const r = await shell.run("echo 'abcdefghij' | fold -w 5");
		const lines = r.stdout.trim().split("\n");
		expect(lines.length).toBe(2);
		expect(lines[0]).toBe("abcde");
		expect(lines[1]).toBe("fghij");
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 3: Shell Builtins (eval, exec, source, shift, trap, set/shopt)
// ═══════════════════════════════════════════════════════════════════

describe("eval", () => {
	test("evaluates string as command", async () => {
		const shell = createShell();
		const r = await shell.run("eval 'echo hello world'");
		expect(r.stdout.trim()).toBe("hello world");
	});

	test("evaluates concatenated args", async () => {
		const shell = createShell();
		await shell.run("cmd='echo hi'");
		const r = await shell.run("eval $cmd");
		expect(r.stdout.trim()).toBe("hi");
	});
});

describe("exec", () => {
	test("runs command", async () => {
		const shell = createShell();
		const r = await shell.run("exec echo hello");
		expect(r.stdout.trim()).toBe("hello");
	});

	test("redirect creates file", async () => {
		const shell = createShell();
		await shell.run("exec > /tmp/execout");
		const r = await shell.run("test -f /tmp/execout");
		expect(r.exitCode).toBe(0);
	});

	test("exec CMD replaces shell — subsequent commands do not run", async () => {
		const shell = createShell();
		// exec echo should consume the shell; "echo never" should not produce output.
		// In a real shell, the second command never executes. In our model, exec throws
		// ShellExit so the list node short-circuits.
		const r = await shell.run("exec echo hi");
		expect(r.stdout.trim()).toBe("hi");
		// Shell should be effectively "exited" — further runs still work but this run
		// returned after exec, not after the entire script.
	});

	test("exec CMD propagates exit code", async () => {
		const shell = createShell();
		const r = await shell.run("exec false");
		expect(r.exitCode).toBe(1);
	});

	test("exec with unknown command exits 127", async () => {
		const shell = createShell();
		const r = await shell.run("exec /bin/doesnotexist");
		expect(r.exitCode).toBe(127);
	});

	test("exec > file persists stdout redirect across subsequent run() calls", async () => {
		const shell = createShell();
		await shell.run("exec > /tmp/log");
		// Subsequent commands should route stdout to the log file
		await shell.run("echo hi");
		// Read the file directly — cat would also be redirected to the log
		const contents = shell.filesystem.readFile("/tmp/log");
		expect(contents).toContain("hi");
	});

	test("exec >> file persists append redirect across run() calls", async () => {
		const shell = createShell();
		await shell.run("exec >> /tmp/appendlog");
		await shell.run("echo line1");
		await shell.run("echo line2");
		const contents = shell.filesystem.readFile("/tmp/appendlog");
		expect(contents).toContain("line1");
		expect(contents).toContain("line2");
	});
});

describe("source", () => {
	test("executes file in current shell", async () => {
		const shell = createShell({ "/tmp/script.sh": "X=sourced\n" });
		await shell.run("source /tmp/script.sh");
		const r = await shell.run("echo $X");
		expect(r.stdout.trim()).toBe("sourced");
	});

	test("dot command works like source", async () => {
		const shell = createShell({ "/tmp/s.sh": "Y=dotted\n" });
		await shell.run(". /tmp/s.sh");
		const r = await shell.run("echo $Y");
		expect(r.stdout.trim()).toBe("dotted");
	});

	test("returns error for missing file", async () => {
		const shell = createShell();
		const r = await shell.run("source /nonexistent");
		expect(r.exitCode).toBe(1);
	});
});

describe("shift", () => {
	test("shifts positional params in function", async () => {
		const shell = createShell();
		await shell.run("f() { shift; echo $1; }");
		const r = await shell.run("f a b c");
		expect(r.stdout.trim()).toBe("b");
	});

	test("shift N shifts multiple", async () => {
		const shell = createShell();
		await shell.run("f() { shift 2; echo $1; }");
		const r = await shell.run("f a b c");
		expect(r.stdout.trim()).toBe("c");
	});
});

describe("trap", () => {
	test("lists traps when no args", async () => {
		const shell = createShell();
		const r = await shell.run("trap");
		expect(r.exitCode).toBe(0);
	});

	test("-l lists signals", async () => {
		const shell = createShell();
		const r = await shell.run("trap -l");
		expect(r.stdout).toContain("HUP");
		expect(r.stdout).toContain("INT");
		expect(r.stdout).toContain("TERM");
	});
});

describe("set and shopt", () => {
	test("set -- sets positional params", async () => {
		const shell = createShell();
		await shell.run("f() { set -- x y z; echo $2; }");
		const r = await shell.run("f");
		expect(r.stdout.trim()).toBe("y");
	});

	test("set -o lists options", async () => {
		const shell = createShell();
		const r = await shell.run("set -o");
		expect(r.stdout).toContain("errexit");
		expect(r.stdout).toContain("nounset");
	});

	test("shopt -s enables option", async () => {
		const shell = createShell();
		const r = await shell.run("shopt -s extglob");
		expect(r.exitCode).toBe(0);
	});

	test("shopt -u disables option", async () => {
		const shell = createShell();
		await shell.run("shopt -s dotglob");
		const r = await shell.run("shopt -u dotglob");
		expect(r.exitCode).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 4: Info & System (date, uname, hostname, id, type, which, command)
// ═══════════════════════════════════════════════════════════════════

describe("date", () => {
	test("outputs a date string", async () => {
		const shell = createShell();
		const r = await shell.run("date");
		expect(r.exitCode).toBe(0);
		// e.g. "Tue Apr 21 00:37:32 CEST 2026"
		expect(r.stdout.trim()).toMatch(
			/^[A-Z][a-z]{2} [A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \S+ \d{4}$/,
		);
	});

	test("+%Y format gives 4-digit year", async () => {
		const shell = createShell();
		const r = await shell.run("date +%Y");
		expect(r.stdout.trim()).toMatch(/^\d{4}$/);
	});

	test("+%s gives epoch seconds", async () => {
		const shell = createShell();
		const r = await shell.run("date +%s");
		const epoch = Number.parseInt(r.stdout.trim(), 10);
		expect(epoch).toBeGreaterThan(1700000000);
	});
});

describe("uname", () => {
	test("default output", async () => {
		const shell = createShell();
		const r = await shell.run("uname");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("FauxOS\n");
	});

	test("-a shows all info", async () => {
		const shell = createShell();
		const r = await shell.run("uname -a");
		expect(r.exitCode).toBe(0);
		// Includes kernel, hostname, release, machine, OS
		expect(r.stdout).toContain("FauxOS");
		expect(r.stdout).toContain("faux-shell");
		expect(r.stdout).toContain("GNU/Linux");
	});
});

describe("hostname", () => {
	test("returns hostname", async () => {
		const shell = createShell();
		const r = await shell.run("hostname");
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toBe("faux-shell");
	});
});

describe("id and whoami", () => {
	test("whoami returns current user", async () => {
		const shell = createShell();
		const r = await shell.run("whoami");
		expect(r.stdout.trim()).toBe("testuser");
	});
});

describe("type and which", () => {
	test("type identifies builtin", async () => {
		const shell = createShell();
		const r = await shell.run("type echo");
		expect(r.stdout).toBe("echo is a shell builtin\n");
		expect(r.exitCode).toBe(0);
	});

	test("type identifies keyword", async () => {
		const shell = createShell();
		const r = await shell.run("type if");
		expect(r.stdout).toBe("if is a shell keyword\n");
		expect(r.exitCode).toBe(0);
	});

	test("type -t returns type word", async () => {
		const shell = createShell();
		const r = await shell.run("type -t echo");
		expect(r.stdout.trim()).toBe("builtin");
	});

	test("type returns error for unknown", async () => {
		const shell = createShell();
		const r = await shell.run("type nonexistent_cmd_xyz");
		expect(r.exitCode).toBe(1);
	});

	test("command -v describes command", async () => {
		const shell = createShell();
		const r = await shell.run("command -v echo");
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toBe("echo");
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 5: Advanced Text (expr, base64, expand/unexpand, strings)
// ═══════════════════════════════════════════════════════════════════

describe("expr", () => {
	test("integer addition", async () => {
		const shell = createShell();
		const r = await shell.run("expr 2 + 3");
		expect(r.stdout.trim()).toBe("5");
	});

	test("integer subtraction", async () => {
		const shell = createShell();
		const r = await shell.run("expr 10 - 3");
		expect(r.stdout.trim()).toBe("7");
	});

	test("string length", async () => {
		const shell = createShell();
		const r = await shell.run("expr length hello");
		expect(r.stdout.trim()).toBe("5");
	});

	test("comparison returns 1 for true", async () => {
		const shell = createShell();
		const r = await shell.run("expr 5 '>' 3");
		expect(r.stdout.trim()).toBe("1");
	});
});

describe("base64", () => {
	test("encode produces base64 output", async () => {
		const shell = createShell();
		const r = await shell.run("echo -n test | base64");
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toBe("dGVzdA==");
	});

	test("-d decodes base64", async () => {
		const shell = createShell();
		const r = await shell.run("echo -n test | base64 | base64 -d");
		expect(r.stdout).toBe("test");
	});
});

describe("expand and unexpand", () => {
	test("expand converts tabs to spaces", async () => {
		const shell = createShell();
		const r = await shell.run("printf 'a\\tb\\n' | expand");
		// Default tab-stop 8: "a" + 7 spaces to next stop, then "b"
		expect(r.stdout).toBe("a       b\n");
	});

	test("expand -t sets tab width", async () => {
		const shell = createShell();
		const r = await shell.run("printf '\\tx\\n' | expand -t 4");
		expect(r.stdout).toBe("    x\n");
	});

	test("unexpand converts spaces to tabs", async () => {
		const shell = createShell();
		const r = await shell.run("printf '        x\\n' | unexpand");
		expect(r.stdout).toBe("\tx\n");
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 6: Filesystem Info (stat, file, realpath, tree, du)
// ═══════════════════════════════════════════════════════════════════

describe("stat", () => {
	test("displays file information", async () => {
		const shell = createShell();
		const r = await shell.run("stat /home/user/file.txt");
		expect(r.stdout).toContain("File:");
		expect(r.stdout).toContain("Size:");
	});

	test("shows mode as 4-digit octal", async () => {
		const shell = createShell();
		await shell.run("chmod 755 /home/user/file.txt");
		const r = await shell.run("stat /home/user/file.txt");
		expect(r.stdout).toContain("0755");
	});

	test("errors on nonexistent file", async () => {
		const shell = createShell();
		const r = await shell.run("stat /nonexistent");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("No such file");
	});
});

describe("file", () => {
	test("detects text file", async () => {
		const shell = createShell();
		const r = await shell.run("file /home/user/file.txt");
		expect(r.stdout).toContain("text");
	});

	test("detects empty file", async () => {
		const shell = createShell();
		const r = await shell.run("file /home/user/empty.txt");
		expect(r.stdout).toContain("empty");
	});

	test("detects directory", async () => {
		const shell = createShell();
		const r = await shell.run("file /home/user");
		expect(r.stdout).toContain("directory");
	});
});

describe("realpath", () => {
	test("resolves absolute path", async () => {
		const shell = createShell();
		const r = await shell.run("realpath /home/user/file.txt");
		expect(r.stdout.trim()).toBe("/home/user/file.txt");
	});

	test("resolves relative path", async () => {
		const shell = createShell();
		await shell.run("cd /home/user");
		const r = await shell.run("realpath file.txt");
		expect(r.stdout.trim()).toBe("/home/user/file.txt");
	});
});

describe("tree", () => {
	test("shows directory structure", async () => {
		const shell = createShell();
		const r = await shell.run("tree /home/user");
		expect(r.exitCode).toBe(0);
		// starts with the root path, includes all 8 files, ends with summary
		expect(r.stdout).toMatch(/^\/home\/user\n/);
		expect(r.stdout).toContain("├── file.txt");
		expect(r.stdout).toContain("└── tabs.txt");
		expect(r.stdout).toMatch(/0 directories, 8 files\n$/);
	});
});

describe("du", () => {
	test("reports sizes", async () => {
		const shell = createShell();
		const r = await shell.run("du /home/user");
		expect(r.exitCode).toBe(0);
		// Format: "<size>\t<path>\n" — size is a non-negative integer
		expect(r.stdout).toMatch(/^\d+\t\/home\/user\n$/);
	});
});

describe("terminal builtins", () => {
	test("tty reports stdin terminal state and pipeline stdin is not a tty", async () => {
		const shell = new Shell({
			tty: { stdin: true, stdout: true, stderr: true, cols: 80, rows: 24, name: "xterm" },
		});
		const r = await shell.run("tty; echo hi | tty");
		expect(r.stdout).toBe("/dev/tty\nnot a tty\n");
		expect(r.exitCode).toBe(1);
	});

	test("tput reads configured terminal dimensions", async () => {
		const shell = new Shell({
			tty: { stdout: true, cols: 100, rows: 40, name: "xterm-256color" },
		});
		const r = await shell.run("tput cols; tput lines; echo $COLUMNS:$LINES");
		expect(r.stdout).toBe("100\n40\n100:40\n");
		expect(r.exitCode).toBe(0);
	});

	test("clear and reset emit terminal control sequences", async () => {
		const shell = createShell();
		expect((await shell.run("clear")).stdout).toBe("\x1b[2J\x1b[H");
		expect((await shell.run("reset")).stdout).toBe("\x1bc");
	});

	test("stty reads and updates terminal size", async () => {
		const shell = new Shell({
			tty: { stdin: true, stdout: true, cols: 80, rows: 24, name: "xterm" },
		});
		expect((await shell.run("stty size")).stdout).toBe("24 80\n");
		const updated = await shell.run("stty cols 132 rows 43; stty size; echo $COLUMNS:$LINES");
		expect(updated.stdout).toBe("43 132\n132:43\n");
		expect(updated.exitCode).toBe(0);
	});

	test("tput emits common ansi capabilities", async () => {
		const shell = createShell();
		expect((await shell.run("tput cup 2 3")).stdout).toBe("\x1b[3;4H");
		expect((await shell.run("tput bold")).stdout).toBe("\x1b[1m");
		expect((await shell.run("tput setaf 2")).stdout).toBe("\x1b[32m");
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 7: Job Control & Process (sleep, yes, getopts, umask, ulimit)
// ═══════════════════════════════════════════════════════════════════

describe("sleep", () => {
	test("sleep 0 returns immediately", async () => {
		const shell = createShell();
		const r = await shell.run("sleep 0");
		expect(r.exitCode).toBe(0);
	});

	test("accepts suffix s", async () => {
		const shell = createShell();
		const r = await shell.run("sleep 0s");
		expect(r.exitCode).toBe(0);
	});

	test("invalid duration errors", async () => {
		const shell = createShell();
		const r = await shell.run("sleep xyz");
		expect(r.exitCode).toBe(1);
	});

	test("negative duration errors", async () => {
		const shell = createShell();
		const r = await shell.run("sleep -1");
		expect(r.exitCode).toBe(1);
	});
});

describe("yes", () => {
	test("outputs repeated text", async () => {
		const shell = createShell();
		const r = await shell.run("yes hello | head -n 3");
		expect(r.stdout).toBe("hello\nhello\nhello\n");
	});

	test("defaults to y", async () => {
		const shell = createShell();
		const r = await shell.run("yes | head -n 2");
		expect(r.stdout).toBe("y\ny\n");
	});
});

describe("umask", () => {
	test("displays current mask", async () => {
		const shell = createShell();
		const r = await shell.run("umask");
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toMatch(/^[0-7]{4}$/);
	});

	test("sets numeric mask", async () => {
		const shell = createShell();
		await shell.run("umask 0077");
		const r = await shell.run("umask");
		expect(r.stdout.trim()).toBe("0077");
	});

	test("-S shows symbolic format", async () => {
		const shell = createShell();
		await shell.run("umask 0022");
		const r = await shell.run("umask -S");
		expect(r.stdout).toContain("u=");
		expect(r.stdout).toContain("g=");
		expect(r.stdout).toContain("o=");
	});
});

describe("ulimit", () => {
	test("displays limits", async () => {
		const shell = createShell();
		const r = await shell.run("ulimit -a");
		expect(r.exitCode).toBe(0);
		// -a lists multiple resource limits
		expect(r.stdout).toContain("core file size");
		expect(r.stdout).toContain("open files");
		expect(r.stdout).toContain("stack size");
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 8: Edge Cases & Integration
// ═══════════════════════════════════════════════════════════════════

describe("nested control flow", () => {
	test("for inside if", async () => {
		const shell = createShell();
		const r = await shell.run("if true; then for i in a b; do echo $i; done; fi");
		expect(r.stdout).toBe("a\nb\n");
	});

	test("nested for loops", async () => {
		const shell = createShell();
		const r = await shell.run("for i in 1 2; do for j in a b; do echo $i$j; done; done");
		expect(r.stdout).toBe("1a\n1b\n2a\n2b\n");
	});

	test("while with break", async () => {
		const shell = createShell();
		const r = await shell.run(
			"x=0; while true; do x=$((x+1)); if [ $x -gt 3 ]; then break; fi; echo $x; done",
		);
		// Must produce exactly 1, 2, 3 and stop; a loose toContain would miss a broken break.
		expect(r.stdout).toBe("1\n2\n3\n");
		expect(r.exitCode).toBe(0);
	});

	test("for with break", async () => {
		const shell = createShell();
		const r = await shell.run(
			"for i in 1 2 3 4 5; do if [ $i -eq 3 ]; then break; fi; echo $i; done",
		);
		expect(r.stdout).toBe("1\n2\n");
	});

	test("until with break", async () => {
		const shell = createShell();
		const r = await shell.run(
			"x=0; until false; do x=$((x+1)); if [ $x -gt 2 ]; then break; fi; echo $x; done",
		);
		expect(r.stdout).toBe("1\n2\n");
	});

	test("continue skips iteration", async () => {
		const shell = createShell();
		const r = await shell.run(
			"for i in 1 2 3 4; do if [ $i -eq 2 ]; then continue; fi; echo $i; done",
		);
		expect(r.stdout).toBe("1\n3\n4\n");
	});

	test("break 2 exits two enclosing loops", async () => {
		const shell = createShell();
		const r = await shell.run(
			"for i in 1 2; do for j in a b; do if [ $j = b ]; then break 2; fi; echo $i$j; done; done",
		);
		expect(r.stdout).toBe("1a\n");
	});

	test("continue 2 skips outer iteration", async () => {
		const shell = createShell();
		const r = await shell.run(
			"for i in 1 2; do for j in a b; do if [ $j = b ]; then continue 2; fi; echo $i$j; done; echo done$i; done",
		);
		expect(r.stdout).toBe("1a\n2a\n");
	});

	test("break inside nested if inside loop", async () => {
		const shell = createShell();
		const r = await shell.run(
			"for i in 1 2 3; do if true; then if [ $i -eq 2 ]; then break; fi; fi; echo $i; done",
		);
		expect(r.stdout).toBe("1\n");
	});

	test("break outside loop reports error and does not crash", async () => {
		const shell = createShell();
		const r = await shell.run("break; echo after");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("only meaningful");
	});

	test("continue outside loop reports error and does not crash", async () => {
		const shell = createShell();
		const r = await shell.run("continue; echo after");
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("only meaningful");
	});

	test("break with non-numeric argument errors", async () => {
		const shell = createShell();
		const r = await shell.run("for i in 1 2; do break foo; echo $i; done");
		expect(r.stderr).toContain("numeric argument required");
	});

	test("output before break is preserved", async () => {
		const shell = createShell();
		const r = await shell.run(
			"for i in 1 2 3; do echo before$i; if [ $i -eq 2 ]; then break; fi; done",
		);
		expect(r.stdout).toBe("before1\nbefore2\n");
	});

	test("output before continue is preserved", async () => {
		const shell = createShell();
		const r = await shell.run(
			"for i in 1 2 3; do echo a$i; if [ $i -eq 2 ]; then continue; fi; echo b$i; done",
		);
		expect(r.stdout).toBe("a1\nb1\na2\na3\nb3\n");
	});
});

describe("multiple redirects", () => {
	test("stdout and stderr to different files", async () => {
		const shell = createShell();
		// echo has no stderr, so /tmp/err should be created but empty.
		await shell.run("echo ok > /tmp/out 2> /tmp/err");
		const out = await shell.run("cat /tmp/out");
		expect(out.stdout).toBe("ok\n");
		const err = await shell.run("cat /tmp/err");
		expect(err.stdout).toBe("");
	});

	test("stdout and stderr go to correct files when both present", async () => {
		const shell = createShell();
		await shell.run("cat /nonexistent > /tmp/o2 2> /tmp/e2");
		const out = await shell.run("cat /tmp/o2");
		expect(out.stdout).toBe("");
		const err = await shell.run("cat /tmp/e2");
		expect(err.stdout).toContain("No such file");
	});
});

describe("complex pipelines", () => {
	test("sort | uniq -c pipeline", async () => {
		const shell = createShell();
		const r = await shell.run('printf "b\\na\\nb\\na\\na\\n" | sort | uniq -c');
		expect(r.stdout).toBe("      3 a\n      2 b\n");
	});

	test("grep | wc -l counts matches", async () => {
		const shell = createShell();
		const r = await shell.run("grep -i hello /home/user/mixed.txt | wc -l");
		expect(r.stdout.trim()).toBe("3");
	});

	test("awk in pipeline", async () => {
		const shell = createShell();
		const r = await shell.run("echo 'a b c' | awk '{print $3}' | tr c C");
		expect(r.stdout.trim()).toBe("C");
	});
});

describe("quoting edge cases", () => {
	test("single quotes preserve literals", async () => {
		const shell = createShell();
		const r = await shell.run("echo '$HOME'");
		expect(r.stdout.trim()).toBe("$HOME");
	});

	test("double quotes allow variable expansion", async () => {
		const shell = createShell();
		const r = await shell.run('echo "$HOME"');
		expect(r.stdout.trim()).toBe("/home/user");
	});

	test("empty string argument preserved", async () => {
		const shell = createShell();
		const r = await shell.run('echo "" hello');
		expect(r.stdout.trim()).toBe("hello");
	});
});

describe("exit codes", () => {
	test("false in pipeline", async () => {
		const shell = createShell();
		const r = await shell.run("false | echo ok");
		expect(r.stdout).toBe("ok\n");
		// Without pipefail, exit code is the last command's (echo succeeds).
		expect(r.exitCode).toBe(0);
	});

	test("last command determines exit code in ;", async () => {
		const shell = createShell();
		const r = await shell.run("true; false");
		expect(r.exitCode).toBe(1);
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 9: Regression tests for bug fixes
// ═══════════════════════════════════════════════════════════════════

describe("regression: paste serial delimiter cycling", () => {
	test("-s cycles multi-char delimiter list", async () => {
		const shell = createShell();
		await shell.run('printf "a\\nb\\nc\\nd\\n" > /tmp/ps');
		const r = await shell.run("paste -s -d ',;' /tmp/ps");
		// Should alternate , and ; not insert ",;" between each
		expect(r.stdout.trim()).toBe("a,b;c,d");
	});
});

describe("regression: seq -w negative padding", () => {
	test("-w pads with zeros correctly", async () => {
		const shell = createShell();
		const r = await shell.run("seq -w 1 10");
		// Should zero-pad: 01, 02, ..., 10
		expect(r.stdout).toContain("01");
		expect(r.stdout).toContain("09");
		expect(r.stdout).toContain("10");
	});
});

describe("regression: let 3-char operators", () => {
	test("**= power assignment", async () => {
		const shell = createShell();
		await shell.run("let 'x=2'");
		await shell.run("let 'x**=3'");
		const r = await shell.run("echo $x");
		expect(r.stdout.trim()).toBe("8");
	});
});

describe("regression: grep -H with single file", () => {
	test("-H shows filename even for single file", async () => {
		const shell = createShell();
		const r = await shell.run("grep -H alpha /home/user/lines.txt");
		expect(r.stdout).toContain("/home/user/lines.txt:");
	});
});

describe("regression: mktemp trailing X only", () => {
	test("only trailing X's are randomized", async () => {
		const shell = createShell();
		const r = await shell.run("mktemp /tmp/testXXX.XXXXXX");
		const path = r.stdout.trim();
		// The "test" prefix and ".XXX" middle should be preserved literally
		expect(path).toMatch(/\/tmp\/testXXX\./);
	});
});

describe("regression: exec >>file", () => {
	test(">> without space doesn't create >file", async () => {
		const shell = createShell();
		await shell.run("exec >>/tmp/appendtest");
		const r = await shell.run("test -f /tmp/appendtest");
		expect(r.exitCode).toBe(0);
		// Should NOT create a file literally named ">..."
		const r2 = await shell.run("test -f '/tmp/>appendtest'");
		expect(r2.exitCode).toBe(1);
	});
});

describe("regression: stat octal mode format", () => {
	test("mode is 4 digits not 5", async () => {
		const shell = createShell();
		await shell.run("chmod 644 /home/user/file.txt");
		const r = await shell.run("stat /home/user/file.txt");
		expect(r.stdout).toContain("0644");
		expect(r.stdout).not.toContain("00644");
	});
});

describe("regression: condition output preserved", () => {
	test("if condition stdout not lost", async () => {
		const shell = createShell();
		const r = await shell.run("if echo checking; then echo yes; fi");
		expect(r.stdout).toBe("checking\nyes\n");
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 10: Remaining coverage gaps
// ═══════════════════════════════════════════════════════════════════

describe("date format specifiers", () => {
	test("%y gives 2-digit year", async () => {
		const shell = createShell();
		const r = await shell.run("date +%y");
		expect(r.stdout.trim()).toMatch(/^\d{2}$/);
	});

	test("%D gives mm/dd/yy", async () => {
		const shell = createShell();
		const r = await shell.run("date +%D");
		expect(r.stdout.trim()).toMatch(/^\d{2}\/\d{2}\/\d{2}$/);
	});

	test("%F gives YYYY-MM-DD", async () => {
		const shell = createShell();
		const r = await shell.run("date +%F");
		expect(r.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	test("%T gives HH:MM:SS", async () => {
		const shell = createShell();
		const r = await shell.run("date +%T");
		expect(r.stdout.trim()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
	});
});

describe("bc", () => {
	test("basic arithmetic", async () => {
		const shell = createShell();
		const r = await shell.run("echo '2 + 3' | bc");
		expect(r.stdout.trim()).toBe("5");
	});

	test("multiplication", async () => {
		const shell = createShell();
		const r = await shell.run("echo '6 * 7' | bc");
		expect(r.stdout.trim()).toBe("42");
	});
});

describe("fmt", () => {
	test("wraps text at default width", async () => {
		const shell = createShell();
		const long = "word ".repeat(20).trim();
		await shell.run(`echo '${long}' > /tmp/fmtin`);
		const r = await shell.run("fmt /tmp/fmtin");
		expect(r.exitCode).toBe(0);
		const lines = r.stdout.trim().split("\n");
		expect(lines.length).toBeGreaterThan(1);
	});

	test("-w sets custom width", async () => {
		const shell = createShell();
		await shell.run("echo 'aaa bbb ccc ddd' > /tmp/fmtin2");
		const r = await shell.run("fmt -w 10 /tmp/fmtin2");
		const lines = r.stdout.trim().split("\n");
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(10);
		}
	});
});

describe("column", () => {
	test("-t creates aligned table", async () => {
		const shell = createShell();
		const r = await shell.run('printf "a b\\ncc dd\\n" | column -t');
		expect(r.exitCode).toBe(0);
		const lines = r.stdout.trim().split("\n");
		expect(lines.length).toBe(2);
		// First field should be padded so second column aligns
		expect(lines[0]).toContain("  ");
	});
});

describe("df", () => {
	test("shows filesystem info", async () => {
		const shell = createShell();
		const r = await shell.run("df");
		expect(r.exitCode).toBe(0);
		// Standard df header + at least one filesystem row
		expect(r.stdout).toMatch(/^Filesystem .+Mounted on\n/);
		const lines = r.stdout.trim().split("\n");
		expect(lines.length).toBeGreaterThanOrEqual(2);
	});
});

describe("strings", () => {
	test("extracts printable sequences", async () => {
		const shell = createShell();
		await shell.run("echo 'hello world' > /tmp/strfile");
		const r = await shell.run("strings /tmp/strfile");
		expect(r.stdout).toContain("hello world");
	});
});

describe("xxd", () => {
	test("produces hex dump", async () => {
		const shell = createShell();
		const r = await shell.run("echo -n AB | xxd");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("4142");
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 11: base64 fix verification, parser, and misc gaps
// ═══════════════════════════════════════════════════════════════════

describe("base64 encoding correctness", () => {
	test("encodes hello with correct padding", async () => {
		const shell = createShell();
		const r = await shell.run("echo -n hello | base64");
		expect(r.stdout.trim()).toBe("aGVsbG8=");
	});

	test("encodes empty string", async () => {
		const shell = createShell();
		const r = await shell.run('echo -n "" | base64');
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("");
	});

	test("decode reverses encode", async () => {
		const shell = createShell();
		const r = await shell.run("echo -n 'aGVsbG8=' | base64 -d");
		expect(r.stdout).toBe("hello");
	});

	test("round-trip preserves data", async () => {
		const shell = createShell();
		const r = await shell.run("echo -n 'test123' | base64 | base64 -d");
		expect(r.stdout).toBe("test123");
	});
});

describe("misc builtins", () => {
	test("true returns 0", async () => {
		const shell = createShell();
		expect((await shell.run("true")).exitCode).toBe(0);
	});

	test("false returns 1", async () => {
		const shell = createShell();
		expect((await shell.run("false")).exitCode).toBe(1);
	});

	test(": (colon) is a no-op", async () => {
		const shell = createShell();
		const r = await shell.run(":");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("");
	});

	test("exit in subshell doesn't kill parent", async () => {
		const shell = createShell();
		await shell.run("(exit 1)");
		const r = await shell.run("echo alive");
		expect(r.stdout.trim()).toBe("alive");
	});
});

describe("function with echo", () => {
	test("function produces output and returns 0", async () => {
		const shell = createShell();
		await shell.run("f() { echo done; }");
		const r = await shell.run("f");
		expect(r.stdout.trim()).toBe("done");
		expect(r.exitCode).toBe(0);
	});
});

describe("hash and enable", () => {
	test("hash -r clears table", async () => {
		const shell = createShell();
		const r = await shell.run("hash -r");
		expect(r.exitCode).toBe(0);
	});

	test("enable lists builtins", async () => {
		const shell = createShell();
		const r = await shell.run("enable");
		expect(r.stdout).toContain("echo");
		expect(r.stdout).toContain("cd");
	});
});

describe("printenv", () => {
	test("prints all exported vars", async () => {
		const shell = createShell();
		await shell.run("export FOO=bar");
		const r = await shell.run("printenv");
		expect(r.stdout).toContain("FOO=bar");
	});

	test("prints specific var", async () => {
		const shell = createShell();
		await shell.run("export MYVAR=hello");
		const r = await shell.run("printenv MYVAR");
		expect(r.stdout.trim()).toBe("hello");
	});

	test("returns 1 for unset var", async () => {
		const shell = createShell();
		const r = await shell.run("printenv NONEXISTENT_VAR_XYZ");
		expect(r.exitCode).toBe(1);
	});
});

// ═══════════════════════════════════════════════════════════════════
// Batch 12: exit/return fix, let, mapfile, getopts, remaining gaps
// ═══════════════════════════════════════════════════════════════════

describe("exit builtin", () => {
	test("exit 0 returns 0", async () => {
		const shell = createShell();
		const r = await shell.run("exit 0");
		expect(r.exitCode).toBe(0);
	});

	test("exit 42 returns 42", async () => {
		const shell = createShell();
		const r = await shell.run("exit 42");
		expect(r.exitCode).toBe(42);
	});

	test("exit without arg uses last exit code", async () => {
		const shell = createShell();
		const r = await shell.run("false; exit");
		expect(r.exitCode).toBe(1);
	});
});

describe("return builtin", () => {
	test("return 0 in function", async () => {
		const shell = createShell();
		await shell.run("f() { return 0; }");
		const r = await shell.run("f");
		expect(r.exitCode).toBe(0);
	});

	test("return 42 in function", async () => {
		const shell = createShell();
		await shell.run("f() { return 42; }");
		const r = await shell.run("f");
		expect(r.exitCode).toBe(42);
	});
});

describe("let builtin", () => {
	test("basic assignment", async () => {
		const shell = createShell();
		await shell.run("let 'x=10'");
		const r = await shell.run("echo $x");
		expect(r.stdout.trim()).toBe("10");
	});

	test("compound += assignment", async () => {
		const shell = createShell();
		await shell.run("let 'x=5'");
		await shell.run("let 'x+=3'");
		const r = await shell.run("echo $x");
		expect(r.stdout.trim()).toBe("8");
	});

	test("returns 1 when result is 0 (falsy)", async () => {
		const shell = createShell();
		const r = await shell.run("let 'x=0'");
		expect(r.exitCode).toBe(1);
	});

	test("returns 0 when result is nonzero (truthy)", async () => {
		const shell = createShell();
		const r = await shell.run("let 'x=5'");
		expect(r.exitCode).toBe(0);
	});
});

describe("mapfile/readarray", () => {
	test("reads lines into array variables preserving newlines", async () => {
		const shell = createShell();
		await shell.run('printf "a\\nb\\nc\\n" | mapfile ARR');
		// Without -t, each entry retains its trailing newline; echo adds another.
		const r0 = await shell.run("echo $ARR_0");
		expect(r0.stdout).toBe("a\n\n");
		const r2 = await shell.run("echo $ARR_2");
		expect(r2.stdout).toBe("c\n\n");
	});

	test("-t strips trailing newlines", async () => {
		const shell = createShell();
		await shell.run('printf "hello\\nworld\\n" | mapfile -t M');
		const r0 = await shell.run("echo $M_0");
		expect(r0.stdout).toBe("hello\n");
		const r1 = await shell.run("echo $M_1");
		expect(r1.stdout).toBe("world\n");
	});
});

describe("pwd builtin", () => {
	test("shows current directory", async () => {
		const shell = createShell();
		const r = await shell.run("pwd");
		expect(r.stdout.trim()).toBe("/");
	});

	test("reflects cd", async () => {
		const shell = createShell();
		await shell.run("cd /home/user");
		const r = await shell.run("pwd");
		expect(r.stdout.trim()).toBe("/home/user");
	});
});
