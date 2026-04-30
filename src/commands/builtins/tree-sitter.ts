import { commandGroup } from "../builder.js";
import type { CommandContext, CommandHandler } from "../types.js";

/**
 * Minimal interfaces matching the subset of `web-tree-sitter` used by this
 * command. Designed so any tree-sitter distribution (web, node, bundler) can
 * be adapted with a thin wrapper if its shape diverges.
 */

export interface TreeSitterPoint {
	row: number;
	column: number;
}

export interface TreeSitterNode {
	type: string;
	isError: boolean;
	isMissing: boolean;
	hasError: boolean;
	startPosition: TreeSitterPoint;
	endPosition: TreeSitterPoint;
	startIndex: number;
	endIndex: number;
	children: TreeSitterNode[];
	text?: string;
}

export interface TreeSitterTree {
	rootNode: TreeSitterNode;
}

// Opaque handle — caller's loaded grammar object.
export type TreeSitterLanguage = object;

export interface TreeSitterParser {
	setLanguage(lang: TreeSitterLanguage): void;
	parse(source: string): TreeSitterTree;
}

export interface TreeSitterInstance {
	/** Create a fresh parser. Called once per `tree-sitter` invocation. */
	createParser(): TreeSitterParser;
	/**
	 * Resolve a grammar by language name (e.g. "python", "rust").
	 * Return `null` if the language is not available.
	 * May be async — grammars are typically separate WASM files loaded on demand.
	 */
	getLanguage(name: string): TreeSitterLanguage | null | Promise<TreeSitterLanguage | null>;
}

export interface TreeSitterCommandOptions {
	/**
	 * Map of file extension (with leading dot, lowercase) to language name.
	 * Merged on top of the default map; pass `null` as a value to disable a
	 * default mapping.
	 */
	extensions?: Record<string, string | null>;
}

const DEFAULT_EXTENSIONS: Record<string, string> = {
	".bash": "bash",
	".c": "c",
	".cc": "cpp",
	".cjs": "javascript",
	".cpp": "cpp",
	".cs": "c_sharp",
	".css": "css",
	".cts": "typescript",
	".cxx": "cpp",
	".dart": "dart",
	".elm": "elm",
	".erl": "erlang",
	".ex": "elixir",
	".exs": "elixir",
	".go": "go",
	".h": "c",
	".hh": "cpp",
	".hpp": "cpp",
	".hs": "haskell",
	".html": "html",
	".htm": "html",
	".java": "java",
	".jl": "julia",
	".js": "javascript",
	".json": "json",
	".jsonc": "json",
	".jsx": "javascript",
	".kt": "kotlin",
	".lua": "lua",
	".md": "markdown",
	".mjs": "javascript",
	".ml": "ocaml",
	".mts": "typescript",
	".nix": "nix",
	".php": "php",
	".py": "python",
	".pyi": "python",
	".r": "r",
	".rb": "ruby",
	".rs": "rust",
	".scala": "scala",
	".scss": "scss",
	".sh": "bash",
	".sql": "sql",
	".svelte": "svelte",
	".swift": "swift",
	".toml": "toml",
	".ts": "typescript",
	".tsx": "tsx",
	".vue": "vue",
	".xml": "xml",
	".yaml": "yaml",
	".yml": "yaml",
	".zig": "zig",
};

function getExtension(filePath: string): string {
	const slash = filePath.lastIndexOf("/");
	const base = slash === -1 ? filePath : filePath.slice(slash + 1);
	const dot = base.lastIndexOf(".");
	return dot === -1 ? "" : base.slice(dot).toLowerCase();
}

function collectFiles(ctx: CommandContext, dir: string, out: string[]): void {
	for (const entry of ctx.fs.readDir(dir)) {
		const full = dir === "/" ? `/${entry}` : `${dir}/${entry}`;
		const stat = ctx.fs.stat(full);
		if (stat.isDirectory()) collectFiles(ctx, full, out);
		else if (stat.isFile()) out.push(full);
	}
}

function resolveFiles(ctx: CommandContext, paths: string[], extMap: Map<string, string>): string[] {
	const files: string[] = [];
	for (const p of paths) {
		const resolved = ctx.resolve(p);
		if (!ctx.fs.exists(resolved)) {
			ctx.stderr.write(`tree-sitter: ${p}: No such file or directory\n`);
			continue;
		}
		const stat = ctx.fs.stat(resolved);
		if (stat.isDirectory()) {
			const collected: string[] = [];
			collectFiles(ctx, resolved, collected);
			for (const f of collected) {
				if (extMap.has(getExtension(f))) files.push(f);
			}
		} else if (stat.isFile()) {
			files.push(resolved);
		}
	}
	return files;
}

function* iterErrors(node: TreeSitterNode): Generator<TreeSitterNode> {
	if (!node.hasError && !node.isError && !node.isMissing) return;
	if (node.isError || node.isMissing) {
		yield node;
		return;
	}
	for (const child of node.children) yield* iterErrors(child);
}

function sExpr(node: TreeSitterNode, depth: number): string {
	const pad = "  ".repeat(depth);
	const range = `[${node.startPosition.row}, ${node.startPosition.column}] - [${node.endPosition.row}, ${node.endPosition.column}]`;
	const marker = node.isMissing ? " MISSING" : node.isError ? " ERROR" : "";
	const name = node.type || "_";
	if (node.children.length === 0) {
		return `${pad}(${name}${marker} ${range})`;
	}
	const head = `${pad}(${name}${marker} ${range}`;
	const kids = node.children.map((c) => sExpr(c, depth + 1)).join("\n");
	return `${head}\n${kids})`;
}

