/** Showcase entries: docs/showcase/<slug>.json with a picture next to it (checked by src/test/showcase.test.ts). */

export interface Entry {
	slug: string;
	name: string;
	url: string;
	by: string;
	byUrl?: string;
	summary: string;
	clayform: string;
	image: string;
	imageAlt: string;
	repo?: string;
	tags?: string[];
	added: string;
}

const data = import.meta.glob('../../../docs/showcase/*.json', { import: 'default', eager: true }) as Record<string, Omit<Entry, 'slug'>>;
const pictures = import.meta.glob('../../../docs/showcase/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export const entries: Entry[] = Object.entries(data)
	.map(([file, e]) => {
		const slug = file.replace(/^.*\//, '').replace(/\.json$/, '');
		const image = pictures[`../../../docs/showcase/${e.image}`];
		if (!image) throw new Error(`showcase ${slug}: picture ${e.image} is missing`);
		return { ...e, slug, image };
	})
	// newest first
	.sort((a, b) => b.added.localeCompare(a.added) || a.name.localeCompare(b.name));

export const SUBMIT = 'https://github.com/sezginkipel/clayform/issues/new?template=showcase.yml';
