# Test Coverage Plan

## Current State

**243 tests** across 3 files, covering 28 commands and core shell features.

## Coverage Summary

### Well-Tested (17 commands)
echo, printf, test/[, grep, sort, uniq, wc, head, tail, cut, tr, sed, basename, dirname, seq, cat, chmod

### Partially Tested (11 commands)
cd, ls, tee, env, paste, find, read, xargs, export/declare, alias, rev/tac

### Zero Coverage (50+ commands)
awk, bc, column, comm, date, df, diff, du, eval, exec, expr, file, fmt, fold, getopts, join, let, ln, mapfile, nl, realpath, rm, set/shopt, shift, sleep, source, stat, strings, trap, tree, type/which/command, ulimit, umask, uname, unexpand, xxd, yes, plus job control (jobs, bg, fg, kill, wait)

---

## Test Batches

### Batch 1: Core File Operations
**Commands:** rm, ln, touch, mkdir
**Tests:**
- rm: basic remove, -r recursive dir, -f force nonexistent, error on missing without -f
- ln: -s symlink creation, -f force overwrite existing
- touch: creates new file, updates existing file timestamp
- mkdir: basic create, -p recursive nested

### Batch 2: Text Processing
**Commands:** awk, diff, comm, join, nl, fold, fmt, column
**Tests:**
- awk: print $1 field, -F custom separator, pattern matching, BEGIN/END blocks
- diff: basic two-file diff, -u unified format
- comm: basic 3-column output, -1/-2/-3 suppress flags
- join: basic join on common field
- nl: line numbering, -b a (number all), -b t (number non-blank)
- fold: -w width wrapping

### Batch 3: Shell Builtins
**Commands:** eval, exec, source, shift, trap, set/shopt
**Tests:**
- eval: evaluates concatenated string as command
- exec: runs command with redirections
- source/.: reads and executes file in current shell
- shift: shifts positional params, shift N, out-of-range error
- trap: set handler, list traps, clear trap
- set: -- sets positional params, -e/-u flags accepted
- shopt: -s enables option, -u disables, -q queries silently

### Batch 4: Info & System Commands
**Commands:** date, uname, hostname, id/whoami, type, which, command
**Tests:**
- date: default output format, +%Y-%m-%d custom format, +%s epoch
- uname: default output, -s kernel name, -a all info
- hostname: returns hostname
- id: shows uid/gid info, whoami returns username
- type: identifies builtins vs keywords vs functions
- which: finds command in PATH
- command -v: prints command path or name

### Batch 5: Advanced Text
**Commands:** expr, bc, base64, xxd, strings, expand/unexpand
**Tests:**
- expr: integer arithmetic (1 + 2), string length, regex match
- bc: basic arithmetic expression
- base64: encode string, decode back to original
- xxd: hex dump output format
- strings: extracts printable sequences from input
- expand: converts tabs to spaces with -t width
- unexpand: converts leading spaces to tabs

### Batch 6: Filesystem Info
**Commands:** stat, file, du, df, realpath, tree
**Tests:**
- stat: displays file info (size, mode, timestamps)
- file: detects text, JSON, directory, empty file types
- du: reports directory sizes
- df: shows filesystem usage
- realpath: resolves relative to absolute path
- tree: displays directory tree structure

### Batch 7: Job Control & Process
**Commands:** sleep, kill, wait, yes, getopts
**Tests:**
- sleep: sleep 0 returns immediately, invalid duration errors, suffix parsing (1s, 1m)
- yes: outputs repeated text (limited in vfs)
- getopts: parses -a -b flags, handles option arguments (-f value)
- kill/wait: basic invocation in virtual shell context

### Batch 8: Edge Cases & Integration
**Features:** here-documents, nested control flow, break/continue, multiple redirects, variable scoping
**Tests:**
- Nested for loops with break/continue
- Multiple redirects on one command (stdout + stderr)
- Variable scoping with local in functions
- Command substitution in various contexts
- Glob expansion with *, ?, [abc]
- Brace expansion {a,b,c}
- Pipeline with multiple stages and error propagation
- Quoted vs unquoted variable expansion edge cases

---

## Progress Tracker

| Batch | Status | Commit | Tests Added |
|-------|--------|--------|-------------|
| 1     | DONE   | d21c600 | 12          |
| 2     | DONE   | 8d287e8 | 11          |
| 3     | DONE   | e8ffb0f | 15          |
| 4     | DONE   | 533dc39 | 12          |
| 5     | DONE   | 5da2288 | 9           |
| 6     | DONE   | 2314f40 | 10          |
| 7     | DONE   | a6f7acd | 10          |
| 8     | DONE   | 7da70b8 | 12          |
