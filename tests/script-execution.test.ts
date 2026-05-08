import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

function makeShell(fs?: Record<string, string>) {
	return new Shell({
		user: "u",
		skipStartupFiles: true,
		env: { PATH: "/usr/bin:/bin:/tmp" },
		fs,
	});
}

describe("script execution (#14)", () => {
	test("/path/to/script with sh shebang and exec bit runs", async () => {
		const s = makeShell({ "/tmp/hi": "#!/bin/sh\necho hi\n" });
		await s.run("chmod +x /tmp/hi");
		const r = await s.run("/tmp/hi");
		expect(r.stdout.trim()).toBe("hi");
		expect(r.exitCode).toBe(0);
	});

	test("script without exec bit gets Permission denied", async () => {
		const s = makeShell({ "/tmp/hi": "#!/bin/sh\necho hi\n" });
		const r = await s.run("/tmp/hi");
		expect(r.stderr).toContain("Permission denied");
		expect(r.exitCode).toBe(126);
	});

	test("relative script ./name resolves against cwd", async () => {
		const s = makeShell({ "/tmp/hi": "#!/bin/sh\necho hi\n" });
		await s.run("chmod +x /tmp/hi");
		await s.run("cd /tmp");
		const r = await s.run("./hi");
		expect(r.stdout.trim()).toBe("hi");
	});

	test("unqualified name walks $PATH", async () => {
		const s = makeShell({ "/tmp/greet": "#!/bin/sh\necho hello\n" });
		await s.run("chmod +x /tmp/greet");
		const r = await s.run("greet");
		expect(r.stdout.trim()).toBe("hello");
	});

	test("name not in PATH falls through to command not found", async () => {
		const s = makeShell();
		const r = await s.run("nonexistent_xyz");
		expect(r.stderr).toContain("command not found");
		expect(r.exitCode).toBe(127);
	});

	test("unknown shebang interpreter reports bad interpreter", async () => {
		const s = makeShell({ "/tmp/p": "#!/usr/bin/env python3\nprint('hi')\n" });
		await s.run("chmod +x /tmp/p");
		const r = await s.run("/tmp/p");
		expect(r.stderr).toContain("bad interpreter: python3");
		expect(r.exitCode).toBe(126);
	});

	test("file without shebang runs as shell input", async () => {
		const s = makeShell({ "/tmp/n": "echo no-shebang\n" });
		await s.run("chmod +x /tmp/n");
		const r = await s.run("/tmp/n");
		expect(r.stdout.trim()).toBe("no-shebang");
	});

	test("script gets positional args $1, $2, $@", async () => {
		const s = makeShell({
			"/tmp/args": '#!/bin/sh\necho "[$#] $1 $2 -- $@"\n',
		});
		await s.run("chmod +x /tmp/args");
		const r = await s.run("/tmp/args alpha beta gamma");
		expect(r.stdout.trim()).toBe("[3] alpha beta -- alpha beta gamma");
	});

	test("script $0 reports the invocation name", async () => {
		const s = makeShell({ "/tmp/zero": "#!/bin/sh\necho $0\n" });
		await s.run("chmod +x /tmp/zero");
		const r = await s.run("/tmp/zero");
		expect(r.stdout.trim()).toBe("/tmp/zero");
	});

	test("absolute /usr/bin/env sh shebang works", async () => {
		const s = makeShell({ "/tmp/env-sh": "#!/usr/bin/env sh\necho via-env\n" });
		await s.run("chmod +x /tmp/env-sh");
		const r = await s.run("/tmp/env-sh");
		expect(r.stdout.trim()).toBe("via-env");
	});

	test("/bin/bash shebang works", async () => {
		const s = makeShell({ "/tmp/bash-script": "#!/bin/bash\necho via-bash\n" });
		await s.run("chmod +x /tmp/bash-script");
		const r = await s.run("/tmp/bash-script");
		expect(r.stdout.trim()).toBe("via-bash");
	});

	test("script propagates exit code", async () => {
		const s = makeShell({ "/tmp/fail": "#!/bin/sh\nexit 7\n" });
		await s.run("chmod +x /tmp/fail");
		const r = await s.run("/tmp/fail");
		expect(r.exitCode).toBe(7);
	});

	test("builtins still take precedence over PATH-resolved scripts", async () => {
		const s = makeShell({ "/tmp/echo": "#!/bin/sh\necho FROM_SCRIPT\n" });
		await s.run("chmod +x /tmp/echo");
		const r = await s.run("echo from_builtin");
		expect(r.stdout.trim()).toBe("from_builtin");
	});
});
