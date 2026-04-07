/** WASM-accelerable glob matching. */
export interface WasmGlobModule {
	globMatch(pattern: string, path: string): boolean;
}

/** WASM-accelerable arithmetic evaluation. Receives pre-resolved expression (no env access). */
export interface WasmArithmeticModule {
	evaluateArithmetic(expr: string): number;
}

/** WASM-accelerable brace expansion. */
export interface WasmBraceModule {
	expandBraces(word: string): string[];
}

/** WASM-accelerable glob-to-regex conversion. Returns regex source string. */
export interface WasmGlobToRegexModule {
	globToRegex(pattern: string): string;
}

/** Combined interface for a full WASM runtime module. */
export interface WasmRuntimeModule
	extends WasmGlobModule,
		WasmArithmeticModule,
		WasmBraceModule,
		WasmGlobToRegexModule {}
