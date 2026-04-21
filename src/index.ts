export {
	HttpFileSystem,
	type HttpFileSystemOptions,
	type IFileSystem,
	LayeredFileSystem,
	type MirageStats,
	ObjectFileSystem,
	ReadOnlyFileSystem,
	useWasmGlob,
	VirtualFileSystem,
} from "@ambiently-work/mirage";
export {
	type ActionFn,
	Command,
	command,
	commandGroup,
	type MiddlewareFn,
	type ParsedArgs,
} from "./commands/builder.js";
export { type BiomeInstance, createBiomeCommand } from "./commands/builtins/biome.js";
export { createNodeCommand, type NodeCommandOptions } from "./commands/builtins/node.js";
export {
	createTreeSitterCommand,
	type TreeSitterCommandOptions,
	type TreeSitterInstance,
	type TreeSitterLanguage,
	type TreeSitterNode,
	type TreeSitterParser,
	type TreeSitterPoint,
	type TreeSitterTree,
} from "./commands/builtins/tree-sitter.js";
export { CommandRegistry } from "./commands/registry.js";
export type { CommandContext, CommandHandler } from "./commands/types.js";
export { Environment } from "./env/environment.js";
export {
	useWasmArithmetic,
	useWasmBraces,
	useWasmGlobToRegex,
} from "./executor/expansion/index.js";
export type {
	AfterHook,
	BeforeHook,
	CommandExecution,
	ErrorHook,
	OutputTransform,
} from "./hooks.js";
export { HookRegistry } from "./hooks.js";
export { WritableBuffer } from "./io/stream.js";
export type { AstNode, Redirect, Word, WordPart } from "./parser/index.js";
export { parse, useWasmParser } from "./parser/index.js";
export { Shell, type ShellOptions } from "./shell.js";
export { CommandTracker, type TrackerStats } from "./tracker.js";
export {
	collapseSpaces,
	compressBlankLines,
	llmOptimized,
	normalizeLineEndings,
	stripAnsi,
	suppressEmptyStderr,
	tabsToSpaces,
	tokenOptimized,
	trimOutput,
	trimTrailingWhitespace,
	truncateChars,
	truncateLines,
} from "./transforms.js";
export type { ShellResult } from "./types.js";
export { ShellBridge } from "./wasm-bridge.js";
export type {
	WasmArithmeticModule,
	WasmBraceModule,
	WasmExecutorModule,
	WasmGlobModule,
	WasmGlobToRegexModule,
	WasmParserModule,
	WasmRuntimeModule,
} from "./wasm-interfaces.js";
export { getWasmExecutor, getWasmParser, useWasmRuntime } from "./wasm-runtime.js";
