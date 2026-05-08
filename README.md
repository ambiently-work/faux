# faux

A POSIX-ish shell that runs **entirely in-process** — no `child_process`, no subshell, no OS dependency. Bring your own environment and virtual filesystem, execute real shell syntax against it, and get structured output back.

Designed for sandboxes, agents, browser REPLs, and anywhere you want shell semantics without shelling out.

## Packages

| Package                                                                  | npm                                                                                                                     | What it does                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`@ambiently-work/faux`](./packages/core)                               | [![npm](https://img.shields.io/npm/v/@ambiently-work/faux.svg)](https://www.npmjs.com/package/@ambiently-work/faux)                               | The `Shell`, virtual FS, builtins, env.                  |
| [`@ambiently-work/faux-parser`](./packages/parser)                      | [![npm](https://img.shields.io/npm/v/@ambiently-work/faux-parser.svg)](https://www.npmjs.com/package/@ambiently-work/faux-parser)                 | POSIX shell grammar → AST.                               |
| [`@ambiently-work/faux-wasm`](./packages/wasm)                          | [![npm](https://img.shields.io/npm/v/@ambiently-work/faux-wasm.svg)](https://www.npmjs.com/package/@ambiently-work/faux-wasm)                     | Rust/WASM accelerated runtime (glob, arithmetic, etc.).  |
| [`@ambiently-work/faux-cli`](./packages/cli)                            | [![npm](https://img.shields.io/npm/v/@ambiently-work/faux-cli.svg)](https://www.npmjs.com/package/@ambiently-work/faux-cli)                       | Interactive REPL (requires Bun).                         |

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

### Startup files

A shell can be told it's interactive — and optionally a login shell — so it sources the same rc/profile files as bash:

| Mode | Files sourced (in order, first-found for the home set) |
| --- | --- |
| `interactive: true` (non-login) | `/etc/bash.bashrc`, `~/.bashrc` |
| `interactive: true, login: true` | `/etc/profile`, then one of `~/.bash_profile`, `~/.bash_login`, `~/.profile` |
| Non-interactive (default) | `$BASH_ENV` if set (with `~` expansion) |

```ts
const shell = new Shell({
  user: "luca",
  interactive: true,
  fs: {
    "/home/luca/.bashrc": "alias ll='ls -l'\nexport EDITOR=vim\n",
  },
});
await shell.run("ll");      // alias from .bashrc
```

Files run lazily before the first `run()`, or eagerly via `await shell.init()`. Pass `skipStartupFiles: true` to bypass everything (useful in tests).

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
