import { commandGroup } from "../builder.js";
import type { CommandContext, CommandHandler } from "../types.js";

/**
 * Minimal interface matching the subset of Biome's JS API used by this command.
 * Works with any `@biomejs/js-api` distribution (nodejs, bundler, web).
 */
export interface BiomeInstance {
	openProject(path?: string): { projectKey: number };
	applyConfiguration(projectKey: number, configuration: unknown): void;
	formatContent(
		projectKey: number,
		content: string,
		options: { filePath: string },
	): { content: string; diagnostics: unknown[] };
	lintContent(
		projectKey: number,
		content: string,
		options: { filePath: string; fixFileMode?: string },
	): { content: string; diagnostics: unknown[] };
	printDiagnostics(
		diagnostics: unknown[],
		options: { filePath: string; fileSource: string; verbose?: boolean },
	): string;
}

const SUPPORTED_EXTENSIONS = new Set([
	".js",
	".jsx",
	".ts",
	".tsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
	".json",
	".jsonc",
	".css",
]);

function getExtension(filePath: string): string {
	const dot = filePath.lastIndexOf(".");
	return dot === -1 ? "" : filePath.slice(dot);
}

function isSupportedFile(filePath: string): boolean {
	return SUPPORTED_EXTENSIONS.has(getExtension(filePath));
}

function resolveFiles(ctx: CommandContext, paths: string[]): string[] {
	const files: string[] = [];

	for (const p of paths) {
		const resolved = ctx.resolve(p);
		if (!ctx.fs.exists(resolved)) {
			ctx.stderr.write(`biome: ${p}: No such file or directory\n`);
			continue;
		}

		const stat = ctx.fs.stat(resolved);
		if (stat.isDirectory()) {
			collectFiles(ctx, resolved, files);
		} else if (stat.isFile() && isSupportedFile(resolved)) {
			files.push(resolved);
		}
	}

	return files;
}

function collectFiles(ctx: CommandContext, dir: string, out: string[]): void {
	for (const entry of ctx.fs.readDir(dir)) {
		const full = dir === "/" ? `/${entry}` : `${dir}/${entry}`;
		const stat = ctx.fs.stat(full);
		if (stat.isDirectory()) {
			collectFiles(ctx, full, out);
		} else if (stat.isFile() && isSupportedFile(full)) {
			out.push(full);
		}
	}
}

function loadConfiguration(ctx: CommandContext): Record<string, unknown> | null {
	const configPaths = ["biome.json", "biome.jsonc"];
	for (const name of configPaths) {
		const configPath = ctx.resolve(name);
		if (ctx.fs.exists(configPath)) {
			try {
				const raw = ctx.fs.readFile(configPath);
				const config = JSON.parse(raw);
				delete config.$schema;
				return config;
			} catch {
				ctx.stderr.write(`biome: warning: failed to parse ${name}\n`);
			}
		}
	}
	return null;
}

function formatDiagnostic(d: unknown, filePath: string): string {
	const rec = d as Record<string, unknown>;
	const severity = rec.severity ?? "error";
	const message = rec.message ?? rec.description ?? "unknown";
	return `${severity}: ${filePath}: ${message}`;
}

/**
 * Creates a `biome` shell command backed by the given Biome WASM instance.
 *
 * The caller is responsible for initializing the Biome instance with the
 * appropriate distribution for their environment:
 *
 * - Node/Bun:   `new Biome()` from `@biomejs/js-api/nodejs`
 * - Bundler/CF: `new Biome()` from `@biomejs/js-api/bundler`
 * - Browser:    `new Biome()` from `@biomejs/js-api/web`
 */
