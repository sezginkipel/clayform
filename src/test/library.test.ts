import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { applyOps } from '../core/ops.js';
import { critique } from '../critic/critics.js';
import { LIBRARY } from '../library/parts.js';
import { getTemplate } from '../templates/index.js';
import { scene } from './helpers.js';

const body = () => scene([{ id: 'body', shape: { type: 'box', size: [0.5, 0.5, 0.5], rounding: 0.12 }, position: [0, 0.25, 0], material: { color: '#c9b8a6' } }], { settings: { resolution: 90 } });

describe('part library', () => {
	for (const lp of LIBRARY)
		it(`${lp.name} attaches cleanly`, () => {
			const r = applyOps(body(), [{ op: 'add_library_part', name: lp.name, id: 'x', attach: { to: 'body' } }]);
			expect(r.ok, r.ok ? '' : r.error).toBe(true);
			if (!r.ok) return;
			const bad = critique(buildScene(r.scene)).issues.filter((i) => i.severity === 'error' || (i.severity === 'warn' && i.code !== 'same-silhouette'));
			expect(bad.map((i) => i.message)).toEqual([]);
		});

	it('pairs mirror, parts without a color take the color they sit on, ids are prefixed', () => {
		const r = applyOps(getTemplate('biped')!.scene, [
			{ op: 'update_part', id: 'eye', set: { hidden: true } },
			{ op: 'add_library_part', name: 'eye_cartoon', id: 'big_eye', attach: { to: 'head' } },
			{ op: 'add_library_part', name: 'nose_pointy', id: 'long_nose', attach: { to: 'head', offset: [0, -0.2] } }
		]);
		expect(r.ok, r.ok ? '' : r.error).toBe(true);
		if (!r.ok) return;
		const ids = r.scene.parts.map((p) => p.id);
		expect(ids).toEqual(expect.arrayContaining(['big_eye', 'big_eye_pupil', 'big_eye_shine', 'long_nose']));
		expect(r.scene.parts.find((p) => p.id === 'big_eye')!.mirror).toBe(true);
		expect(r.scene.parts.find((p) => p.id === 'long_nose')!.material?.color).toBe('skin');
	});

	it('explains mistakes', () => {
		const a = applyOps(body(), [{ op: 'add_library_part', name: 'nope', id: 'x', attach: { to: 'body' } }]);
		expect(!a.ok && a.error).toMatch(/no library part "nope"/);
		const b = applyOps(body(), [{ op: 'add_library_part', name: 'wheel', id: 'x', attach: { to: 'ghost' } }]);
		expect(!b.ok && b.error).toMatch(/no part "ghost"/);
	});
});
