declare module "@faux-shell/wasm" {
	import type { WasmRuntimeModule } from "./wasm-interfaces.js";
	export function loadWasmRuntime(): Promise<WasmRuntimeModule>;
	export function loadWasmRuntimeFromModule(
		wasmModule: WebAssembly.Module,
	): Promise<WasmRuntimeModule>;
}
