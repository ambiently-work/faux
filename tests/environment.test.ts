import { describe, expect, test } from "bun:test";
import { Environment } from "../src/env/environment.js";

describe("Environment defaults", () => {
	test("has standard POSIX vars set", () => {
		const env = new Environment();
		expect(env.get("HOME")).toBe("/root");
		expect(env.get("PATH")).toBe("/usr/bin:/bin");
		expect(env.get("PWD")).toBe("/");
		expect(env.get("SHELL")).toBe("/bin/bash");
		expect(env.get("USER")).toBe("root");
		expect(env.get("HOSTNAME")).toBe("faux-shell");
		expect(env.get("SHLVL")).toBe("1");
	});

	test("default vars are exported", () => {
		const env = new Environment();
		expect(env.isExported("HOME")).toBe(true);
		expect(env.isExported("PATH")).toBe(true);
	});

	test("initial overrides defaults", () => {
		const env = new Environment({ HOME: "/home/luca", USER: "luca" });
		expect(env.get("HOME")).toBe("/home/luca");
		expect(env.get("USER")).toBe("luca");
	});

	test("cwd defaults to PWD value", () => {
		const env = new Environment({ PWD: "/tmp" });
		expect(env.cwd).toBe("/tmp");
	});
});

describe("Environment get/set/unset", () => {
	test("set then get round-trips", () => {
		const env = new Environment();
		env.set("FOO", "bar");
		expect(env.get("FOO")).toBe("bar");
	});

	test("unset removes variable", () => {
		const env = new Environment();
		env.set("X", "1");
		env.unset("X");
		expect(env.get("X")).toBeUndefined();
	});

	test("set on PWD updates cwd", () => {
		const env = new Environment();
		env.set("PWD", "/foo/bar");
		expect(env.cwd).toBe("/foo/bar");
	});

	test("setting cwd updates PWD", () => {
		const env = new Environment();
		env.cwd = "/new/path";
		expect(env.get("PWD")).toBe("/new/path");
	});

	test("get of unknown returns undefined", () => {
		const env = new Environment();
		expect(env.get("NOPE")).toBeUndefined();
	});
});

describe("Environment exports", () => {
	test("set without export is not exported", () => {
		const env = new Environment();
		env.set("LOCAL", "1");
		expect(env.isExported("LOCAL")).toBe(false);
	});

	test("export marks variable as exported", () => {
		const env = new Environment();
		env.set("X", "1");
		env.export("X");
		expect(env.isExported("X")).toBe(true);
	});

	test("export with value sets and exports", () => {
		const env = new Environment();
		env.export("Y", "two");
		expect(env.get("Y")).toBe("two");
		expect(env.isExported("Y")).toBe(true);
	});

	test("unexport removes export but keeps value", () => {
		const env = new Environment();
		env.export("X", "v");
		env.unexport("X");
		expect(env.isExported("X")).toBe(false);
		expect(env.get("X")).toBe("v");
	});

	test("unset clears exported flag too", () => {
		const env = new Environment();
		env.export("X", "v");
		env.unset("X");
		expect(env.isExported("X")).toBe(false);
	});

	test("toObject returns only exported vars", () => {
		const env = new Environment();
		env.set("LOCAL", "no");
		env.export("PUB", "yes");
		const obj = env.toObject();
		expect(obj.PUB).toBe("yes");
		expect(obj.LOCAL).toBeUndefined();
		expect(obj.HOME).toBe("/root"); // default
	});
});

describe("Environment readonly", () => {
	test("markReadonly prevents set", () => {
		const env = new Environment();
		env.set("X", "v");
		env.markReadonly("X");
		expect(() => env.set("X", "other")).toThrow(/readonly/);
	});

	test("markReadonly prevents unset", () => {
		const env = new Environment();
		env.set("X", "v");
		env.markReadonly("X");
		expect(() => env.unset("X")).toThrow(/readonly/);
	});

	test("isReadonly reports true", () => {
		const env = new Environment();
		env.markReadonly("X");
		expect(env.isReadonly("X")).toBe(true);
	});
});

