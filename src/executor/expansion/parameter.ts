import type { IFileSystem } from "@ambiently-work/vfs";
import type { Environment } from "../../env/environment.js";
import type { Word } from "../../parser/index.js";
import { globToRegex } from "./glob.js";
import { expandWord, type SubExecFn } from "./word.js";

export function expandVariable(name: string, env: Environment): string {
	// Special variables
	const special = env.getSpecial(name);
	if (special !== undefined) return special;

	return env.get(name) ?? "";
}

export async function expandVariableOp(
	name: string,
	op: string,
	arg: Word,
	env: Environment,
	fs: IFileSystem,
	subExec: SubExecFn,
): Promise<string> {
	const val = env.get(name) ?? env.getSpecial(name);
	const argStr = async () => expandWord(arg, env, fs, subExec);

	switch (op) {
		case ":-": // default value if unset or null
			return val !== undefined && val !== "" ? val : await argStr();
		case "-": // default value if unset
			return val !== undefined ? val : await argStr();
		case ":=": // assign default if unset or null
			if (val !== undefined && val !== "") return val;
			{
				const v = await argStr();
				env.set(name, v);
				return v;
			}
		case "=": // assign default if unset
			if (val !== undefined) return val;
			{
				const v = await argStr();
				env.set(name, v);
				return v;
			}
		case ":+": // alternate value if set and non-null
			return val !== undefined && val !== "" ? await argStr() : "";
		case "+": // alternate value if set
			return val !== undefined ? await argStr() : "";
		case ":?": // error if unset or null
			if (val !== undefined && val !== "") return val;
			throw new Error(`${name}: ${(await argStr()) || "parameter null or not set"}`);
		case "?": // error if unset
			if (val !== undefined) return val;
			throw new Error(`${name}: ${(await argStr()) || "parameter not set"}`);
		case "#": // remove shortest prefix
			return removePrefix(val ?? "", await argStr(), false);
		case "##": // remove longest prefix
			return removePrefix(val ?? "", await argStr(), true);
		case "%": // remove shortest suffix
			return removeSuffix(val ?? "", await argStr(), false);
		case "%%": // remove longest suffix
			return removeSuffix(val ?? "", await argStr(), true);
		case "/": // replace first
			return replacePattern(val ?? "", await argStr(), false);
		case "//": // replace all
			return replacePattern(val ?? "", await argStr(), true);
		case "^": // uppercase first char
			return (val ?? "").replace(/^./, (c) => c.toUpperCase());
		case "^^": // uppercase all
			return (val ?? "").toUpperCase();
		case ",": // lowercase first char
			return (val ?? "").replace(/^./, (c) => c.toLowerCase());
		case ",,": // lowercase all
			return (val ?? "").toLowerCase();
		default:
			return val ?? "";
	}
}

function removePrefix(val: string, pattern: string, greedy: boolean): string {
	const regex = globToRegex(pattern);
	if (greedy) {
		// Find longest match from start
		for (let i = val.length; i >= 0; i--) {
			const sub = val.slice(0, i);
			if (regex.test(sub)) return val.slice(i);
		}
	} else {
		// Find shortest match from start
		for (let i = 0; i <= val.length; i++) {
			const sub = val.slice(0, i);
			if (regex.test(sub)) return val.slice(i);
		}
	}
	return val;
}

function removeSuffix(val: string, pattern: string, greedy: boolean): string {
	const regex = globToRegex(pattern);
	if (greedy) {
		for (let i = 0; i <= val.length; i++) {
			const sub = val.slice(i);
			if (regex.test(sub)) return val.slice(0, i);
		}
	} else {
		for (let i = val.length; i >= 0; i--) {
			const sub = val.slice(i);
			if (regex.test(sub)) return val.slice(0, i);
		}
	}
	return val;
}

function replacePattern(val: string, argStr: string, all: boolean): string {
	const slashIdx = argStr.indexOf("/");
	const pattern = slashIdx >= 0 ? argStr.slice(0, slashIdx) : argStr;
	const replacement = slashIdx >= 0 ? argStr.slice(slashIdx + 1) : "";
	const regex = globToRegex(pattern);

	if (all) {
		return val.replace(new RegExp(regex.source, "g"), replacement);
	}
	return val.replace(regex, replacement);
}