export function createBiomeCommand(instance: BiomeInstance): CommandHandler {
	const biome = instance;

	const group = commandGroup("biome", "Biome toolchain for web projects");

	group
		.command("format", "Format files")
		.flag("-w, --write", "Write formatted output back to files")
		.argument("[paths...]", "Files or directories to format")
		.action((ctx, { args, flags }) => {
			const paths = args.length > 0 ? args : ["."];
			const write = flags.write as boolean;

			const files = resolveFiles(ctx, paths);
			if (files.length === 0) {
				ctx.stderr.write("biome format: no supported files found\n");
				return 1;
			}

			const { projectKey } = biome.openProject();
			const config = loadConfiguration(ctx);
			if (config) {
				biome.applyConfiguration(projectKey, config);
			}

			let hasErrors = false;
			let changed = 0;

			for (const file of files) {
				const content = ctx.fs.readFile(file);
				try {
					const result = biome.formatContent(projectKey, content, { filePath: file });

					if (result.diagnostics.length > 0) {
						for (const d of result.diagnostics) {
							ctx.stderr.write(`${formatDiagnostic(d, file)}\n`);
						}
						hasErrors = true;
						continue;
					}

					if (result.content !== content) {
						if (write) {
							ctx.fs.writeFile(file, result.content);
							changed++;
						} else {
							ctx.stdout.write(result.content);
						}
					} else if (!write) {
						ctx.stdout.write(content);
					}
				} catch (e) {
					ctx.stderr.write(`biome format: ${file}: ${e instanceof Error ? e.message : e}\n`);
					hasErrors = true;
				}
			}

			if (write && changed > 0) {
				ctx.stderr.write(`Formatted ${changed} file${changed === 1 ? "" : "s"}\n`);
			}

			return hasErrors ? 1 : 0;
		});

	group
		.command("lint", "Lint files and report diagnostics")
		.flag("-a, --apply", "Apply safe lint fixes")
		.argument("[paths...]", "Files or directories to lint")
		.action((ctx, { args, flags }) => {
			const apply = flags.apply as boolean;
			const paths = args.length > 0 ? args : ["."];

			const files = resolveFiles(ctx, paths);
			if (files.length === 0) {
				ctx.stderr.write("biome lint: no supported files found\n");
				return 1;
			}

			const { projectKey } = biome.openProject();
			const config = loadConfiguration(ctx);
			if (config) {
				biome.applyConfiguration(projectKey, config);
			}

			let totalDiagnostics = 0;

			for (const file of files) {
				const content = ctx.fs.readFile(file);
				try {
					const result = biome.lintContent(projectKey, content, {
						filePath: file,
						fixFileMode: apply ? "safeFixes" : undefined,
					});

					if (result.diagnostics.length > 0) {
						totalDiagnostics += result.diagnostics.length;
						const printed = biome.printDiagnostics(result.diagnostics, {
							filePath: file,
							fileSource: content,
						});
						ctx.stdout.write(`${printed}\n`);
					}

					if (apply && result.content !== content) {
						ctx.fs.writeFile(file, result.content);
					}
				} catch (e) {
					ctx.stderr.write(`biome lint: ${file}: ${e instanceof Error ? e.message : e}\n`);
				}
			}

			if (totalDiagnostics === 0) {
				ctx.stderr.write("No lint issues found.\n");
				return 0;
			}

			ctx.stderr.write(
				`Found ${totalDiagnostics} diagnostic${totalDiagnostics === 1 ? "" : "s"}\n`,
			);
			return 1;
		});

	group
		.command("check", "Run format + lint")
		.flag("-a, --apply", "Apply safe fixes")
		.flag("-w, --write", "Write formatted output back to files")
		.argument("[paths...]", "Files or directories to check")
		.action((ctx, { args, flags }) => {
			const apply = (flags.apply || flags.write) as boolean;
			const paths = args.length > 0 ? args : ["."];

			const files = resolveFiles(ctx, paths);
			if (files.length === 0) {
				ctx.stderr.write("biome check: no supported files found\n");
				return 1;
			}

			const { projectKey } = biome.openProject();
			const config = loadConfiguration(ctx);
			if (config) {
				biome.applyConfiguration(projectKey, config);
			}

			let totalDiagnostics = 0;
			let formatIssues = 0;

			for (const file of files) {
				const content = ctx.fs.readFile(file);
				try {
					const formatted = biome.formatContent(projectKey, content, { filePath: file });
					if (formatted.content !== content) {
						formatIssues++;
						if (apply) {
							ctx.fs.writeFile(file, formatted.content);
						} else {
							ctx.stdout.write(`${file}: formatting issues found\n`);
						}
					}

					const sourceToLint = apply ? formatted.content : content;
					const linted = biome.lintContent(projectKey, sourceToLint, {
						filePath: file,
						fixFileMode: apply ? "safeFixes" : undefined,
					});

					if (linted.diagnostics.length > 0) {
						totalDiagnostics += linted.diagnostics.length;
						const printed = biome.printDiagnostics(linted.diagnostics, {
							filePath: file,
							fileSource: sourceToLint,
						});
						ctx.stdout.write(`${printed}\n`);
					}

					if (apply && linted.content !== sourceToLint) {
						ctx.fs.writeFile(file, linted.content);
					}
				} catch (e) {
					ctx.stderr.write(`biome check: ${file}: ${e instanceof Error ? e.message : e}\n`);
				}
			}

			const issues = totalDiagnostics + formatIssues;
			if (issues === 0) {
				ctx.stderr.write("No issues found.\n");
				return 0;
			}

			if (apply) {
				ctx.stderr.write(`Fixed ${issues} issue${issues === 1 ? "" : "s"}\n`);
			} else {
				ctx.stderr.write(`Found ${issues} issue${issues === 1 ? "" : "s"}\n`);
			}
			return apply ? 0 : 1;
		});

	group
		.command("lsp", "Show LSP-style diagnostics for a file")
		.argument("<file>", "File to diagnose")
		.action((ctx, { args }) => {
			if (args.length === 0) {
				ctx.stderr.write("biome lsp: missing file argument\n");
				return 1;
			}

			const filePath = ctx.resolve(args[0]);
			if (!ctx.fs.exists(filePath)) {
				ctx.stderr.write(`biome lsp: ${args[0]}: No such file or directory\n`);
				return 1;
			}

			if (!isSupportedFile(filePath)) {
				ctx.stderr.write(`biome lsp: ${args[0]}: unsupported file type\n`);
				return 1;
			}

			const content = ctx.fs.readFile(filePath);
			const { projectKey } = biome.openProject();
			const config = loadConfiguration(ctx);
			if (config) {
				biome.applyConfiguration(projectKey, config);
			}

			const diagnostics: Array<{ type: string; message: string; severity: string }> = [];

			try {
				const formatted = biome.formatContent(projectKey, content, { filePath });
				if (formatted.content !== content) {
					diagnostics.push({
						type: "format",
						message: "File is not formatted",
						severity: "warning",
					});
				}
				for (const d of formatted.diagnostics) {
					diagnostics.push({
						type: "format",
						message: formatDiagnostic(d, filePath),
						severity: "error",
					});
				}
			} catch (e) {
				diagnostics.push({
					type: "format",
					message: `Format error: ${e instanceof Error ? e.message : e}`,
					severity: "error",
				});
			}

			try {
				const linted = biome.lintContent(projectKey, content, { filePath });
				if (linted.diagnostics.length > 0) {
					const printed = biome.printDiagnostics(linted.diagnostics, {
						filePath,
						fileSource: content,
					});
					ctx.stdout.write(`${printed}\n`);
				}
			} catch (e) {
				diagnostics.push({
					type: "lint",
					message: `Lint error: ${e instanceof Error ? e.message : e}`,
					severity: "error",
				});
			}

			for (const d of diagnostics) {
				const icon = d.severity === "error" ? "\u2717" : "\u26A0";
				ctx.stdout.write(`${icon} [${d.type}] ${d.message}\n`);
			}

			if (diagnostics.length === 0) {
				ctx.stdout.write("No issues found.\n");
			}

			return diagnostics.some((d) => d.severity === "error") ? 1 : 0;
		});

	return group.toHandler();
}
