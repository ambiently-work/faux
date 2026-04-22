import type { IFileSystem } from "@ambiently-work/mirage";
import type { Environment } from "../env/environment.js";
import type { Redirect } from "../parser/index.js";
import { expandWord, type SubExecFn } from "./expansion/index.js";

export interface ResolvedRedirect {
	fd: number;
	op: string;
	target: string;
}

export async function resolveRedirects(
	redirects: Redirect[],
	env: Environment,
	fs: IFileSystem,
	subExec: SubExecFn,
): Promise<ResolvedRedirect[]> {
	const resolved: ResolvedRedirect[] = [];

	for (const r of redirects) {
		const target = await expandWord(r.target, env, fs, subExec);

		resolved.push({
			fd: r.fd,
			op: r.op,
			target,
		});
	}

	return resolved;
}

export function applyInputRedirect(
	redirects: ResolvedRedirect[],
	currentStdin: string,
	fs: IFileSystem,
	resolvePath: (p: string) => string,
): string {
	let stdin = currentStdin;

	for (const r of redirects) {
		switch (r.op) {
			case "<": {
				const path = resolvePath(r.target);
				try {
					stdin = fs.readFile(path);
				} catch (e) {
					throw new Error(
						`${r.target}: ${e instanceof Error ? e.message : "No such file or directory"}`,
					);
				}
				break;
			}
			case "<<<": {
				// Here-string
				stdin = `${r.target}\n`;
				break;
			}
			case "<<": {
				// Here-document (body already extracted by parser)
				stdin = r.target;
				break;
			}
		}
	}

	return stdin;
}

export function getOutputRedirects(redirects: ResolvedRedirect[]): ResolvedRedirect[] {
	return redirects.filter(
		(r) =>
			r.op === ">" ||
			r.op === ">>" ||
			r.op === "&>" ||
			r.op === "&>>" ||
			r.op === ">&" ||
			r.op === "<>",
	);
}
