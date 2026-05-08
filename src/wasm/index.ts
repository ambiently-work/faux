import type { WasmRuntimeModule } from "../wasm-interfaces.js";

interface FauxWasm {
	default: (input?: WebAssembly.Module | unknown) => Promise<unknown>;
	glob_match: (pattern: string, path: string) => boolean;
	evaluate_arithmetic: (expr: string) => number;
	expand_braces: (word: string) => Iterable<string>;
	glob_to_regex: (pattern: string) => string;
	parse: (input: string) => unknown;
	execute: (ast: unknown, bridge: unknown, stdin: string) => Promise<unknown>;
}

// Indirect path keeps tsc from resolving the wasm-pack output at type-check time.
// pkg/ is only present after `bun run build:wasm`; this lets consumers compile
// without the Rust toolchain installed.
const WASM_MODULE_PATH = "../../pkg/faux_wasm.js";

async function loadFauxWasm(): Promise<FauxWasm> {
	return (await import(/* @vite-ignore */ WASM_MODULE_PATH)) as FauxWasm;
}

/**
 * Load the WASM runtime for standard environments (browser, Node via bundler).
 */
export async function loadWasmRuntime(): Promise<WasmRuntimeModule> {
	const wasm = await loadFauxWasm();
	await wasm.default();
	return {
		globMatch: wasm.glob_match,
		evaluateArithmetic: wasm.evaluate_arithmetic,
		expandBraces: (word: string) => Array.from(wasm.expand_braces(word)),
		globToRegex: wasm.glob_to_regex,
		parse: wasm.parse,
		execute: wasm.execute,
	};
}

/**
 * Load the WASM runtime from a pre-compiled WebAssembly.Module.
 *
 * Use this on Cloudflare Workers where the bundler imports .wasm files directly:
 *
 * ```ts
 * import wasmModule from "@ambiently-work/faux/wasm-binary";
 * const runtime = await loadWasmRuntimeFromModule(wasmModule);
 * ```
 */
export async function loadWasmRuntimeFromModule(
	wasmModule: WebAssembly.Module,
): Promise<WasmRuntimeModule> {
	const wasm = await loadFauxWasm();
	await wasm.default(wasmModule);
	return {
		globMatch: wasm.glob_match,
		evaluateArithmetic: wasm.evaluate_arithmetic,
		expandBraces: (word: string) => Array.from(wasm.expand_braces(word)),
		globToRegex: wasm.glob_to_regex,
		parse: wasm.parse,
		execute: wasm.execute,
	};
}
