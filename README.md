# faux-shell

A POSIX-ish shell that runs **entirely in-process** — no `child_process`, no subshell, no OS dependency. Bring your own environment and virtual filesystem, execute real shell syntax against it, and get structured output back.

Designed for sandboxes, agents, browser REPLs, and anywhere you want shell semantics without shelling out.

## Packages

| Package                                                                  | npm                                                                                                                     | What it does                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`@ambiently-work/faux-shell`](./packages/core)                               | [![npm](https://img.shields.io/npm/v/@ambiently-work/faux-shell.svg)](https://www.npmjs.com/package/@ambiently-work/faux-shell)                               | The `Shell`, virtual FS, builtins, env.                  |
| [`@ambiently-work/faux-shell-parser`](./packages/parser)                      | [![npm](https://img.shields.io/npm/v/@ambiently-work/faux-shell-parser.svg)](https://www.npmjs.com/package/@ambiently-work/faux-shell-parser)                 | POSIX shell grammar → AST.                               |
| [`@ambiently-work/faux-shell-wasm`](./packages/wasm)                          | [![npm](https://img.shields.io/npm/v/@ambiently-work/faux-shell-wasm.svg)](https://www.npmjs.com/package/@ambiently-work/faux-shell-wasm)                     | Rust/WASM accelerated runtime (glob, arithmetic, etc.).  |
| [`@ambiently-work/faux-shell-cli`](./packages/cli)                            | [![npm](https://img.shields.io/npm/v/@ambiently-work/faux-shell-cli.svg)](https://www.npmjs.com/package/@ambiently-work/faux-shell-cli)                       | Interactive REPL (requires Bun).                         |

## Quick start

```ts
import { Shell } from "@ambiently-work/faux-shell";

const shell = new Shell({
  user: "luca",
  fs: { "/home/luca/hello.txt": "hello world\n" },
});

const result = await shell.run("cat /home/luca/hello.txt | wc -w");
console.log(result.stdout); // "2\n"
```

## Development

This is a Bun workspaces monorepo.

```bash
bun install                # install all deps
bun run test               # run every package's test suite
bun run build              # tsc -b across publishable packages
bun run shell              # interactive REPL
bun run docs               # start the docs site
```

### Publishing

Releases are managed by [release-please](https://github.com/googleapis/release-please). Merging a release PR cuts tags and GitHub Releases; a publish workflow then runs `bun run build` and `npm publish` for each released package using npm's [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — no long-lived tokens.

## License

MIT © ambiently
