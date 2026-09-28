import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { applyOps } from '../core/ops.js';
import { critique } from '../critic/critics.js';
import { contrastRatio, deltaE } from '../critic/readability.js';
import { getTemplate } from '../templates/index.js';
import { ball, scene } from './helpers.js';

const codes = (s: Parameters<typeof buildScene>[0]) => critique(buildScene(s)).issues;

describe('color math', () => {
	it('matches known values', () => {
		expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 1);
		expect(deltaE([1, 0, 0], [1, 0, 0])).toBe(0);
		expect(deltaE([1, 1, 1], [0, 0, 0])).toBeCloseTo(100, 0);
	});
});

describe('readability critics', () => {
	const pair = (a: string, b: string) => scene([
		{ id: 'crate', shape: { type: 'box', size: [0.5, 0.4, 0.4] }, material: { color: a } },
		{ id: 'lid', shape: { type: 'box', size: [0.52, 0.08, 0.42] }, attach: { to: 'crate', side: 'top', embed: 0.3 }, material: { color: b } }
	]);

	it('flags neighbours whose colors differ but cannot be told apart, and suggests one', () => {
		const i = codes(pair('#7a5a3a', '#7e5d3c')).find((x) => x.code === 'colors-blend');
		expect(i?.parts).toEqual(expect.arrayContaining(['crate', 'lid']));
		expect(i?.message).toMatch(/try #[0-9a-f]{6}/);
	});

	it('leaves the same color on purpose, and clearly different colors, alone', () => {
		expect(codes(pair('#7a5a3a', '#7a5a3a')).some((x) => x.code === 'colors-blend')).toBe(false);
		expect(codes(pair('#7a5a3a', '#d8c070')).some((x) => x.code === 'colors-blend')).toBe(false);
	});

	it('flags details a player cannot see at the game camera size', () => {
		const at = (h: number) => {
			const r = applyOps(getTemplate('biped')!.scene, [{ op: 'set_settings', set: { screenHeight: h } }]);
			if (!r.ok) throw new Error(r.error);
			return critique(buildScene(r.scene)).issues.filter((x) => x.code === 'tiny-detail').flatMap((x) => x.parts ?? []);
		};
		expect(at(20)).toEqual(expect.arrayContaining(['eye']));
		expect(at(512)).toEqual([]);
	});

	it('warns when a creature looks the same from the front and the side', () => {
		const legs = [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]].map(([u, v], k) => ({
			id: `leg${k}`, role: 'leg', shape: { type: 'capsule' as const, length: 0.3, radius: 0.05 }, attach: { to: 'body', side: 'bottom' as const, offset: [u, v] as [number, number] }
		}));
		const issue = codes(scene([ball('body', 0.3), ...legs])).find((x) => x.code === 'same-silhouette');
		expect(issue?.severity).toBe('warn');
		expect(codes(getTemplate('quadruped')!.scene).some((x) => x.code === 'same-silhouette')).toBe(false);
	});
});
