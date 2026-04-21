// Browser playground build: WASM runtime is intentionally disabled so the
// dynamic `import("./pkg/faux_wasm.js")` in src/wasm/index.ts resolves
// to a rejecting module. The TS Shell's `.catch()` gracefully falls back to
// the pure-TypeScript executor.
export default async function init(): Promise<void> {
	throw new Error("faux wasm runtime disabled in browser playground");
}
