import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/** One project in the showcase (docs/showcase/<slug>.json, image next to it). The site reads these. */
const Entry = z.strictObject({
	name: z.string().min(1).max(60),
	url: z.url().startsWith('https://'),
	by: z.string().min(1).max(60),
	byUrl: z.url().startsWith('https://').optional(),
	summary: z.string().min(20).max(320),
	clayform: z.string().min(20).max(400).describe('what Clayform made in this project'),
	image: z.string().regex(/^[a-z0-9-]+\.png$/),
	imageAlt: z.string().min(10).max(300),
	repo: z.url().startsWith('https://').optional(),
	tags: z.array(z.string().regex(/^[a-z0-9.+-]{1,20}$/)).max(5).optional(),
	added: z.iso.date()
});

const dir = new URL('../../docs/showcase/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('showcase entries', () => {
	it('there is at least one', () => expect(files.length).toBeGreaterThan(0));

	for (const f of files)
		it(`${f} is complete and its picture is there`, () => {
			const r = Entry.safeParse(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
			expect(r.success, r.success ? '' : z.prettifyError(r.error)).toBe(true);
			if (!r.success) return;
			expect(f).toMatch(/^[a-z0-9-]+\.json$/);
			expect(existsSync(new URL(r.data.image, dir)), `${r.data.image} next to ${f}`).toBe(true);
			const png = readFileSync(new URL(r.data.image, dir));
			expect(png.byteLength, 'keep the picture under 1.5 MB').toBeLessThan(1_500_000);
		});

	it('no project is listed twice', () => {
		const urls = files.map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')).url);
		expect(new Set(urls).size).toBe(urls.length);
	});
});
