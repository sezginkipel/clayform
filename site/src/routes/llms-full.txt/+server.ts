import { nav, pageBySlug } from '$lib/docs';
import { DEFAULT_DESCRIPTION, INSTALL, NPM, REPO, SITE_URL, VERSION } from '$lib/meta';

export const prerender = true;

export function GET() {
	const orderedSlugs = nav.flatMap((g) => g.items.map((i) => i.slug));
	const docsCorpus = orderedSlugs
		.map((slug) => {
			const p = pageBySlug.get(slug);
			if (!p) return '';
			const url = slug ? `${SITE_URL}/docs/${slug}` : `${SITE_URL}/docs`;
			return `---\nURL: ${url}\nTitle: ${p.title}\n---\n\n${p.markdown}`;
		})
		.filter(Boolean)
		.join('\n\n');

	const body = `# Clayform Complete Documentation Corpus (v${VERSION})

> ${DEFAULT_DESCRIPTION}

- Website: ${SITE_URL}
- Repository: ${REPO}
- npm: ${NPM}
- Install: \`${INSTALL}\`

${docsCorpus}
`;

	return new Response(body, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
}
