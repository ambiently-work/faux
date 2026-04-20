import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightThemeRapide from "starlight-theme-rapide";

export default defineConfig({
	site: "https://seventwo-studio.github.io",
	base: "/faux-shell",
	integrations: [
		starlight({
			title: "faux-shell",
			description:
				"A virtual bash shell that runs on any JavaScript runtime. 111 commands, in-memory VFS, zero dependencies.",
			plugins: [starlightThemeRapide()],
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/seventwo-studio/faux-shell",
				},
			],
			editLink: {
				baseUrl:
					"https://github.com/seventwo-studio/faux-shell/edit/main/packages/docs/",
			},
			lastUpdated: true,
			sidebar: [
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