describe("Environment fork (subshell)", () => {
	test("inherits all variables", () => {
		const parent = new Environment();
		parent.set("X", "1");
		parent.set("Y", "2");
		const child = parent.fork();
		expect(child.get("X")).toBe("1");
		expect(child.get("Y")).toBe("2");
	});

	test("inherits exports", () => {
		const parent = new Environment();
		parent.export("E", "v");
		const child = parent.fork();
		expect(child.isExported("E")).toBe(true);
	});

	test("inherits cwd", () => {
		const parent = new Environment();
		parent.cwd = "/some/path";
		const child = parent.fork();
		expect(child.cwd).toBe("/some/path");
	});

	test("child mutations do not affect parent", () => {
		const parent = new Environment();
		parent.set("X", "before");
		const child = parent.fork();
		child.set("X", "after");
		expect(parent.get("X")).toBe("before");
		expect(child.get("X")).toBe("after");
	});

	test("SHLVL increments by 1 in child", () => {
		const parent = new Environment();
		const child = parent.fork();
		expect(child.get("SHLVL")).toBe("2");
		const grandchild = child.fork();
		expect(grandchild.get("SHLVL")).toBe("3");
	});

	test("inherits aliases and options", () => {
		const parent = new Environment();
		parent.setAlias("ll", "ls -la");
		parent.setOption("errexit");
		const child = parent.fork();
		expect(child.getAlias("ll")).toBe("ls -la");
		expect(child.hasOption("errexit")).toBe(true);
	});

	test("inherits readonly flags", () => {
		const parent = new Environment();
		parent.set("RO", "v");
		parent.markReadonly("RO");
		const child = parent.fork();
		expect(child.isReadonly("RO")).toBe(true);
		expect(() => child.set("RO", "x")).toThrow(/readonly/);
	});
});

describe("Environment specials ($?, $#, $@, $0, etc.)", () => {
	test("$? reflects lastExitCode", () => {
		const env = new Environment();
		env.lastExitCode = 42;
		expect(env.getSpecial("?")).toBe("42");
	});

	test("$# is positional arg count", () => {
		const env = new Environment();
		env.positionalArgs = ["a", "b", "c"];
		expect(env.getSpecial("#")).toBe("3");
	});

	test("$@ joins positional with space", () => {
		const env = new Environment();
		env.positionalArgs = ["a", "b", "c"];
		expect(env.getSpecial("@")).toBe("a b c");
	});

	test("$* joins with first IFS char", () => {
		const env = new Environment();
		env.positionalArgs = ["a", "b"];
		env.set("IFS", ":xy");
		expect(env.getSpecial("*")).toBe("a:b");
	});

	test("$0 returns shell name", () => {
		const env = new Environment();
		expect(env.getSpecial("0")).toBe("faux-shell");
	});

	test("$1, $2, ... return positional args", () => {
		const env = new Environment();
		env.positionalArgs = ["first", "second", "third"];
		expect(env.getSpecial("1")).toBe("first");
		expect(env.getSpecial("2")).toBe("second");
		expect(env.getSpecial("3")).toBe("third");
	});

	test("positional past end returns undefined", () => {
		const env = new Environment();
		env.positionalArgs = ["only"];
		expect(env.getSpecial("5")).toBeUndefined();
	});

	test("$- reflects active option flags", () => {
		const env = new Environment();
		env.setOption("errexit");
		env.setOption("nounset");
		expect(env.getSpecial("-")).toBe("eu");
	});

	test("$RANDOM returns numeric string in range", () => {
		const env = new Environment();
		const v = env.getSpecial("RANDOM");
		const n = Number(v);
		expect(n).toBeGreaterThanOrEqual(0);
		expect(n).toBeLessThan(32768);
	});

	test("$SECONDS returns non-negative integer", () => {
		const env = new Environment();
		const s = Number(env.getSpecial("SECONDS"));
		expect(s).toBeGreaterThanOrEqual(0);
	});

	test("unknown special returns undefined", () => {
		const env = new Environment();
		expect(env.getSpecial("UNKNOWN_X")).toBeUndefined();
	});
});

describe("Environment aliases & functions & options", () => {
	test("setAlias / getAlias / removeAlias", () => {
		const env = new Environment();
		env.setAlias("ll", "ls -la");
		expect(env.getAlias("ll")).toBe("ls -la");
		env.removeAlias("ll");
		expect(env.getAlias("ll")).toBeUndefined();
	});

	test("aliases() returns a new map (not same reference)", () => {
		const env = new Environment();
		env.setAlias("a", "1");
		const copy = env.aliases();
		copy.set("b", "2");
		expect(env.getAlias("b")).toBeUndefined();
	});

	test("setFunction / getFunction / removeFunction", () => {
		const env = new Environment();
		env.setFunction("greet", { type: "stub" });
		expect(env.getFunction("greet")).toEqual({ type: "stub" });
		env.removeFunction("greet");
		expect(env.getFunction("greet")).toBeUndefined();
	});

	test("setOption / hasOption / unsetOption", () => {
		const env = new Environment();
		env.setOption("xtrace");
		expect(env.hasOption("xtrace")).toBe(true);
		env.unsetOption("xtrace");
		expect(env.hasOption("xtrace")).toBe(false);
	});
});
