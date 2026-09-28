import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { buildLayout, critiqueLayout, expandLayout, parseLayout, type Layout } from '../layout.js';
import { exportGlb } from '../export/gltf.js';
import { getTemplate } from '../templates/index.js';

const resolve = (ref: string) => getTemplate(ref)!.scene;
const L = (x: Partial<Layout>): Layout => ({ format: 'clayform-layout/1', name: 't', ...x });

describe('layouts', () => {
	it('expands patterns to exact positions', () => {
		const p = expandLayout(L({ patterns: [{ id: 'g', scene: 'barrel', type: 'grid', count: 4, spacing: 2 }, { id: 'c', scene: 'barrel', type: 'circle', count: 4, radius: 3 }] }));
		expect(p.slice(0, 4).map((q) => [q.position[0], q.position[2]])).toEqual([[-1, -1], [1, -1], [-1, 1], [1, 1]]);
		expect(p[4].position[2]).toBeCloseTo(3);
		expect(p.map((q) => q.id)).toContain('c_4');
	});

	it('scatter respects minGap and is repeatable for a seed', () => {
		const pat = { id: 's', scene: 'rock', type: 'scatter' as const, count: 12, area: [10, 10] as [number, number], minGap: 1.5, seed: 7 };
		const a = expandLayout(L({ patterns: [pat] })), b = expandLayout(L({ patterns: [pat] }));
		expect(a).toEqual(b);
		for (let i = 0; i < a.length; i++)
			for (let j = i + 1; j < a.length; j++) expect(Math.hypot(a[i].position[0] - a[j].position[0], a[i].position[2] - a[j].position[2])).toBeGreaterThanOrEqual(1.5);
	});

	it('flags items that pass through each other, not items that are apart', () => {
		const near = critiqueLayout(buildLayout(L({ items: [{ id: 'a', scene: 'barrel', position: [0, 0] }, { id: 'b', scene: 'barrel', position: [0.3, 0] }] }), resolve));
		expect(near.map((i) => i.code)).toContain('items-overlap');
		const far = critiqueLayout(buildLayout(L({ items: [{ id: 'a', scene: 'barrel', position: [0, 0] }, { id: 'b', scene: 'barrel', position: [2, 0] }] }), resolve));
		expect(far).toEqual([]);
	});

	it('the example camp parses, and exports as valid glTF with one node per item', async () => {
		const r = parseLayout(JSON.parse(readFileSync('docs/examples/camp.layout.json', 'utf8')));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const lb = buildLayout(r.layout, resolve);
		expect(critiqueLayout(lb).filter((i) => i.severity !== 'info')).toEqual([]);
		const small = buildLayout(L({ items: [{ id: 'a', scene: 'barrel', position: [0, 0] }, { id: 'b', scene: 'potion', position: [1, 0], rotation: 45 }] }), resolve);
		const g = exportGlb(small.merged, { rig: false });
		expect((g.json.nodes as { name: string }[]).map((n) => n.name)).toEqual(expect.arrayContaining(['a', 'b']));
		const report = await validator.validateBytes(g.glb, { maxIssues: 10 });
		expect(report.issues.numErrors).toBe(0);
	}, 60_000);

	it('rejects empty layouts and duplicate ids', () => {
		expect(parseLayout(L({})).ok).toBe(false);
		const d = parseLayout(L({ items: [{ id: 'a', scene: 'barrel', position: [0, 0] }, { id: 'a', scene: 'barrel', position: [1, 0] }] }));
		expect(!d.ok && d.error).toMatch(/duplicate id "a"/);
	});
});
