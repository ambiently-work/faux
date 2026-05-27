# AGENTS.md

## Cursor Cloud specific instructions

### Runtime

Uses **Bun** (1.3.12 in the multi-repo workspace). See `package.json` scripts for all commands.

### Dependency on mirage

This repo depends on `@ambiently-work/mirage` via a GitHub commit SHA. In the cloud workspace, mirage must be built (`bun run build` in `/agent/repos/mirage`) and symlinked into this repo's `node_modules`:

```
rm -rf node_modules/@ambiently-work/mirage
ln -s /agent/repos/mirage node_modules/@ambiently-work/mirage
```

Install with `bun install --ignore-scripts` to skip the `prepare` script (`tsc -b`) which may fail on type mismatches between faux HEAD and mirage HEAD.

### Tests

`bun test` — 7 mount/umount tests fail on `main` (pre-existing; `UmaskFileSystem` hasn't been updated for newer mirage `IFileSystem` methods). All other 888 tests pass.

### WASM build

`wasm-pack build --target web --out-dir pkg` builds the Rust WASM accelerator. Requires `wasm-pack` and `rustup target add wasm32-unknown-unknown`.

### Linting

`bun run check` (Biome).
