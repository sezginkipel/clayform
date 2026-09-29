/**
 * The site is the repository's own docs/*.md, rendered at build time.
 * Links between pages become site routes, links into the code go to GitHub,
 * images are the same real renders the README uses, and examples the test
 * suite checks (`<!-- verify … -->`) are marked as such.
 */

import { Marked, type Tokens } from 'marked';

const REPO = 'https://github.com/sezginkipel/clayform';

const raw = import.meta.glob('../../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const images = import.meta.glob('../../../docs/**/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** docs-relative image path (templates/biped.png) → built asset url */
const imageUrl = new Map(Object.entries(images).map(([k, v]) => [k.replace(/^.*\/docs\//, ''), v]));

const slugOf = (file: string) => {
	const base = file.replace(/^.*\//, '').replace(/\.md$/, '');
	return base === 'README' ? '' : base;
};

export interface Heading {
	depth: number;
	text: string;
	id: string;
}

export interface Page {
	slug: string;
	title: string;
	html: string;
	headings: Heading[];
	source: string;
}

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to dashes. */
function githubSlug(text: string, seen: Map<string, number>): string {
	const base = text
		.toLowerCase()
		.replace(/<[^>]+>/g, '')
		.replace(/[^\p{L}\p{N}\s_-]/gu, '')
		.trim()
		.replace(/\s/g, '-');
	const n = seen.get(base) ?? 0;
	seen.set(base, n + 1);
	return n ? `${base}-${n}` : base;
}

function rewriteHref(href: string): string {
	if (/^(https?:|mailto:|#)/.test(href)) return href;
	const [path, hash] = href.split('#');
	const anchor = hash ? `#${hash}` : '';
	if (/^[\w-]+\.md$/.test(path)) return `/docs/${slugOf(path)}${anchor}`.replace(/\/$/, '') || '/docs';
	if (path.startsWith('../')) return `${REPO}/blob/main/${path.slice(3)}${anchor}`;
	// any other file next to the docs (example scenes, layouts) lives in the repository
	if (path && !path.startsWith('/')) return `${REPO}/blob/main/docs/${path}${anchor}`;
	return href;
}

function rewriteSrc(src: string): string {
	return imageUrl.get(src.replace(/^\.\//, '')) ?? src;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A little colour for JSON and shell: keys, strings, numbers, comments. */
function highlight(code: string, lang: string): string {
	const e = escapeHtml(code);
	if (lang === 'json' || lang === 'jsonc') {
		return e
			.replace(/(\/\/[^\n]*)/g, '<span class="c">$1</span>')
			.replace(/("(?:[^"\\\n]|\\.)*")(\s*:)?/g, (_, s, colon) => (colon ? `<span class="k">${s}</span>${colon}` : `<span class="s">${s}</span>`))
			.replace(/(?<![\w.#-])(-?\d+(?:\.\d+)?)(?![\w-])/g, '<span class="n">$1</span>');
	}
	if (lang === 'bash' || lang === 'sh') return e.replace(/(^|\n)(#[^\n]*)/g, '$1<span class="c">$2</span>');
	return e;
}

function render(source: string, slug: string): Page {
	const seen = new Map<string, number>();
	const headings: Heading[] = [];
	let title = '';
	// the test-checked examples: turn the marker comment into a flag on the next code block
	const marked_ = source.replace(/<!-- verify:[^>]*-->\s*\n```(\w*)/g, '```$1 verified');
	const md = new Marked({
		gfm: true,
		renderer: {
			heading({ tokens, depth }: Tokens.Heading) {
				const text = this.parser.parseInline(tokens);
				const id = githubSlug(text, seen);
				if (depth === 1 && !title) {
					title = text.replace(/<[^>]+>/g, '');
					return `<h1 id="${id}">${text}</h1>`;
				}
				if (depth <= 3) headings.push({ depth, text: text.replace(/<[^>]+>/g, ''), id });
				return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${depth}>`;
			},
			link({ href, title: t, tokens }: Tokens.Link) {
				const url = rewriteHref(href);
				const external = /^https?:/.test(url);
				return `<a href="${url}"${t ? ` title="${t}"` : ''}${external ? ' rel="noopener"' : ''}>${this.parser.parseInline(tokens)}</a>`;
			},
			image({ href, text }: Tokens.Image) {
				return `<img src="${rewriteSrc(href)}" alt="${escapeHtml(text)}" loading="lazy">`;
			},
			html({ text }: Tokens.HTML | Tokens.Tag) {
				// raw <img> in generated pages (templates, parts) point at docs-relative files too
				return text.replace(/<!--[\s\S]*?-->/g, '').replace(/src="([^"]+)"/g, (_, s) => `src="${rewriteSrc(s)}" loading="lazy"`);
			},
			code({ text, lang }: Tokens.Code) {
				const [language = '', flag] = (lang ?? '').split(/\s+/);
				const badge = flag === 'verified' ? '<span class="verified" title="The test suite parses and builds this example on every change">checked by the tests</span>' : '';
				return `<figure class="code">${badge}<pre><code class="lang-${language}">${highlight(text, language)}</code></pre></figure>`;
			}
		}
	});
	const html = md.parse(marked_) as string;
	return { slug, title: title || slug, html, headings, source: `${REPO}/blob/main/docs/${slug || 'README'}.md` };
}

export const pages: Page[] = Object.entries(raw)
	.map(([file, text]) => render(text, slugOf(file)))
	.sort((a, b) => a.slug.localeCompare(b.slug));

export const pageBySlug = new Map(pages.map((p) => [p.slug, p]));

/** The sidebar: reading order, grouped. Anything not listed lands under "More". */
const GROUPS: { name: string; slugs: string[] }[] = [
	{ name: 'Start', slugs: ['', 'getting-started', 'concepts', 'mcp-tools'] },
	{ name: 'Build', slugs: ['critics', 'matching-a-reference', 'layouts', 'animation', 'effects', 'export'] },
	{ name: 'Reference', slugs: ['reference', 'templates', 'parts', 'cli-and-library', 'format'] },
	{ name: 'Inside', slugs: ['architecture', 'faq'] }
];

export const nav = (() => {
	const used = new Set(GROUPS.flatMap((g) => g.slugs));
	const more = pages.filter((p) => !used.has(p.slug)).map((p) => p.slug);
	return [...GROUPS, ...(more.length ? [{ name: 'More', slugs: more }] : [])].map((g) => ({
		name: g.name,
		items: g.slugs.filter((s) => pageBySlug.has(s)).map((s) => ({ slug: s, title: s === '' ? 'Overview' : pageBySlug.get(s)!.title }))
	}));
})();

/** Template renders for the home page, with the anchor of each template's section. */
export const templates = (() => {
	const md = raw['../../../docs/templates.md'] ?? '';
	const seen = new Map<string, number>();
	const out: { id: string; title: string; src: string; anchor: string }[] = [];
	for (const m of md.matchAll(/^## (.+) — `([\w-]+)`$/gm)) {
		const src = imageUrl.get(`templates/${m[2]}.png`);
		if (src) out.push({ id: m[2], title: m[1], src, anchor: githubSlug(`${m[1]} — ${m[2]}`, seen) });
	}
	return out;
})();

export const image = (name: string) => imageUrl.get(name) ?? '';
