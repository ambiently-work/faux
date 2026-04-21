import { describe, expect, test } from "bun:test";
import { PipelineRunner, pipeChain, pipeTwo } from "../src/io/pipe.js";
import { WritableBuffer } from "../src/io/stream.js";
import type { ShellResult } from "../src/types.js";

describe("WritableBuffer", () => {
	test("starts empty", () => {
		const b = new WritableBuffer();
		expect(b.toString()).toBe("");
		expect(b.length).toBe(0);
	});

	test("write appends without newline", () => {
		const b = new WritableBuffer();
		b.write("hello");
		b.write(" world");
		expect(b.toString()).toBe("hello world");
	});

	test("writeln appends with trailing newline", () => {
		const b = new WritableBuffer();
		b.writeln("line1");
		b.writeln("line2");
		expect(b.toString()).toBe("line1\nline2\n");
	});

	test("length sums chunk lengths", () => {
		const b = new WritableBuffer();
		b.write("abc");
		b.writeln("de"); // 3
		expect(b.length).toBe(6);
	});

	test("clear empties the buffer", () => {
		const b = new WritableBuffer();
		b.writeln("data");
		b.clear();
		expect(b.toString()).toBe("");
		expect(b.length).toBe(0);
	});

	test("supports unicode codepoints by character length", () => {
		const b = new WritableBuffer();
		b.write("héllo");
		expect(b.toString()).toBe("héllo");
	});
});

describe("pipeTwo", () => {
	test("passes left.stdout to right as stdin", () => {
		const left = (stdin: string): ShellResult => ({
			stdout: `${stdin}left-out`,
			stderr: "",
			exitCode: 0,
		});
		const right = (stdin: string): ShellResult => ({
			stdout: `[${stdin}]`,
			stderr: "",
			exitCode: 0,
		});
		const r = pipeTwo(left, right, "init");
		expect(r.stdout).toBe("[initleft-out]");
	});

	test("returns right's exit code", () => {
		const left = (): ShellResult => ({ stdout: "ok", stderr: "", exitCode: 0 });
		const right = (): ShellResult => ({ stdout: "", stderr: "boom", exitCode: 5 });
		const r = pipeTwo(left, right);
		expect(r.exitCode).toBe(5);
	});
});

describe("pipeChain", () => {
	test("empty chain returns success", () => {
		const r = pipeChain([]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("");
	});

	test("single command runs once", () => {
		const r = pipeChain([(stdin) => ({ stdout: `${stdin}!`, stderr: "", exitCode: 0 })], "hi");
		expect(r.stdout).toBe("hi!");
	});

	test("chains stdout->stdin through multiple stages", () => {
		const stages = [
			(s: string) => ({ stdout: `${s}A`, stderr: "", exitCode: 0 }),
			(s: string) => ({ stdout: `${s}B`, stderr: "", exitCode: 0 }),
			(s: string) => ({ stdout: `${s}C`, stderr: "", exitCode: 0 }),
		];
		const r = pipeChain(stages, "x");
		expect(r.stdout).toBe("xABC");
	});

	test("collects stderr from all stages", () => {
		const stages = [
			(_: string) => ({ stdout: "1", stderr: "err1\n", exitCode: 0 }),
			(_: string) => ({ stdout: "2", stderr: "err2\n", exitCode: 0 }),
		];
		const r = pipeChain(stages);
		expect(r.stderr).toBe("err1\nerr2\n");
	});

	test("exit code is from the last command", () => {
		const stages = [
			(_: string) => ({ stdout: "x", stderr: "", exitCode: 5 }),
			(_: string) => ({ stdout: "y", stderr: "", exitCode: 0 }),
		];
		const r = pipeChain(stages);
		expect(r.exitCode).toBe(0);
	});
});

describe("PipelineRunner", () => {
	test("empty pipeline returns success", () => {
		const r = new PipelineRunner().run();
		expect(r.exitCode).toBe(0);
	});

	test("add() chain runs in order", () => {
		const r = new PipelineRunner()
			.add((s) => ({ stdout: `${s}1`, stderr: "", exitCode: 0 }))
			.add((s) => ({ stdout: `${s}2`, stderr: "", exitCode: 0 }))
			.run("base");
		expect(r.stdout).toBe("base12");
	});

	test("default exit code is from last command", () => {
		const r = new PipelineRunner()
			.add(() => ({ stdout: "", stderr: "", exitCode: 7 }))
			.add(() => ({ stdout: "", stderr: "", exitCode: 0 }))
			.run();
		expect(r.exitCode).toBe(0);
	});

	test("pipefail returns first non-zero exit code", () => {
		const r = new PipelineRunner({ pipefail: true })
			.add(() => ({ stdout: "", stderr: "", exitCode: 0 }))
			.add(() => ({ stdout: "", stderr: "", exitCode: 7 }))
			.add(() => ({ stdout: "", stderr: "", exitCode: 0 }))
			.run();
		expect(r.exitCode).toBe(7);
	});

	test("pipefail picks earliest non-zero (not last)", () => {
		const r = new PipelineRunner({ pipefail: true })
			.add(() => ({ stdout: "", stderr: "", exitCode: 3 }))
			.add(() => ({ stdout: "", stderr: "", exitCode: 5 }))
			.run();
		expect(r.exitCode).toBe(3);
	});
});
