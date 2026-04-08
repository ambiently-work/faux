import { describe, expect, test } from "bun:test";
import { Shell } from "../shell.js";

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
		expect(r.stdout).toContain("Hello");
		expect(r.stdout).toContain("hello");
		expect(r.stdout).toContain("HELLO");
	});

	test("-v invert match", async () => {
		const shell = createShell();
		const r = await shell.run("grep -v alpha /home/user/lines.txt");
		expect(r.stdout).not.toContain("alpha");
		expect(r.stdout).toContain("beta");
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
		expect(r.stdout).toContain("2 a");
		expect(r.stdout).toContain("1 b");
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
		expect(r.stdout).toContain("4");
	});

	test("-w counts words", async () => {
		const shell = createShell();
		const r = await shell.run("wc -w /home/user/file.txt");
		expect(r.stdout).toContain("2");
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
		expect(r.stdout).toContain("yes");
	});

	test("if/else", async () => {
		const shell = createShell();
		const r = await shell.run("if false; then echo yes; else echo no; fi");
		expect(r.stdout).toContain("no");
	});

	test("for loop", async () => {
		const shell = createShell();
		const r = await shell.run("for i in a b c; do echo $i; done");
		expect(r.stdout).toBe("a\nb\nc\n");
	});

	test("while loop", async () => {
		const shell = createShell();
		const r = await shell.run(
			'x=0; while [ $x -lt 3 ]; do echo $x; x=$((x + 1)); done',
		);
		expect(r.stdout).toBe("0\n1\n2\n");
	});

	test("case statement", async () => {
		const shell = createShell();
		const r = await shell.run('x=hello; case $x in hello) echo matched;; *) echo nope;; esac');
		expect(r.stdout).toContain("matched");
	});

	test("command && and ||", async () => {
		const shell = createShell();
		const r1 = await shell.run("true && echo yes");
		expect(r1.stdout).toContain("yes");
		const r2 = await shell.run("false || echo fallback");
		expect(r2.stdout).toContain("fallback");
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
		const r = await shell.run('echo ${UNSET:-fallback}');
		expect(r.stdout.trim()).toBe("fallback");
	});

	test("alternate value ${var:+alt}", async () => {
		const shell = createShell();
		await shell.run("x=hello");
		const r = await shell.run('echo ${x:+exists}');
		expect(r.stdout.trim()).toBe("exists");
	});

	test("string length ${#var}", async () => {
		const shell = createShell();
		await shell.run("x=hello");
		const r = await shell.run('echo ${#x}');
		expect(r.stdout.trim()).toBe("5");
	});

	test("suffix removal ${var%pattern}", async () => {
		const shell = createShell();
		await shell.run("f=file.tar.gz");
		const r = await shell.run('echo ${f%.*}');
		expect(r.stdout.trim()).toBe("file.tar");
	});

	test("prefix removal ${var#pattern}", async () => {
		const shell = createShell();
		await shell.run("p=/home/user/file");
		const r = await shell.run('echo ${p#*/}');
		expect(r.stdout.trim()).toBe("home/user/file");
	});

	test("uppercase ${var^^}", async () => {
		const shell = createShell();
		await shell.run("x=hello");
		const r = await shell.run('echo ${x^^}');
		expect(r.stdout.trim()).toBe("HELLO");
	});

	test("lowercase ${var,,}", async () => {
		const shell = createShell();
		await shell.run("x=HELLO");
		const r = await shell.run('echo ${x,,}');
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
		expect(r.stdout).toContain("hello world");
	});
});
