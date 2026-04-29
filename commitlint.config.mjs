/** @type {import('@commitlint/types').UserConfig} */
export default {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"type-enum": [
			2,
			"always",
			[
				"feat",
				"fix",
				"chore",
				"docs",
				"test",
				"refactor",
				"perf",
				"build",
				"ci",
				"revert",
				"style",
			],
		],
		"subject-case": [2, "never", ["sentence-case", "start-case", "pascal-case", "upper-case"]],
		"header-max-length": [2, "always", 100],
		"body-max-line-length": [1, "always", 200],
	},
};
