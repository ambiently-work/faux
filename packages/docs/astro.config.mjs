import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightThemeRapide from "starlight-theme-rapide";

const fauxEntry = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
const wasmStub = fileURLToPath(new URL("./src/lib/wasm-stub.ts", import.meta.url));

export default defineConfig({
	site: "https://ambiently-work.github.io",
	base: "/faux",
	vite: {
		resolve: {
			alias: [{ find: "@ambiently-work/faux", replacement: fauxEntry }],
		},
		plugins: [
			{
				// The Shell has an optional dynamic `import("./wasm/index.js")`
				// that chains into `../../pkg/faux_wasm.js`. The WASM binary
				// isn't built in the Pages pipeline — resolve the dynamic import
				// to a stub so the pure-TS fallback kicks in.
				name: "faux-wasm-stub",
				enforce: "pre",
				resolveId(source) {
					if (source.endsWith("/pkg/faux_wasm.js")) {
						return wasmStub;
					}
					return null;
				},
			},
		],
	},
	integrations: [
		starlight({
			title: "faux",
			description:
				"A virtual bash shell that runs on any JavaScript runtime. 111 commands, in-memory VFS, zero dependencies.",
			plugins: [starlightThemeRapide()],
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/ambiently-work/faux",
				},
			],
			editLink: {
				baseUrl: "https://github.com/ambiently-work/faux/edit/main/packages/docs/",
			},
			lastUpdated: true,
			sidebar: [
				{
					label: "Try it in your browser",
					link: "/try/",
					attrs: { target: "_blank" },
					badge: { text: "Live", variant: "tip" },
				},
				{
					label: "Getting Started",
					items: [
						{ label: "Introduction", slug: "guides/introduction" },
						{ label: "Installation", slug: "guides/installation" },
						{ label: "Quick Start", slug: "guides/quick-start" },
					],
				},
				{
					label: "Guides",
					items: [
						{ label: "Shell Features", slug: "guides/shell-features" },
						{
							label: "Virtual Filesystem",
							slug: "guides/virtual-filesystem",
						},
						{ label: "Custom Commands", slug: "guides/custom-commands" },
						{ label: "Deployment", slug: "guides/deployment" },
					],
				},
				{
					label: "Examples",
					items: [
						{ label: "Common Patterns", slug: "examples/common-patterns" },
						{
							label: "Cloudflare Worker",
							slug: "examples/cloudflare-worker",
						},
						{ label: "Web Terminal", slug: "examples/web-terminal" },
					],
				},
				{
					label: "Reference",
					collapsed: true,
					items: [
						{ label: "Shell API", slug: "reference/shell-api" },
						{ label: "Commands", slug: "reference/commands" },
						{ label: "Parser API", slug: "reference/parser-api" },
						{
							label: "Virtual Filesystem API",
							slug: "reference/vfs-api",
						},
						{ label: "Environment API", slug: "reference/environment-api" },
					],
				},
			],
		}),
	],
});
