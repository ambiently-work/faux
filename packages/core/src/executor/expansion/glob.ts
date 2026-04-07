import type { IFileSystem } from "../../vfs/types.js";
import type { WasmGlobToRegexModule } from "../../wasm-interfaces.js";

let wasmGlobToRegex: ((pattern: string) => string) | null = null;

export function useWasmGlobToRegex(module: WasmGlobToRegexModule): void {
	wasmGlobToRegex = (pattern) => module.globToRegex(pattern);
}

export function globToRegex(pattern: string): RegExp {
	if (wasmGlobToRegex) {
		try {
			return new RegExp(wasmGlobToRegex(pattern));
		} catch {
			// fall through to TS implementation
		}
	}
	let regex = "^";
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		switch (c) {
			case "*":
				regex += ".*";
				break;
			case "?":
				regex += ".";
				break;
			case "[": {
				let j = i + 1;
				let cls = "[";
				if (j < pattern.length && pattern[j] === "!") {
					cls += "^";
					j++;
				}
				while (j < pattern.length && pattern[j] !== "]") {
					cls += pattern[j];
					j++;
				}
				cls += "]";
				regex += cls;
				i = j;
				break;
			}
			case "\\":
				if (i + 1 < pattern.length) {
					regex += `\\${pattern[i + 1]}`;
					i++;
				}
				break;
			default:
				regex += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				break;
		}
	}
	regex += "$";
	try {
		return new RegExp(regex);
	} catch {
		return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
	}
}

export function expandGlob(pattern: string, fs: IFileSystem, cwd: string): string[] {
	// Only run glob expansion if the pattern contains glob characters
	if (!/[*?[\]{}]/.test(pattern)) {
		return [pattern];
	}
	try {
		const matches = fs.glob(pattern, { cwd });
		return matches.length > 0 ? matches : [pattern];
	} catch {
		return [pattern];
	}
}
