import type { WasmBraceModule } from "../../wasm-interfaces.js";

let wasmExpandBraces: ((word: string) => string[]) | null = null;

export function useWasmBraces(module: WasmBraceModule): void {
	wasmExpandBraces = (word) => module.expandBraces(word);
}

export function expandBraces(word: string): string[] {
	if (wasmExpandBraces) return wasmExpandBraces(word);
	const result: string[] = [];
	const braceStart = word.indexOf("{");
	if (braceStart === -1) return [word];

	let depth = 0;
	let braceEnd = -1;
	for (let i = braceStart; i < word.length; i++) {
		if (word[i] === "{") depth++;
		else if (word[i] === "}") {
			depth--;
			if (depth === 0) {
				braceEnd = i;
				break;
			}
		}
	}

	if (braceEnd === -1) return [word];

	const prefix = word.slice(0, braceStart);
	const suffix = word.slice(braceEnd + 1);
	const inner = word.slice(braceStart + 1, braceEnd);

	// Check for sequence: {1..10} or {a..z}
	const seqMatch = inner.match(/^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/);
	if (seqMatch) {
		const start = Number.parseInt(seqMatch[1], 10);
		const end = Number.parseInt(seqMatch[2], 10);
		const step = seqMatch[3] ? Number.parseInt(seqMatch[3], 10) : start <= end ? 1 : -1;
		if (step !== 0) {
			for (let i = start; start <= end ? i <= end : i >= end; i += step) {
				for (const s of expandBraces(prefix + i + suffix)) {
					result.push(s);
				}
			}
		}
		return result.length > 0 ? result : [word];
	}

	const charSeqMatch = inner.match(/^([a-zA-Z])\.\.([a-zA-Z])$/);
	if (charSeqMatch) {
		const start = charSeqMatch[1].charCodeAt(0);
		const end = charSeqMatch[2].charCodeAt(0);
		const step = start <= end ? 1 : -1;
		for (let i = start; start <= end ? i <= end : i >= end; i += step) {
			for (const s of expandBraces(prefix + String.fromCharCode(i) + suffix)) {
				result.push(s);
			}
		}
		return result;
	}

	// Comma-separated alternatives
	const alternatives = splitBraceAlternatives(inner);
	for (const alt of alternatives) {
		for (const s of expandBraces(prefix + alt + suffix)) {
			result.push(s);
		}
	}

	return result;
}

function splitBraceAlternatives(s: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";

	for (let i = 0; i < s.length; i++) {
		if (s[i] === "{") depth++;
		else if (s[i] === "}") depth--;
		else if (s[i] === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += s[i];
	}
	parts.push(current);
	return parts;
}
