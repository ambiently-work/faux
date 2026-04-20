import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function createShell(fs?: Record<string, string>) {
	return new Shell({
		fs: {
			"/etc/hosts": "127.0.0.1 localhost\n::1 localhost\n192.168.1.1 router\n",
			"/home/user/hello.txt": "Hello, World!\nGoodbye, World!\nHello again!\n",
			"/home/user/numbers.txt": "3\n1\n4\n1\n5\n9\n2\n6\n",
			...fs,
		},
		env: { HOME: "/home/user", USER: "testuser" },
	});
}

describe("Shell", () => {
	describe("basic commands", () => {
		test("echo", async () => {
			const shell = createShell();
			const r = await shell.run("echo hello world");
			expect(r.stdout).toBe("hello world\n");
			expect(r.exitCode).toBe(0);
		});

		test("echo -n", async () => {
			const shell = createShell();
			const r = await shell.run("echo -n hello");
			expect(r.stdout).toBe("hello");
		});

		test("pwd", async () => {
			const shell = createShell();
			const r = await shell.run("pwd");
			expect(r.stdout).toBe("/\n");
		});

		test("true and false", async () => {
			const shell = createShell();
			expect((await shell.run("true")).exitCode).toBe(0);
			expect((await shell.run("false")).exitCode).toBe(1);
		});

		test("cd", async () => {
			const shell = createShell();
			await shell.run("cd /home/user");
			const r = await shell.run("pwd");
			expect(r.stdout).toBe("/home/user\n");
		});
	});

	describe("filesystem operations", () => {
		test("cat reads file", async () => {
			const shell = createShell();
			const r = await shell.run("cat /etc/hosts");
			expect(r.stdout).toContain("127.0.0.1 localhost");
		});

		test("mkdir creates directory", async () => {
			const shell = createShell();
			await shell.run("mkdir -p /tmp/test/nested");
			const r = await shell.run("ls /tmp/test");
			expect(r.stdout).toContain("nested");
		});

		test("touch creates file", async () => {
			const shell = createShell();
			await shell.run("touch /tmp/newfile");
			const r = await shell.run("ls /tmp");
			expect(r.stdout).toContain("newfile");
		});

		test("cp copies file", async () => {
			const shell = createShell();
			await shell.run("cp /etc/hosts /tmp/hosts-copy");
			const r = await shell.run("cat /tmp/hosts-copy");
			expect(r.stdout).toContain("localhost");
		});

		test("rm removes file", async () => {
			const shell = createShell();
			await shell.run("touch /tmp/deleteme");
			await shell.run("rm /tmp/deleteme");
			const r = await shell.run("ls /tmp");
			expect(r.stdout).not.toContain("deleteme");
		});

		test("mv moves file", async () => {
			const shell = createShell();
			await shell.run("touch /tmp/before");
			await shell.run("mv /tmp/before /tmp/after");
			const r = await shell.run("ls /tmp");
			expect(r.stdout).not.toContain("before");
			expect(r.stdout).toContain("after");
		});
	});

	describe("pipes", () => {
		test("simple pipe", async () => {
			const shell = createShell();
			const r = await shell.run("cat /etc/hosts | grep localhost");
			expect(r.stdout).toContain("127.0.0.1 localhost");
			expect(r.stdout).toContain("::1 localhost");
			expect(r.stdout).not.toContain("router");
		});

		test("multi-stage pipe", async () => {
			const shell = createShell();
			const r = await shell.run("cat /etc/hosts | grep localhost | wc -l");
			expect(r.stdout.trim()).toBe("2");
		});

		test("pipe with head", async () => {
			const shell = createShell();
			const r = await shell.run("cat /etc/hosts | head -n 1");
			expect(r.stdout.trim()).toBe("127.0.0.1 localhost");
		});
	});

	describe("variables", () => {
		test("export and use variable", async () => {
			const shell = createShell();
			await shell.run("export GREETING=hello");
			const r = await shell.run("echo $GREETING");
			expect(r.stdout.trim()).toBe("hello");
		});

		test("HOME variable", async () => {
			const shell = createShell();
			const r = await shell.run("echo $HOME");
			expect(r.stdout.trim()).toBe("/home/user");
		});

		test("special variable $?", async () => {
			const shell = createShell();
			await shell.run("true");
			const r = await shell.run("echo $?");
			expect(r.stdout.trim()).toBe("0");
		});
	});

	describe("operators", () => {
		test("&& runs second on success", async () => {
			const shell = createShell();
			const r = await shell.run("true && echo success");
			expect(r.stdout.trim()).toBe("success");
		});

		test("&& skips second on failure", async () => {
			const shell = createShell();
			const r = await shell.run("false && echo nope");
			expect(r.stdout).toBe("");
		});

		test("|| runs second on failure", async () => {
			const shell = createShell();
			const r = await shell.run("false || echo fallback");
			expect(r.stdout.trim()).toBe("fallback");
		});

		test("|| skips second on success", async () => {
			const shell = createShell();
			const r = await shell.run("true || echo nope");
			expect(r.stdout).toBe("");
		});
	});

	describe("redirects", () => {
		test("output redirect to file", async () => {
			const shell = createShell();
			await shell.run("echo hello > /tmp/out.txt");
			const r = await shell.run("cat /tmp/out.txt");
			expect(r.stdout.trim()).toBe("hello");
		});

		test("append redirect", async () => {
			const shell = createShell();
			await shell.run("echo line1 > /tmp/append.txt");
			await shell.run("echo line2 >> /tmp/append.txt");
			const r = await shell.run("cat /tmp/append.txt");
			expect(r.stdout).toContain("line1");
			expect(r.stdout).toContain("line2");
		});

		test("input redirect", async () => {
			const shell = createShell();
			const r = await shell.run("grep localhost < /etc/hosts");
			expect(r.stdout).toContain("localhost");
		});
	});

	describe("text processing", () => {
		test("sort", async () => {
			const shell = createShell();
			const r = await shell.run("cat /home/user/numbers.txt | sort -n");
			const lines = r.stdout.trim().split("\n");
			expect(lines[0]).toBe("1");
			expect(lines[lines.length - 1]).toBe("9");
		});

		test("uniq", async () => {
			const shell = createShell();
			const r = await shell.run("cat /home/user/numbers.txt | sort -n | uniq");
			expect(r.stdout).not.toMatch(/^1\n1$/m);
		});

		test("wc", async () => {
			const shell = createShell();
			const r = await shell.run("echo -n hello | wc -c");
			expect(r.stdout.trim()).toBe("5");
		});

		test("head and tail", async () => {
			const shell = createShell();
			const h = await shell.run("head -n 1 /etc/hosts");
			expect(h.stdout.trim()).toBe("127.0.0.1 localhost");

			const t = await shell.run("tail -n 1 /etc/hosts");
			expect(t.stdout.trim()).toBe("192.168.1.1 router");
		});

		test("cut", async () => {
			const shell = createShell();
			const r = await shell.run("echo 'a:b:c' | cut -d: -f2");
			expect(r.stdout.trim()).toBe("b");
		});

		test("tr", async () => {
			const shell = createShell();
			const r = await shell.run("echo hello | tr a-z A-Z");
			expect(r.stdout.trim()).toBe("HELLO");
		});

		test("rev", async () => {
			const shell = createShell();
			const r = await shell.run("echo hello | rev");
			expect(r.stdout.trim()).toBe("olleh");
		});

		test("tac", async () => {
			const shell = createShell();
			const r = await shell.run("echo -e 'a\\nb\\nc' | tac");
			const lines = r.stdout.trim().split("\n");
			expect(lines[0]).toBe("c");
			expect(lines[2]).toBe("a");
		});

		test("basename and dirname", async () => {
			const shell = createShell();
			const b = await shell.run("basename /home/user/hello.txt");
			expect(b.stdout.trim()).toBe("hello.txt");

			const d = await shell.run("dirname /home/user/hello.txt");
			expect(d.stdout.trim()).toBe("/home/user");
		});

		test("sed substitution", async () => {
			const shell = createShell();
			const r = await shell.run("echo 'hello world' | sed 's/world/earth/'");
			expect(r.stdout.trim()).toBe("hello earth");
		});
	});

	describe("control flow", () => {
		test("if-then-fi", async () => {
			const shell = createShell();
			const r = await shell.run("if true; then echo yes; fi");
			expect(r.stdout.trim()).toBe("yes");
		});

		test("if-else", async () => {
			const shell = createShell();
			const r = await shell.run("if false; then echo no; else echo yes; fi");
			expect(r.stdout.trim()).toBe("yes");
		});

		test("for loop", async () => {
			const shell = createShell();
			const r = await shell.run("for x in a b c; do echo $x; done");
			expect(r.stdout).toBe("a\nb\nc\n");
		});
	});

	describe("functions", () => {
		test("define and call function", async () => {
			const shell = createShell();
			await shell.run("greet() { echo hello; }");
			const r = await shell.run("greet");
			expect(r.stdout.trim()).toBe("hello");
		});
	});

	describe("subshells", () => {
		test("subshell doesn't affect parent env", async () => {
			const shell = createShell();
			await shell.run("export X=before");
			await shell.run("(export X=after)");
			const r = await shell.run("echo $X");
			expect(r.stdout.trim()).toBe("before");
		});
	});

	describe("misc commands", () => {
		test("date runs", async () => {
			const shell = createShell();
			const r = await shell.run("date");
			expect(r.exitCode).toBe(0);
			expect(r.stdout.length).toBeGreaterThan(0);
		});

		test("uname -a", async () => {
			const shell = createShell();
			const r = await shell.run("uname -a");
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toContain("faux-shell");
		});

		test("seq", async () => {
			const shell = createShell();
			const r = await shell.run("seq 1 5");
			expect(r.stdout.trim()).toBe("1\n2\n3\n4\n5");
		});

		test("printf", async () => {
			const shell = createShell();
			const r = await shell.run("printf '%s %d\\n' hello 42");
			expect(r.stdout).toBe("hello 42\n");
		});

		test("test / [", async () => {
			const shell = createShell();
			const r1 = await shell.run("test -f /etc/hosts");
			expect(r1.exitCode).toBe(0);

			const r2 = await shell.run("test -f /nonexistent");
			expect(r2.exitCode).toBe(1);
		});

		test("base64 encode", async () => {
			const shell = createShell();
			const r = await shell.run("echo -n hello | base64");
			expect(r.stdout.trim()).toStartWith("aGVsbG8");
		});

		test("tree", async () => {
			const shell = createShell();
			await shell.run("mkdir -p /tmp/a/b");
			const r = await shell.run("tree /tmp");
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toContain("a");
		});

		test("find", async () => {
			const shell = createShell();
			const r = await shell.run("find /home -name '*.txt'");
			expect(r.stdout).toContain("hello.txt");
		});

		test("du", async () => {
			const shell = createShell();
			const r = await shell.run("du -s /etc/hosts");
			expect(r.exitCode).toBe(0);
		});

		test("command not found", async () => {
			const shell = createShell();
			const r = await shell.run("nonexistent_command");
			expect(r.exitCode).toBe(127);
			expect(r.stderr).toContain("command not found");
		});
	});

	describe("custom commands", () => {
		test("register custom command", async () => {
			const shell = createShell();
			shell.register({
				name: "greet",
				execute(ctx) {
					ctx.stdout.writeln(`Hello, ${ctx.args[0] ?? "world"}!`);
					return 0;
				},
			});
			const r = await shell.run("greet Luca");
			expect(r.stdout.trim()).toBe("Hello, Luca!");
		});
	});

	describe("snapshot", () => {
		test("snapshot returns all files", async () => {
			const shell = createShell();
			await shell.run("echo test > /tmp/snapshot-test");
			const snap = shell.snapshot();
			expect(snap["/tmp/snapshot-test"]).toContain("test");
			expect(snap["/etc/hosts"]).toContain("localhost");
		});
	});
});
