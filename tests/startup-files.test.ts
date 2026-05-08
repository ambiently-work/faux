import { describe, expect, test } from "bun:test";
import { Shell } from "../src/shell.js";

describe("startup files (#18)", () => {
	test("interactive shell sources ~/.bashrc — env vars and aliases", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			fs: {
				"/home/luca/.bashrc": "alias greet='echo hello from alias'\nexport BASHRC_LOADED=1\n",
			},
		});

		const r1 = await shell.run("echo $BASHRC_LOADED");
		expect(r1.stdout).toBe("1\n");
		const r2 = await shell.run("greet");
		expect(r2.stdout).toBe("hello from alias\n");
	});

	test("interactive shell sources /etc/bash.bashrc before ~/.bashrc", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			fs: {
				"/etc/bash.bashrc": "export ORDER=etc\n",
				"/home/luca/.bashrc": "export ORDER=$ORDER:home\n",
			},
		});

		const r = await shell.run("echo $ORDER");
		expect(r.stdout).toBe("etc:home\n");
	});

	test("login shell sources /etc/profile and ~/.bash_profile", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			login: true,
			fs: {
				"/etc/profile": "export FROM_PROFILE=1\n",
				"/home/luca/.bash_profile": "export FROM_BASH_PROFILE=1\n",
			},
		});

		const r1 = await shell.run("echo $FROM_PROFILE");
		expect(r1.stdout).toBe("1\n");
		const r2 = await shell.run("echo $FROM_BASH_PROFILE");
		expect(r2.stdout).toBe("1\n");
	});

	test("login shell falls through to ~/.profile if no .bash_profile or .bash_login", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			login: true,
			fs: {
				"/home/luca/.profile": "export FROM_PROFILE=fallback\n",
			},
		});

		const r = await shell.run("echo $FROM_PROFILE");
		expect(r.stdout).toBe("fallback\n");
	});

	test("login shell stops at first found profile file", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			login: true,
			fs: {
				"/home/luca/.bash_profile": "export PICKED=bash_profile\n",
				"/home/luca/.bash_login": "export PICKED=bash_login\n",
				"/home/luca/.profile": "export PICKED=profile\n",
			},
		});

		const r = await shell.run("echo $PICKED");
		expect(r.stdout).toBe("bash_profile\n");
	});

	test("non-interactive shell sources $BASH_ENV", async () => {
		const shell = new Shell({
			env: { BASH_ENV: "/init.sh" },
			fs: {
				"/init.sh": "export BASH_ENV_LOADED=1\n",
			},
		});

		const r = await shell.run("echo $BASH_ENV_LOADED");
		expect(r.stdout).toBe("1\n");
	});

	test("non-interactive shell expands ~ in $BASH_ENV", async () => {
		const shell = new Shell({
			user: "luca",
			env: { BASH_ENV: "~/init.sh" },
			fs: {
				"/home/luca/init.sh": "export TILDE_LOADED=1\n",
			},
		});

		const r = await shell.run("echo $TILDE_LOADED");
		expect(r.stdout).toBe("1\n");
	});

	test("non-interactive shell ignores ~/.bashrc", async () => {
		const shell = new Shell({
			user: "luca",
			fs: {
				"/home/luca/.bashrc": "export SHOULD_NOT_LOAD=1\n",
			},
		});

		const r = await shell.run("echo ${SHOULD_NOT_LOAD:-unset}");
		expect(r.stdout).toBe("unset\n");
	});

	test("skipStartupFiles bypasses everything", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			skipStartupFiles: true,
			env: { BASH_ENV: "/init.sh" },
			fs: {
				"/etc/bash.bashrc": "export FROM_ETC=1\n",
				"/home/luca/.bashrc": "export FROM_BASHRC=1\n",
				"/init.sh": "export FROM_BASH_ENV=1\n",
			},
		});

		const r = await shell.run("echo ${FROM_ETC:-x} ${FROM_BASHRC:-x} ${FROM_BASH_ENV:-x}");
		expect(r.stdout).toBe("x x x\n");
	});

	test("missing startup files don't error", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			login: true,
		});

		const r = await shell.run("echo ok");
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("ok\n");
	});

	test("startup files only run once across multiple run() calls", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			fs: {
				"/home/luca/.bashrc": "echo loaded >> /tmp/log\n",
				"/tmp/log": "",
			},
		});

		await shell.run("echo first");
		await shell.run("echo second");
		const r = await shell.run("cat /tmp/log");
		expect(r.stdout).toBe("loaded\n");
	});

	test("init() runs startup files eagerly", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			fs: {
				"/home/luca/.bashrc": "export EAGER=1\n",
			},
		});

		await shell.init();
		expect(shell.environment.get("EAGER")).toBe("1");
	});

	test("init() is idempotent", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			fs: {
				"/home/luca/.bashrc": "echo loaded >> /tmp/log\n",
				"/tmp/log": "",
			},
		});

		await shell.init();
		await shell.init();
		await shell.run("echo go");
		const r = await shell.run("cat /tmp/log");
		expect(r.stdout).toBe("loaded\n");
	});

	test("malformed rc file doesn't abort startup", async () => {
		const shell = new Shell({
			user: "luca",
			interactive: true,
			fs: {
				"/etc/bash.bashrc": "this is (((( not valid shell\n",
				"/home/luca/.bashrc": "export AFTER_BAD=1\n",
			},
		});

		const r = await shell.run("echo ${AFTER_BAD:-missing}");
		expect(r.exitCode).toBe(0);
	});
});
