import {
	useWasmArithmetic,
	useWasmBraces,
	useWasmGlobToRegex,
} from "./executor/expansion/index.js";
import { useWasmGlob } from "./vfs/glob.js";
import type {
	WasmArithmeticModule,
	WasmBraceModule,
	WasmGlobModule,
	WasmGlobToRegexModule,
	WasmRuntimeModule,
} from "./wasm-interfaces.js";

/**
 * Wire up all WASM-accelerated subsystems at once.
 * Accepts a partial module — only provided methods will be overridden.
 */
export function useWasmRuntime(module: Partial<WasmRuntimeModule>): void {
	if (module.globMatch) useWasmGlob(module as WasmGlobModule);
	if (module.evaluateArithmetic) useWasmArithmetic(module as WasmArithmeticModule);
	if (module.expandBraces) useWasmBraces(module as WasmBraceModule);
	if (module.globToRegex) useWasmGlobToRegex(module as WasmGlobToRegexModule);
}

/**
 * Extract the WASM parser function if available.
 */
export function getWasmParser(
	module: Partial<WasmRuntimeModule>,
): ((input: string) => unknown) | null {
	return module.parse ?? null;
}

/**
 * Extract the WASM executor function if available.
 */
export function getWasmExecutor(
	module: Partial<WasmRuntimeModule>,
): ((ast: unknown, bridge: unknown, stdin: string) => Promise<unknown>) | null {
	return module.execute ?? null;
}
