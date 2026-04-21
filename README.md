# faux

[![npm](https://img.shields.io/npm/v/@ambiently-work/faux.svg)](https://www.npmjs.com/package/@ambiently-work/faux)

A POSIX-ish shell that runs **entirely in-process** — no `child_process`, no subshell, no OS dependency. Bring your own environment and virtual filesystem, execute real shell syntax against it, and get structured output back.

Designed for sandboxes, agents, browser REPLs, and anywhere you want shell semantics without shelling out.

Ships as a single package, `@ambiently-work/faux`, which bundles the shell runtime, virtual filesystem, builtins, POSIX parser, and an optional Rust/WASM accelerated runtime (glob, arithmetic, brace expansion, parser). Published to both [npmjs](https://www.npmjs.com/package/@ambiently-work/faux) and [GitHub Packages](https://github.com/ambiently-work/faux/pkgs/npm/faux).

## Install

```bash
bun add @ambiently-work/faux
# or: npm install @ambiently-work/faux
```

## Quick start

```ts
import { Shell } from "@ambiently-work/faux";

const shell = new Shell({
  user: "luca",
  fs: { "/home/luca/hello.txt": "hello world\n" },
});

const result = await shell.run("cat /home/luca/hello.txt | wc -w");
console.log(result.stdout); // "2\n"
```

To enable the Rust/WASM accelerated glob, arithmetic, brace expansion, and parser, load the runtime from the `/wasm` subpath and wire it in:

```ts
import { useWasmRuntime } from "@ambiently-work/faux";
import { loadWasmRuntime } from "@ambiently-work/faux/wasm";

useWasmRuntime(await loadWasmRuntime());
```

On Cloudflare Workers, import the `.wasm` binary directly via the `/wasm-binary` subpath and use `loadWasmRuntimeFromModule` instead:

```ts
import { useWasmRuntime } from "@ambiently-work/faux";
import { loadWasmRuntimeFromModule } from "@ambiently-work/faux/wasm";
import wasmModule from "@ambiently-work/faux/wasm-binary";

useWasmRuntime(await loadWasmRuntimeFromModule(wasmModule));
```

## Development

```bash
bun install                # install deps
bun run build              # build WASM crate + TypeScript
bun run test               # run the test suite
bun run shell              # interactive REPL
bun run docs               # start the docs site
```

The repo also contains a `packages/docs` Astro site (private workspace) and a Rust crate under `rust/` that compiles to the WASM module shipped in `pkg/`.

### Publishing

Releases are managed by [release-please](https://github.com/googleapis/release-please). Merging a release PR cuts tags and GitHub Releases; the publish workflow then builds the WASM crate, compiles TypeScript, and publishes to npmjs (via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) / OIDC — no long-lived tokens) and to GitHub Packages.

## License

MIT © ambiently
