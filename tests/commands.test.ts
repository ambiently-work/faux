import { describe, expect, test } from "bun:test";
import { command, commandGroup } from "../src/commands/builder.js";
import { CommandRegistry } from "../src/commands/registry.js";
import type { CommandContext, CommandHandler } from "../src/commands/types.js";
import { Environment } from "../src/env/environment.js";
import { WritableBuffer } from "../src/io/stream.js";
import { Shell } from "../src/shell.js";

function makeContext(args: string[]): {
	ctx: CommandContext;
	stdout: WritableBuffer;
	stderr: WritableBuffer;
} {
	const stdout = new WritableBuffer();
	const stderr = new WritableBuffer();
	const env = new Environment();
	const ctx: CommandContext = {
		args,
		stdin: "",
		env,
		fs: undefined as never,
		cwd: "/",
		isatty: { stdin: false, stdout: false, stderr: false },
		term: { cols: 80, rows: 24, name: "dumb" },
		stdout,
		stderr,
		resolve: (p) => p,
		subExec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
	};
	return { ctx, stdout, stderr };
}

describe("CommandRegistry", () => {
	const dummy = (name: string): CommandHandler => ({ name, execute: () => 0 });

	test("register / get / has", () => {
		const r = new CommandRegistry();
		r.register(dummy("foo"));
		expect(r.get("foo")?.name).toBe("foo");
		expect(r.has("foo")).toBe(true);
		expect(r.has("bar")).toBe(false);
	});

	test("registerAll registers all handlers", () => {
		const r = new CommandRegistry();
		r.registerAll([dummy("a"), dummy("b"), dummy("c")]);
		expect(r.has("a")).toBe(true);
		expect(r.has("b")).toBe(true);
		expect(r.has("c")).toBe(true);
	});

	test("register replaces existing entry", () => {
		const r = new CommandRegistry();
		r.register({ name: "x", execute: () => 1 });
		r.register({ name: "x", execute: () => 2 });
		expect(r.get("x")?.execute(undefined as never)).toBe(2);
	});

	test("remove returns true when present, false otherwise", () => {
		const r = new CommandRegistry();
		r.register(dummy("x"));
		expect(r.remove("x")).toBe(true);
		expect(r.remove("x")).toBe(false);
		expect(r.has("x")).toBe(false);
	});

	test("list returns sorted names", () => {
		const r = new CommandRegistry();
		r.registerAll([dummy("zebra"), dummy("apple"), dummy("mango")]);
		expect(r.list()).toEqual(["apple", "mango", "zebra"]);
	});

	test("get of unknown returns undefined", () => {
		expect(new CommandRegistry().get("nope")).toBeUndefined();
	});
});