function buildExtMap(overrides: Record<string, string | null> | undefined): Map<string, string> {
	const map = new Map<string, string>(Object.entries(DEFAULT_EXTENSIONS));
	if (!overrides) return map;
	for (const [ext, lang] of Object.entries(overrides)) {
		const key = ext.toLowerCase();
		if (lang === null) map.delete(key);
		else map.set(key, lang);
	}
	return map;
}

/**
 * Creates a `tree-sitter` shell command backed by the given tree-sitter
 * instance.
 *
 * The caller is responsible for:
 *   1. Loading the tree-sitter runtime WASM (e.g. `await Parser.init()`).
 *   2. Loading grammars on demand in `getLanguage(name)`.
 *
 * Designed for browser/worker environments — no host filesystem or
 * `child_process` access is used.
 *
 * Example:
 * ```ts
 * import { Parser, Language } from "web-tree-sitter";
 * await Parser.init();
 *
 * const grammars = new Map<string, Language>();
 * const treeSitter = createTreeSitterCommand({
 *   createParser: () => new Parser(),
 *   async getLanguage(name) {
 *     let lang = grammars.get(name);
 *     if (!lang) {
 *       lang = await Language.load(`/grammars/tree-sitter-${name}.wasm`);
 *       grammars.set(name, lang);
 *     }
 *     return lang;
 *   },
 * });
 *
 * const shell = new Shell({ commands: [treeSitter] });
 * ```
 */
export function createTreeSitterCommand(
	instance: TreeSitterInstance,
	options: TreeSitterCommandOptions = {},
): CommandHandler {
	const extMap = buildExtMap(options.extensions);
	const langCache = new Map<string, TreeSitterLanguage | null>();

	async function resolveLanguage(name: string): Promise<TreeSitterLanguage | null> {
		if (langCache.has(name)) return langCache.get(name) ?? null;
		const lang = await Promise.resolve(instance.getLanguage(name));
		langCache.set(name, lang);
		return lang;
	}

	function detectLanguage(filePath: string): string | null {
		return extMap.get(getExtension(filePath)) ?? null;
	}

	const group = commandGroup("tree-sitter", "Syntax parsing and validation via tree-sitter");

	group
		.command("check", "Syntax-check files — report parse errors")
		.flag("-q, --quiet", "Only print filenames that contain errors")
		.option("--lang <name>", "Force language (skip extension detection)")
		.argument("[paths...]", "Files or directories to check")
		.action(async (ctx, { args, flags }) => {
			const paths = args.length > 0 ? args : ["."];
			const quiet = flags.quiet as boolean;
			const forcedLang = (flags.lang as string | undefined) || undefined;
			const files = resolveFiles(ctx, paths, extMap);

			let totalErrors = 0;
			let parser: TreeSitterParser | null = null;

			for (const file of files) {
				const langName = forcedLang ?? detectLanguage(file);
				if (!langName) continue;

				const lang = await resolveLanguage(langName);
				if (!lang) {
					ctx.stderr.write(`tree-sitter: ${file}: grammar unavailable for '${langName}'\n`);
					totalErrors++;
					continue;
				}

				if (!parser) parser = instance.createParser();
				parser.setLanguage(lang);

				const content = ctx.fs.readFile(file);
				const tree = parser.parse(content);

				const errors: TreeSitterNode[] = [];
				for (const n of iterErrors(tree.rootNode)) errors.push(n);
				if (errors.length === 0) continue;

				totalErrors += errors.length;

				if (quiet) {
					ctx.stdout.write(`${file}\n`);
					continue;
				}

				for (const e of errors) {
					const row = e.startPosition.row + 1;
					const col = e.startPosition.column + 1;
					const kind = e.isMissing ? "missing" : "error";
					const detail = e.isMissing
						? `missing ${e.type || "node"}`
						: `unexpected ${e.type || "token"}`;
					ctx.stdout.write(`${file}:${row}:${col}: ${kind}: ${detail}\n`);
				}
			}

			return totalErrors === 0 ? 0 : 1;
		});

	group
		.command("parse", "Print the parse tree as an S-expression")
		.option("--lang <name>", "Force language (skip extension detection)")
		.argument("<file>", "File to parse")
		.action(async (ctx, { args, flags }) => {
			if (args.length === 0) {
				ctx.stderr.write("tree-sitter parse: missing file argument\n");
				return 1;
			}
			const file = ctx.resolve(args[0]);
			if (!ctx.fs.exists(file)) {
				ctx.stderr.write(`tree-sitter parse: ${args[0]}: No such file or directory\n`);
				return 1;
			}

			const forcedLang = (flags.lang as string | undefined) || undefined;
			const langName = forcedLang ?? detectLanguage(file);
			if (!langName) {
				ctx.stderr.write(`tree-sitter parse: ${args[0]}: unknown language (use --lang)\n`);
				return 1;
			}

			const lang = await resolveLanguage(langName);
			if (!lang) {
				ctx.stderr.write(`tree-sitter parse: grammar unavailable for '${langName}'\n`);
				return 1;
			}

			const parser = instance.createParser();
			parser.setLanguage(lang);
			const content = ctx.fs.readFile(file);
			const tree = parser.parse(content);
			ctx.stdout.write(`${sExpr(tree.rootNode, 0)}\n`);
			return tree.rootNode.hasError ? 1 : 0;
		});

	group.command("languages", "List configured extension → language mappings").action((ctx) => {
		const entries = [...extMap.entries()].sort(([a], [b]) => a.localeCompare(b));
		for (const [ext, lang] of entries) {
			ctx.stdout.write(`${ext.padEnd(10)} ${lang}\n`);
		}
		return 0;
	});

	return group.toHandler();
}
