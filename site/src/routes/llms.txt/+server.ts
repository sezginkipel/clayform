import { nav, pageBySlug } from '$lib/docs';
import { DEFAULT_DESCRIPTION, INSTALL, NPM, REPO, SITE_URL, VERSION } from '$lib/meta';

export const prerender = true;

export function GET() {
	const sections = nav
		.map((group) => {
			const items = group.items
				.map((item) => {
					const page = pageBySlug.get(item.slug);
					const url = item.slug ? `${SITE_URL}/docs/${item.slug}` : `${SITE_URL}/docs`;
					return `- [${item.title}](${url}): ${page?.description ?? ''}`;
				})
				.join('\n');
			return `## ${group.name}\n\n${items}`;
		})
		.join('\n\n');

	const body = `# Clayform (v${VERSION})

> ${DEFAULT_DESCRIPTION}

Clayform is an open-source (Apache-2.0) Node.js library, CLI, and Model Context Protocol (MCP) server (` + '`@s1444/clayform`' + `) that gives AI coding agents a complete 3D modeling, sculpting, rigging, procedural animation, and glTF 2.0 export workshop with zero GPU or Blender dependency.

## Quick Facts & Install

- **Install MCP Server**: \`${INSTALL}\`
- **Run CLI / Viewer**: \`npx -y @s1444/clayform view knight --port 8765\`
- **npm Package**: ${NPM}
- **GitHub Repository**: ${REPO}
- **Full LLM Corpus**: ${SITE_URL}/llms-full.txt
- **Supported Game Engines**: Godot 4, Unity (Humanoid Mecanim), Unreal Engine 5, three.js

${sections}
`;

	return new Response(body, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
}
