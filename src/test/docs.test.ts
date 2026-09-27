/**
 * Docs cannot drift: generated pages must match the code, and every example
 * marked `<!-- verify: <kind> <template> -->` must actually work.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { applyOps } from '../core/ops.js';
import { critique } from '../critic/critics.js';
import { referenceMarkdown, schemaJson, templatesMarkdown } from '../docs-gen.js';
import { getTemplate } from '../templates/index.js';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('generated docs are current (run: npx tsx scripts/gen-docs.ts)', () => {
	it('reference, templates and JSON Schema', () => {
		expect(read('docs/reference.md')).toBe(referenceMarkdown());
		expect(read('docs/templates.md')).toBe(templatesMarkdown());
		expect(read('schema/clayform.schema.json')).toBe(schemaJson());
	});
});

describe('verified examples', () => {
	const pages = ['README.md', ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
	const blocks: { page: string; kind: string; template: string; json: string }[] = [];
	for (const page of pages) {
		const re = /<!-- verify: (\w+) (\w+) -->\s*```json\n([\s\S]*?)```/g;
		for (const m of read(page).matchAll(re)) blocks.push({ page, kind: m[1], template: m[2], json: m[3] });
	}

	it('finds examples to check', () => {
		expect(blocks.length).toBeGreaterThanOrEqual(8);
	});

	for (const b of blocks)
		it(`${b.page}: ${b.kind} on ${b.template}`, () => {
			const t = getTemplate(b.template);
			expect(t, `unknown template ${b.template}`).toBeDefined();
			const value = JSON.parse(b.json);
			const ops =
				b.kind === 'ops' ? value
				: b.kind === 'part' ? [{ op: 'add_part', part: value }]
				: b.kind === 'sculpt' ? [{ op: 'add_sculpt', sculpt: value }]
				: b.kind === 'clip' ? [{ op: 'add_clip', clip: value }]
				: b.kind === 'effect' ? [{ op: 'add_effect', effect: value }]
				: null;
			expect(ops, `unknown verify kind ${b.kind}`).not.toBeNull();
			const r = applyOps(t!.scene, ops);
			expect(r.ok, r.ok ? '' : r.error).toBe(true);
			if (!r.ok) return;
			const errors = critique(buildScene(r.scene)).issues.filter((i) => i.severity === 'error');
			expect(errors.map((e) => e.message)).toEqual([]);
		});
});
