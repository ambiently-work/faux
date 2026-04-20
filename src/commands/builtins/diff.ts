import { command } from "../builder.js";

export const diff = command("diff")
	.description("Compare files line by line")
	.flag("-u, --unified", "Output in unified format", { default: true })
	.allowUnknownFlags()
	.argument("<file1>", "First file")
	.argument("<file2>", "Second file")
	.action((ctx, { args: files }) => {
		const file1 = files[0];
		const file2 = files[1];

		let content1: string;
		let content2: string;

		try {
			content1 = ctx.fs.readFile(ctx.resolve(file1));
		} catch {
			ctx.stderr.writeln(`diff: ${file1}: No such file or directory`);
			return 2;
		}

		try {
			content2 = ctx.fs.readFile(ctx.resolve(file2));
		} catch {
			ctx.stderr.writeln(`diff: ${file2}: No such file or directory`);
			return 2;
		}

		if (content1 === content2) {
			return 0;
		}

		const lines1 = splitLines(content1);
		const lines2 = splitLines(content2);

		const editScript = myersDiff(lines1, lines2);

		const hunks = groupIntoHunks(editScript, lines1, lines2, 3);
		ctx.stdout.writeln(`--- ${file1}`);
		ctx.stdout.writeln(`+++ ${file2}`);

		for (const hunk of hunks) {
			ctx.stdout.writeln(
				"@@ -" +
					hunk.oldStart +
					"," +
					hunk.oldCount +
					" +" +
					hunk.newStart +
					"," +
					hunk.newCount +
					" @@",
			);
			for (const line of hunk.lines) {
				ctx.stdout.writeln(line);
			}
		}

		return 1;
	})
	.toHandler();

function splitLines(content: string): string[] {
	const lines = content.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "" && content.endsWith("\n")) {
		lines.pop();
	}
	return lines;
}

interface EditOp {
	type: "equal" | "insert" | "delete";
	oldIdx: number;
	newIdx: number;
}

function myersDiff(a: string[], b: string[]): EditOp[] {
	const n = a.length;
	const m = b.length;

	// Simple O(NM) LCS for correctness
	const dp: number[][] = [];
	for (let i = 0; i <= n; i++) {
		dp[i] = new Array(m + 1).fill(0);
	}
	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack
	const ops: EditOp[] = [];
	let i = n;
	let j = m;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
			ops.unshift({ type: "equal", oldIdx: i - 1, newIdx: j - 1 });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			ops.unshift({ type: "insert", oldIdx: i, newIdx: j - 1 });
			j--;
		} else {
			ops.unshift({ type: "delete", oldIdx: i - 1, newIdx: j });
			i--;
		}
	}

	return ops;
}

interface Hunk {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	lines: string[];
}

function groupIntoHunks(ops: EditOp[], a: string[], b: string[], context: number): Hunk[] {
	// Find change indices
	const changeIndices: number[] = [];
	for (let i = 0; i < ops.length; i++) {
		if (ops[i].type !== "equal") {
			changeIndices.push(i);
		}
	}

	if (changeIndices.length === 0) return [];

	// Group changes that are within 2*context of each other
	const groups: number[][] = [];
	let currentGroup = [changeIndices[0]];

	for (let i = 1; i < changeIndices.length; i++) {
		if (changeIndices[i] - changeIndices[i - 1] <= context * 2) {
			currentGroup.push(changeIndices[i]);
		} else {
			groups.push(currentGroup);
			currentGroup = [changeIndices[i]];
		}
	}
	groups.push(currentGroup);

	const hunks: Hunk[] = [];

	for (const group of groups) {
		const firstChange = group[0];
		const lastChange = group[group.length - 1];

		const start = Math.max(0, firstChange - context);
		const end = Math.min(ops.length - 1, lastChange + context);

		const lines: string[] = [];
		let oldCount = 0;
		let newCount = 0;

		let oldStart = 0;
		let newStart = 0;

		for (let i = start; i <= end; i++) {
			const op = ops[i];
			if (i === start) {
				oldStart = op.oldIdx + 1;
				newStart = op.newIdx + 1;
			}
			if (op.type === "equal") {
				lines.push(` ${a[op.oldIdx]}`);
				oldCount++;
				newCount++;
			} else if (op.type === "delete") {
				lines.push(`-${a[op.oldIdx]}`);
				oldCount++;
			} else {
				lines.push(`+${b[op.newIdx]}`);
				newCount++;
			}
		}

		hunks.push({ oldStart, oldCount, newStart, newCount, lines });
	}

	return hunks;
}