describe("command() builder — flag parsing", () => {
	test("boolean flag defaults to false", async () => {
		const cmd = command("test")
			.flag("-v, --verbose", "verbose")
			.action((_, p) => {
				expect(p.flags.verbose).toBe(false);
				return 0;
			});
		const { ctx } = makeContext([]);
		expect(await cmd.toHandler().execute(ctx)).toBe(0);
	});

	test("long boolean flag turns true", async () => {
		const cmd = command("test")
			.flag("-v, --verbose", "v")
			.action((_, p) => {
				expect(p.flags.verbose).toBe(true);
				return 0;
			});
		const { ctx } = makeContext(["--verbose"]);
		expect(await cmd.toHandler().execute(ctx)).toBe(0);
	});

	test("short boolean flag turns true", async () => {
		const cmd = command("test")
			.flag("-v, --verbose", "v")
			.action((_, p) => {
				expect(p.flags.verbose).toBe(true);
				return 0;
			});
		const { ctx } = makeContext(["-v"]);
		expect(await cmd.toHandler().execute(ctx)).toBe(0);
	});

	test("combined short flags (-abc)", async () => {
		const cmd = command("test")
			.flag("-a, --alpha", "")
			.flag("-b, --beta", "")
			.flag("-c, --charlie", "")
			.action((_, p) => {
				expect(p.flags.alpha).toBe(true);
				expect(p.flags.beta).toBe(true);
				expect(p.flags.charlie).toBe(true);
				return 0;
			});
		const { ctx } = makeContext(["-abc"]);
		await cmd.toHandler().execute(ctx);
	});

	test("--no-X negates a boolean flag", async () => {
		const cmd = command("test")
			.flag("-c, --color", "", { default: true })
			.action((_, p) => {
				expect(p.flags.color).toBe(false);
				return 0;
			});
		const { ctx } = makeContext(["--no-color"]);
		await cmd.toHandler().execute(ctx);
	});

	test("string option with --flag value", async () => {
		const cmd = command("test")
			.option("-o, --output <file>", "")
			.action((_, p) => {
				expect(p.flags.output).toBe("out.txt");
				return 0;
			});
		const { ctx } = makeContext(["--output", "out.txt"]);
		await cmd.toHandler().execute(ctx);
	});

	test("string option with --flag=value form", async () => {
		const cmd = command("test")
			.option("-o, --output <file>", "")
			.action((_, p) => {
				expect(p.flags.output).toBe("inline.txt");
				return 0;
			});
		const { ctx } = makeContext(["--output=inline.txt"]);
		await cmd.toHandler().execute(ctx);
	});

	test("number option parses to number", async () => {
		const cmd = command("test")
			.number("-n, --count <n>", "")
			.action((_, p) => {
				expect(p.flags.count).toBe(7);
				return 0;
			});
		const { ctx } = makeContext(["-n", "7"]);
		await cmd.toHandler().execute(ctx);
	});

	test("number option errors on non-numeric", async () => {
		const cmd = command("test")
			.number("-n, --count <n>", "")
			.action(() => 0);
		const { ctx, stderr } = makeContext(["-n", "abc"]);
		const code = await cmd.toHandler().execute(ctx);
		expect(code).toBe(1);
		expect(stderr.toString()).toContain("number");
	});

	test("required option missing → error", async () => {
		const cmd = command("test")
			.option("-o, --output <file>", "", { required: true })
			.action(() => 0);
		const { ctx, stderr } = makeContext([]);
		expect(await cmd.toHandler().execute(ctx)).toBe(1);
		expect(stderr.toString()).toContain("required");
	});

	test("choices restricts allowed values", async () => {
		const cmd = command("test")
			.option("-f, --format <fmt>", "", { choices: ["json", "yaml"] })
			.action(() => 0);
		const { ctx, stderr } = makeContext(["--format", "xml"]);
		expect(await cmd.toHandler().execute(ctx)).toBe(1);
		expect(stderr.toString()).toContain("invalid value");
	});

	test("multiple option collects values into array", async () => {
		const cmd = command("test")
			.option("-i, --include <pat>", "", { multiple: true })
			.action((_, p) => {
				expect(p.flags.include).toEqual(["a", "b", "c"]);
				return 0;
			});
		const { ctx } = makeContext(["-i", "a", "-i", "b", "-i", "c"]);
		await cmd.toHandler().execute(ctx);
	});

	test("unknown flag errors by default", async () => {
		const cmd = command("test").action(() => 0);
		const { ctx, stderr } = makeContext(["--bogus"]);
		expect(await cmd.toHandler().execute(ctx)).toBe(1);
		expect(stderr.toString()).toContain("unknown");
	});

	test("allowUnknownFlags treats unknown as positional", async () => {
		const cmd = command("test")
			.allowUnknownFlags()
			.action((_, p) => {
				expect(p.args).toContain("--bogus");
				return 0;
			});
		const { ctx } = makeContext(["--bogus"]);
		await cmd.toHandler().execute(ctx);
	});

	test("-- ends flag parsing", async () => {
		const cmd = command("test")
			.flag("-v, --verbose", "")
			.action((_, p) => {
				expect(p.flags.verbose).toBe(false);
				expect(p.args).toEqual(["--verbose", "file"]);
				return 0;
			});
		const { ctx } = makeContext(["--", "--verbose", "file"]);
		await cmd.toHandler().execute(ctx);
	});

	test("stopAfterFirstPositional treats subsequent flags as positional", async () => {
		const cmd = command("test")
			.flag("-v, --verbose", "")
			.stopAfterFirstPositional()
			.action((_, p) => {
				expect(p.flags.verbose).toBe(false);
				expect(p.args).toEqual(["positional", "--verbose"]);
				return 0;
			});
		const { ctx } = makeContext(["positional", "--verbose"]);
		await cmd.toHandler().execute(ctx);
	});

	test("- alone is treated as positional (stdin marker)", async () => {
		const cmd = command("test").action((_, p) => {
			expect(p.args).toEqual(["-"]);
			return 0;
		});
		const { ctx } = makeContext(["-"]);
		await cmd.toHandler().execute(ctx);
	});
});

describe("command() builder — positional arguments", () => {
	test("required argument missing → error", async () => {
		const cmd = command("test")
			.argument("<name>", "name")
			.action(() => 0);
		const { ctx, stderr } = makeContext([]);
		expect(await cmd.toHandler().execute(ctx)).toBe(1);
		expect(stderr.toString()).toContain("missing required");
	});

	test("optional argument has default", async () => {
		const cmd = command("test")
			.argument("[level]", "level", { default: "info" })
			.action((_, p) => {
				expect(p.args[0]).toBe("info");
				return 0;
			});
		const { ctx } = makeContext([]);
		await cmd.toHandler().execute(ctx);
	});

	test("argument choices validation", async () => {
		const cmd = command("test")
			.argument("<level>", "lvl", { choices: ["debug", "info", "error"] })
			.action(() => 0);
		const { ctx, stderr } = makeContext(["panic"]);
		expect(await cmd.toHandler().execute(ctx)).toBe(1);
		expect(stderr.toString()).toContain("invalid value");
	});
});

