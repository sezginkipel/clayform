import { pages } from '$lib/docs';
import { SITE_URL } from '$lib/meta';

export const prerender = true;

export function GET() {
	const urls = [
		{ loc: `${SITE_URL}/`, priority: '1.0', changefreq: 'weekly' },
		{ loc: `${SITE_URL}/play`, priority: '0.9', changefreq: 'weekly' },
		{ loc: `${SITE_URL}/benchmark`, priority: '0.9', changefreq: 'weekly' },
		{ loc: `${SITE_URL}/showcase`, priority: '0.8', changefreq: 'weekly' },
		...pages.map((p) => ({
			loc: p.slug ? `${SITE_URL}/docs/${p.slug}` : `${SITE_URL}/docs`,
			priority: p.slug === '' || p.slug === 'getting-started' || p.slug === 'mcp-tools' ? '0.9' : '0.8',
			changefreq: 'weekly'
		}))
	];

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
	.map(
		(u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
	)
	.join('\n')}
</urlset>`;

	return new Response(xml, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
}
