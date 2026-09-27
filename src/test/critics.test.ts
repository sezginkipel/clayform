/**
 * Every critic is proven by producing the defect on purpose and checking it is
 * caught — and by checking the templates stay clean.
 */

import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { critique } from '../critic/critics.js';
import { TEMPLATES } from '../templates/index.js';
import { ball, scene } from './helpers.js';

const codes = (s: Parameters<typeof buildScene>[0]) => critique(buildScene(s)).issues.map((i) => i.code);

describe('critics catch deliberate defects', () => {
	it('floating part', () => {
		const r = critique(buildScene(scene([ball('body', 0.3), ball('orb', 0.08, { position: [0.8, 0.2, 0] })])));
		expect(r.ok).toBe(false);
		const i = r.issues.find((x) => x.code === 'floating')!;
		expect(i.parts).toContain('orb');
	});

	it('a carve that splits a part', () => {
		const r = critique(buildScene(scene([
			{ id: 'bar', shape: { type: 'box', size: [1, 0.2, 0.2] } },
			{ id: 'cut', shape: { type: 'box', size: [0.1, 0.5, 0.5] }, op: 'carve' }
		])));
		const i = r.issues.find((x) => x.code === 'floating')!;
		expect(i.message).toMatch(/cut into separate pieces/);
	});

	it('a part buried inside another', () => {
		expect(codes(scene([ball('body', 0.4), ball('pea', 0.1, { position: [0, 0, 0] })]))).toContain('buried');
	});

	it('a part too small for the resolution', () => {
		expect(codes(scene([ball('body', 0.5), ball('dot', 0.004, { attach: { to: 'body', side: 'front' } })], { settings: { resolution: 32 } }))).toContain('too-small');
	});

	it('broken declared symmetry', () => {
		expect(codes(scene([ball('body', 0.3), ball('ear', 0.08, { attach: { to: 'body', side: 'left', offset: [0, 0.5] } })], { settings: { resolution: 64, symmetry: 'x' } }))).toContain('asymmetric');
	});

	it('a model that would tip over', () => {
		const r = critique(buildScene(scene([
			{ id: 'post', shape: { type: 'cylinder', height: 1, radius: 0.05 }, position: [0, 0.5, 0] },
			{ id: 'arm', shape: { type: 'box', size: [1.2, 0.1, 0.1] }, position: [0.6, 1, 0] },
			ball('weight', 0.25, { position: [1.2, 1, 0] })
		])));
		const i = r.issues.find((x) => x.code === 'tips-over')!;
		expect(i.message).toMatch(/\+x/);
	});

	it('an over-budget mesh with a resolution suggestion', () => {
		const r = critique(buildScene(scene([ball('s', 0.5)], { settings: { resolution: 64, budget: 500 } })));
		expect(r.issues.find((x) => x.code === 'over-budget')?.message).toMatch(/resolution \d+ would fit/);
	});

	it('independently moving parts that fuse (animation)', () => {
		expect(codes(scene([
			ball('body', 0.3, { role: 'body' }),
			{ id: 'leg', role: 'leg', shape: { type: 'capsule', length: 0.3, radius: 0.06 }, attach: { to: 'body', side: 'bottom', offset: [0.6, 0] }, blend: 0.03, mirror: true },
			// hangs so low its tip lies against the leg
			{ id: 'arm', role: 'arm', shape: { type: 'capsule', length: 0.45, radius: 0.05 }, attach: { to: 'body', side: 'left', embed: 0.9 }, position: [-0.05, -0.22, 0], blend: 0.05, mirror: true }
		], { clips: [{ id: 'walk', type: 'walk' }] }))).toContain('fused-unrelated');
	});

	it('a separate part hanging in the air', () => {
		expect(codes(scene([ball('body', 0.3), ball('wheel', 0.1, { position: [0.8, 0.6, 0], separate: true })]))).toContain('separate-gap');
	});
});

describe('templates are clean', () => {
	it('no template has errors or warnings', () => {
		for (const t of TEMPLATES) {
			const r = critique(buildScene(t.scene));
			const bad = r.issues.filter((i) => i.severity !== 'info');
			expect(bad, `${t.id}: ${bad.map((b) => b.message).join(' | ')}`).toEqual([]);
		}
	}, 60_000);
});