describe("command() builder — subcommands", () => {
	test("dispatches to subcommand", async () => {
		const cmd = command("git");
		cmd.command("init", "init repo").action((c) => {
			c.stdout.write("initialized");
			return 0;
		});
		const { ctx, stdout } = makeContext(["init"]);
		expect(await cmd.toHandler().execute(ctx)).toBe(0);
		expect(stdout.toString()).toBe("initialized");
	});

	test("subcommand inherits parent context but slices args", async () => {
		const cmd = command("git");
		cmd
			.command("commit", "commit changes")
			.flag("-a, --all", "")
			.action((_, p) => {
				expect(p.flags.all).toBe(true);
				return 42;
			});
		const { ctx } = makeContext(["commit", "-a"]);
		expect(await cmd.toHandler().execute(ctx)).toBe(42);
	});

	test("parent with no action shows help when called bare", async () => {
		const cmd = commandGroup("git", "vcs");
		cmd.command("init", "x").action(() => 0);
		const { ctx, stdout } = makeContext([]);
		expect(await cmd.toHandler().execute(ctx)).toBe(0);
		expect(stdout.toString()).toContain("Usage:");
	});
});

describe("command() builder — version, help, hidden", () => {
	test("--help shows usage", async () => {
		const cmd = command("test")
			.description("my desc")
			.action(() => 0);
		const { ctx, stdout } = makeContext(["--help"]);
		expect(await cmd.toHandler().execute(ctx)).toBe(0);
		expect(stdout.toString()).toContain("Usage:");
		expect(stdout.toString()).toContain("my desc");
	});

	test("--version prints when version is set", async () => {
		const cmd = command("test")
			.version("1.2.3")
			.action(() => 0);
		const { ctx, stdout } = makeContext(["--version"]);
		expect(await cmd.toHandler().execute(ctx)).toBe(0);
		expect(stdout.toString().trim()).toBe("test 1.2.3");
	});

	test("missing action errors", async () => {
		const cmd = command("test");
		const { ctx, stderr } = makeContext([]);
		expect(await cmd.toHandler().execute(ctx)).toBe(1);
		expect(stderr.toString()).toContain("no action");
	});
});

describe("command() builder — middleware", () => {
	test("middleware can short-circuit by returning a number", async () => {
		const cmd = command("test")
			.use(() => 99)
			.action(() => 0);
		const { ctx } = makeContext([]);
		expect(await cmd.toHandler().execute(ctx)).toBe(99);
	});

	test("middleware runs before action when returning undefined", async () => {
		const seen: string[] = [];
		const cmd = command("test")
			.use(() => {
				seen.push("mw");
				return undefined;
			})
			.action(() => {
				seen.push("action");
				return 0;
			});
		const { ctx } = makeContext([]);
		await cmd.toHandler().execute(ctx);
		expect(seen).toEqual(["mw", "action"]);
	});
});

describe("command() builder — alias & build", () => {
	test("build emits one handler per alias + primary name", () => {
		const handlers = command("primary")
			.alias("a", "b")
			.action(() => 0)
			.build();
		expect(handlers.map((h) => h.name).sort()).toEqual(["a", "b", "primary"]);
	});
});

describe("Shell + builder integration", () => {
	test("registered builder command runs end-to-end", async () => {
		const shell = new Shell();
		const greet = command("greet")
			.argument("<name>", "person")
			.flag("-l, --loud", "shout")
			.action((ctx, p) => {
				const msg = `Hello, ${p.args[0]}!`;
				ctx.stdout.writeln(p.flags.loud ? msg.toUpperCase() : msg);
				return 0;
			});
		shell.register(greet.toHandler());
		const r1 = await shell.run("greet World");
		expect(r1.stdout.trim()).toBe("Hello, World!");
		const r2 = await shell.run("greet World -l");
		expect(r2.stdout.trim()).toBe("HELLO, WORLD!");
	});

	test("shell.unregister removes command", async () => {
		const shell = new Shell();
		shell.register({ name: "noop", execute: () => 0 });
		expect(shell.commands).toContain("noop");
		shell.unregister("noop");
		expect(shell.commands).not.toContain("noop");
		const r = await shell.run("noop");
		expect(r.exitCode).toBe(127);
	});
});
