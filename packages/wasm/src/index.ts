import type { WasmRuntimeModule } from "faux-shell";

/**
 * Load the WASM runtime for standard environments (browser, Node via bundler).
 *
 * Requires wasm-pack build output in ../pkg/.
 */
export async function loadWasmRuntime(): Promise<WasmRuntimeModule> {
	const wasm = await import("../pkg/faux_shell_wasm.js");
	await wasm.default();
	return {
		globMatch: wasm.glob_match,
		evaluateArithmetic: wasm.evaluate_arithmetic,
		expandBraces: (word: string) => Array.from(wasm.expand_braces(word)) as string[],
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
 * import wasmModule from "@faux-shell/wasm/wasm";
 * const runtime = await loadWasmRuntimeFromModule(wasmModule);
 * ```
 */
export async function loadWasmRuntimeFromModule(
	wasmModule: WebAssembly.Module,
): Promise<WasmRuntimeModule> {
	const wasm = await import("../pkg/faux_shell_wasm.js");
	await wasm.default(wasmModule);
	return {
		globMatch: wasm.glob_match,
		evaluateArithmetic: wasm.evaluate_arithmetic,
		expandBraces: (word: string) => Array.from(wasm.expand_braces(word)) as string[],
		globToRegex: wasm.glob_to_regex,
		parse: wasm.parse,
		execute: wasm.execute,
	};
}
