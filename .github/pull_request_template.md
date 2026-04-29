<!--
Thank you for opening a PR!

Title format: <type>(<optional scope>): <subject in lowercase>
Examples:
  feat(shell): add `set -e` semantics
  fix(parser): handle nested $((...)) without closing brace
  chore(deps): bump biome to 2.5.0
-->

## Summary

<!-- What does this PR do, and why? Keep it crisp. -->

## Changes

<!-- Bullet list of the meaningful changes. -->

## Test plan

- [ ] `bun run check` passes
- [ ] `bunx tsc -b --force` passes
- [ ] `bun test` passes
- [ ] `cargo fmt --all -- --check` passes (if Rust changed)
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes (if Rust changed)
- [ ] Tested manually: <!-- describe -->

## Screenshots / output

<!-- Optional. Drop in CLI output, screenshots, or before/after comparisons. -->

## Risk & rollback

<!-- Anything risky? How would we revert if this needs to roll back? -->

## Checklist

- [ ] PR title follows Conventional Commits
- [ ] Linked issues / context provided
- [ ] Docs updated if user-facing behavior changed
- [ ] Added/updated tests for new behavior
- [ ] No new dependencies, OR new deps justified in the description
