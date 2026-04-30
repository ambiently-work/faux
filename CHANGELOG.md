# Changelog

## [1.0.0](https://github.com/ambiently-work/faux/compare/faux-v0.0.1...faux-v1.0.0) (2026-04-30)


### ⚠ BREAKING CHANGES

* migrate to @ambiently-work/mirage, drop sibling-clone CI hack ([#46](https://github.com/ambiently-work/faux/issues/46))
* rename package to @ambiently-work/faux-shell for dual-publish
* collapse monorepo into single @ambiently/faux-shell package

### Features

* add agent-ready tool layer (Tool, Shell/Read/Write/Edit/Glob/Grep/Ls/LSP) ([#39](https://github.com/ambiently-work/faux/issues/39)) ([a479850](https://github.com/ambiently-work/faux/commit/a479850882318157ab69064484c6e09efe4bd56a))
* add node command backed by QuickJS ([#38](https://github.com/ambiently-work/faux/issues/38)) ([a57cf61](https://github.com/ambiently-work/faux/commit/a57cf6139a6cd4e3f13b1733348ee985ec7e7e4b))
* add Rust WASM parser and executor entry points ([e3c0194](https://github.com/ambiently-work/faux/commit/e3c019447f55a74f4abdc68df7055bb8ad4b834b))
* add ShellBridge for WASM executor and wasm-demo script ([28ad955](https://github.com/ambiently-work/faux/commit/28ad955585ad6c9d0119f9f7d47467e7acb81a15))
* add tree-sitter syntax command ([#37](https://github.com/ambiently-work/faux/issues/37)) ([75f44c1](https://github.com/ambiently-work/faux/commit/75f44c199abc907a254629c2b5868e6e16e7109c))
* add WASM parser and executor interfaces ([64b24ad](https://github.com/ambiently-work/faux/commit/64b24addb74cded326c1f895aae90bfe365260bf))
* **docs:** add in-browser terminal playground and GitHub Pages deploy ([f31a7c7](https://github.com/ambiently-work/faux/commit/f31a7c7edb03c7eeda23f814389bebcae9eb4107))
* **docs:** add in-browser terminal playground and GitHub Pages deploy ([9878924](https://github.com/ambiently-work/faux/commit/9878924a5f10ae9989807c5ffdfdb142fb752af1))
* implement -nt, -ot, -ef file comparison operators in test ([e0d6395](https://github.com/ambiently-work/faux/commit/e0d6395fb64d6a7de9ef3ce9f912b37c392d8936))
* implement arithmetic assignment operators and pre/post increment ([aab6f9e](https://github.com/ambiently-work/faux/commit/aab6f9e7d07f0256ec643027c143acb24464c668))
* implement fd-to-fd redirects (&gt;&) for 2&gt;&1 and &gt;&2 ([aff53ea](https://github.com/ambiently-work/faux/commit/aff53ea9e7171c003280343b216a92beed113779))
* implement Rust WASM parser, executor, and expansion modules ([b9bf4ca](https://github.com/ambiently-work/faux/commit/b9bf4ca0af0d382f2484124c33187373f3227a8c))
* implement shell-level break and continue ([e09b8cf](https://github.com/ambiently-work/faux/commit/e09b8cf09153d4ca493e466153643a1dad7cc3bc))
* implement shell-level break and continue ([68401a6](https://github.com/ambiently-work/faux/commit/68401a6383492a3dff6b3f3ca9725675d6636073))
* initial commit with modular architecture and command builder ([0f72ad4](https://github.com/ambiently-work/faux/commit/0f72ad428b618fd538b381e94298018aeccaed94))
* support * width and precision specifiers in printf ([47c826a](https://github.com/ambiently-work/faux/commit/47c826a93f0b2e3fd9d1602987ca9ba46024f681))
* support ~+ and ~- tilde expansion for PWD and OLDPWD ([0f621d7](https://github.com/ambiently-work/faux/commit/0f621d7465bdb2e68150ab216cc08237b713fcf3))
* wire WASM parser and executor into Shell class ([16f2289](https://github.com/ambiently-work/faux/commit/16f2289823b2023b49dd6e34d77c67cd4d4b21ee))


### Bug Fixes

* accumulate stdout/stderr from both sides of list operators ([ac92096](https://github.com/ambiently-work/faux/commit/ac920967db8f1232624046dc7895c2ea2849ae92))
* align sort -u deduplication key with sort comparator ([62289d9](https://github.com/ambiently-work/faux/commit/62289d912dbad35b85ed45229cbd2159e0276036))
* cat continues processing files after read error ([9ca82a9](https://github.com/ambiently-work/faux/commit/9ca82a97ae947b7b30e37b824a527f2ba15afd5f))
* cat preserves missing trailing newline from input ([8294a6e](https://github.com/ambiently-work/faux/commit/8294a6ee4f1aa0b4e58d5f449e230de22e869f52))
* chmod X permission now sets execute on directories ([0747603](https://github.com/ambiently-work/faux/commit/07476038d1cbe641277da18c0ab58e39a1fb8c4a))
* **ci:** escape backslashes in labeler jq filter ([#74](https://github.com/ambiently-work/faux/issues/74)) ([0ca11b5](https://github.com/ambiently-work/faux/commit/0ca11b56eb60699c30bfe41b9dff3978a717a80e))
* clear stderr after 2&gt; and &&gt; redirects ([87f782c](https://github.com/ambiently-work/faux/commit/87f782c342d36451b31096270973c1d87ce3d0fd))
* **cli:** stop hardcoding version in startup banner ([1aae755](https://github.com/ambiently-work/faux/commit/1aae75516727b866678f0301cba9b31a0fe18424))
* continue processing remaining files on error in tee, head, tail ([b60fbd8](https://github.com/ambiently-work/faux/commit/b60fbd8c3202ef13f4fa35dfa54b042bc52bdad0))
* continue processing remaining files on read error in wc, cut, sort ([7742420](https://github.com/ambiently-work/faux/commit/77424201d0dda4d45a9b8338f402af79fa023b11))
* correct base64 padding calculation for partial triplets ([0d7a7f2](https://github.com/ambiently-work/faux/commit/0d7a7f250dacbf6d26608d9da1a49cfc56a339db))
* correct mapfile array storage and trailing newline handling ([2193f1c](https://github.com/ambiently-work/faux/commit/2193f1c6b56d329ac019c71692d3240562b22940))
* correct printf zero-padding for signed and prefixed numbers ([2efc292](https://github.com/ambiently-work/faux/commit/2efc2922a7fa35d46618bbdec09a9caaf29199d1))
* correct stat mode octal formatting from 5 digits to 4 ([da7d23d](https://github.com/ambiently-work/faux/commit/da7d23d88d9d07ba6bea95b0ce0f02c0157cef0a))
* correct trap -l signal numbering and exclude pseudo-signals ([81dc236](https://github.com/ambiently-work/faux/commit/81dc236353cb6cc1cd2da2cad92f54f459014037))
* cycle through delimiter list in paste serial mode ([77ea7a2](https://github.com/ambiently-work/faux/commit/77ea7a2c2272daf219bae1b026a668c170370795))
* differentiate [:graph:] from [:print:] in tr character classes ([eec4e99](https://github.com/ambiently-work/faux/commit/eec4e998105e83eb9514dec65ef755e015a539df))
* enforce readonly check in Environment.export() with value ([7195cb5](https://github.com/ambiently-work/faux/commit/7195cb5e1dc0a7eaa03defda735061ec373ce104))
* env -u must not modify parent shell environment ([c190179](https://github.com/ambiently-work/faux/commit/c190179a5a40e3f476354e35ad0bdb2e6abd22dd))
* exec handles &gt;&gt;file redirect without space correctly ([06aca5c](https://github.com/ambiently-work/faux/commit/06aca5c5fea917a9b2db709f63c78ec572e9f191))
* **executor:** apply 2&gt;&1 after stdout redirect so combined output reaches the file ([#41](https://github.com/ambiently-work/faux/issues/41)) ([#75](https://github.com/ambiently-work/faux/issues/75)) ([82269d6](https://github.com/ambiently-work/faux/commit/82269d63f67b37e3c16dfd2c535ad6d192b2ee05))
* **executor:** exec persists fd redirects and replaces shell on exec CMD ([#29](https://github.com/ambiently-work/faux/issues/29)) ([#76](https://github.com/ambiently-work/faux/issues/76)) ([142cea8](https://github.com/ambiently-work/faux/commit/142cea869cec9ea6eb71a225e9ef1474a33f45fb))
* exit and return builtins use correct error classes ([1a440de](https://github.com/ambiently-work/faux/commit/1a440de5bd825a9553b0a83b4fc229a617f3be95))
* fork() copies all variables, not just exported ones ([cd2cf22](https://github.com/ambiently-work/faux/commit/cd2cf222e33d1704907c35e461034ab8f0cc5e12))
* handle unclosed brackets in glob patterns and add [...] to case matching ([55e45c1](https://github.com/ambiently-work/faux/commit/55e45c12b1ebbb3a780ab39cf39e84c695923743))
* implement glob pattern matching in ObjectFileSystem and fix unalias early return ([5beaee5](https://github.com/ambiently-work/faux/commit/5beaee5ddd1d199d7b5a14781c578f4435bccc57))
* implement missing date format specifiers %y, %C, %D ([2d33b29](https://github.com/ambiently-work/faux/commit/2d33b2968dbbd628c3f7b2e5cdbb7bf976a292fa))
* implement recursive directory copy in LayeredFileSystem ([ea0b933](https://github.com/ambiently-work/faux/commit/ea0b93338e660649c7559ec5418a16b980f87a3d))
* implement SECONDS variable and resolve special vars in parameter ops ([c7d56c0](https://github.com/ambiently-work/faux/commit/c7d56c0c9045482ac13c6092b3d652999bdc8d13))
* ls -l shows year instead of time for files older than 6 months ([7421ab4](https://github.com/ambiently-work/faux/commit/7421ab485845590ac91dc34857dd3128500bc5af))
* only randomize trailing X's in mktemp template ([b60a6ed](https://github.com/ambiently-work/faux/commit/b60a6edb7f596740a4d2e46d505a314fab7e87a1))
* preserve condition output in if/while/until statements ([e298ceb](https://github.com/ambiently-work/faux/commit/e298ceb2be23df9c84f8fa76261eac5d84e33659))
* preserve trailing newline status in tail and sed output ([a20feff](https://github.com/ambiently-work/faux/commit/a20feff163142c5a7144b0f1e921430f8974dfd8))
* resolve destination path inside directory for cp and mv ([d523f25](https://github.com/ambiently-work/faux/commit/d523f25fa20af0dc25631ade2a28930b4d163051))
* resolve special variables in ${#var} length expansion ([2036c37](https://github.com/ambiently-work/faux/commit/2036c377757707e561fbf7e4853b17e3cd8220e3))
* respect grep -H flag with single file ([63589df](https://github.com/ambiently-work/faux/commit/63589df5a3b3054e20b0d411d28e6908afa95bc2))
* respect IFS variable in read builtin word splitting ([9700450](https://github.com/ambiently-work/faux/commit/970045044d9db6e48507c4fa8c9c071b6e94c2de))
* restore temporary prefix vars after alias expansion ([03d916f](https://github.com/ambiently-work/faux/commit/03d916f407c64e8d371891fcfbad5481a6165f65))
* seq -w zero-padding for negative numbers ([e7069e4](https://github.com/ambiently-work/faux/commit/e7069e4085e923699cadb91ba58bdcda6d66d344))
* shell-quote xargs arguments to prevent splitting on special chars ([2474c2a](https://github.com/ambiently-work/faux/commit/2474c2a7faea029b482e8debd5b59a028819a01d))
* stop parsing echo flags after first positional argument ([e1eeaef](https://github.com/ambiently-work/faux/commit/e1eeaef79953f97ccd716f0182519cc43411b040))
* support -o within combined set flags (e.g. set -eo pipefail) ([4b96e63](https://github.com/ambiently-work/faux/commit/4b96e630f3c878b371e2081631c44b599dbc1208))
* tokenize 3-char compound assignment operators in let ([688e1ea](https://github.com/ambiently-work/faux/commit/688e1ead3bc606d45f1eb4318b78d17915978cfc))
* use lstat for symlink detection in test and find ([20e5267](https://github.com/ambiently-work/faux/commit/20e5267a68ae8b90711fbadd71f0702f50993bcf))
* wc -l counts newline characters, not text lines ([da62f35](https://github.com/ambiently-work/faux/commit/da62f356f07d42f11da1a6e99d2445ec81e23843))
* wire Signal enum — surface break/continue/exit/return through WASM bridge ([#40](https://github.com/ambiently-work/faux/issues/40)) ([e74896a](https://github.com/ambiently-work/faux/commit/e74896a34a4c0dcd335a37e824e4732a6c40ad12))


### Performance Improvements

* cache awk field separator regex across record splits ([3c931e9](https://github.com/ambiently-work/faux/commit/3c931e9fe1d898f3b4eceb25858652454656f407))
* cache ExecutorContext instead of recreating per command ([82a38e3](https://github.com/ambiently-work/faux/commit/82a38e3179a663035ea2c325f540b31528b3159f))
* fast-path single-part words in expandWord ([9e63b53](https://github.com/ambiently-work/faux/commit/9e63b5374d7abf1f63b56df82a5f60b3bce2ec0e))
* hoist field separator out of sort getKey closure ([966362f](https://github.com/ambiently-work/faux/commit/966362f7323f13f1e85133fcaec7aa7f842ce783))
* O(1) directory checks and faster readDir in ObjectFileSystem ([45b82e1](https://github.com/ambiently-work/faux/commit/45b82e1052a252be9764dc2b2626864bcd141a2d))
* replace dynamic imports with static imports for parser ([b9dcfd7](https://github.com/ambiently-work/faux/commit/b9dcfd7df22970c1336f871d66737486fb1dd25d))
* replace per-char regex with char comparisons in arithmetic tokenizer ([6aa55f1](https://github.com/ambiently-work/faux/commit/6aa55f1d9d3575830290041ccb5a0bd6167e0f13))
* replace per-character regex with Set lookup in globToRegex ([7ca442f](https://github.com/ambiently-work/faux/commit/7ca442f7ef4b588d760aba4a2f8f0bf30be474c6))
* return internal map from Environment.all() instead of copying ([c2b68ba](https://github.com/ambiently-work/faux/commit/c2b68ba1e324d261aaa98effb2fca4040c5223ca))
* use array-join instead of string concat in loop output ([8d0fa40](https://github.com/ambiently-work/faux/commit/8d0fa40795d58dfca59445463a5af88ea21a090c))
* use Map lookups instead of linear scan for flag parsing ([638d60e](https://github.com/ambiently-work/faux/commit/638d60e00d47dff328ed7c278aa46442942d9506))
* use static Set for operator lookups in arithmetic/let tokenizers ([d198b89](https://github.com/ambiently-work/faux/commit/d198b8939a585489f716142683e9e7d7c0fe96e4))


### Documentation

* add test coverage plan with 8 prioritized batches ([a3e5c59](https://github.com/ambiently-work/faux/commit/a3e5c597e3a188274ee64f2e98fc019a45c00541))
* mark all 8 test batches as complete ([6fa902d](https://github.com/ambiently-work/faux/commit/6fa902d1230df0d994532fdbc5623a41a7691c10))


### Code Refactoring

* collapse monorepo into single @ambiently/faux-shell package ([808c1ca](https://github.com/ambiently-work/faux/commit/808c1caea9e6a1d725722052691f5767422d678a))
* extract VFS into @ambiently-work/vfs (mirage) ([905de1b](https://github.com/ambiently-work/faux/commit/905de1bca5a20f185d1ee2f52c4a9ef29be497c7))
* migrate to @ambiently-work/mirage, drop sibling-clone CI hack ([#46](https://github.com/ambiently-work/faux/issues/46)) ([c1a9209](https://github.com/ambiently-work/faux/commit/c1a9209923c0af6e53fa68d14db9346f6871e238))
* rename package to @ambiently-work/faux-shell for dual-publish ([d8147c8](https://github.com/ambiently-work/faux/commit/d8147c8fada9f6824d86b5047da364fa9b519134))
