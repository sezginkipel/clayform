import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { buildScene } from '../core/build.js';
import { FORMAT, parseScene, type Shape } from '../core/schema.js';
import { shapeBounds, shapeSdf } from '../core/sdf.js';
import { simplifyBuild } from '../core/simplify.js';
import { critique } from '../critic/critics.js';
import { exportGlb } from '../export/gltf.js';

const sdf = (s: unknown) => {
	const r = parseScene({ format: FORMAT, name: 'x', parts: [{ id: 'a', shape: s }] });
	if (!r.ok) throw new Error(r.error);
	const shape = r.scene.parts[0].shape as Shape;
	return { f: shapeSdf(shape), bounds: shapeBounds(shape) };
};

describe('lathe', () => {
	const { f, bounds } = sdf({ type: 'lathe', profile: [[0.2, 0], [0.2, 0.5], [0.1, 1]] });
	it('has the profile radius at each height, measured exactly', () => {
		expect(f(0.2, 0.25, 0)).toBeCloseTo(0, 6);
		expect(f(0, 0.25, 0.3)).toBeCloseTo(0.1, 6);
		expect(f(0.15, 0.75, 0)).toBeCloseTo(0, 2);
		expect(f(0, 0.5, 0)).toBeLessThan(0);
		expect(bounds.max[1]).toBe(1);
	});
	it('with a shell it is an open-topped wall', () => {
		const cup = sdf({ type: 'lathe', shell: 0.02, profile: [[0.2, 0], [0.2, 0.5]] }).f;
		expect(cup(0.2, 0.25, 0)).toBeLessThan(0); // inside the wall
		expect(cup(0, 0.3, 0)).toBeGreaterThan(0.1); // the hollow middle
		expect(cup(0, 0, 0)).toBeLessThan(0); // the closed bottom
	});
	it('smooth runs a curve through the points', () => {
		const sharp = sdf({ type: 'lathe', profile: [[0.1, 0], [0.3, 0.5], [0.1, 1]] }).f;
		const round = sdf({ type: 'lathe', smooth: true, profile: [[0.1, 0], [0.3, 0.5], [0.1, 1]] }).f;
		// at a quarter height the curve bulges past the straight segment
		expect(round(0.2, 0.25, 0)).toBeLessThan(sharp(0.2, 0.25, 0));
	});
});

describe('extrude', () => {
	const square = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
	it('is the outline pushed along Z', () => {
		const { f } = sdf({ type: 'extrude', outline: square, depth: 0.2 });
		expect(f(0, 0, 0)).toBeCloseTo(-0.1, 6);
		expect(f(0.7, 0, 0)).toBeCloseTo(0.2, 6);
		expect(f(0, 0, 0.3)).toBeCloseTo(0.2, 6);
	});
	it('a bevel cuts the rim', () => {
		const plain = sdf({ type: 'extrude', outline: square, depth: 0.2 }).f;
		const bev = sdf({ type: 'extrude', outline: square, depth: 0.2, bevel: 0.05 }).f;
		expect(plain(0.49, 0, 0.09)).toBeLessThan(0);
		expect(bev(0.49, 0, 0.09)).toBeGreaterThan(0);
	});
	it('a taper shrinks the front face', () => {
		const { f } = sdf({ type: 'extrude', outline: square, depth: 0.2, taper: 0.5 });
		expect(f(0.4, 0, -0.099)).toBeLessThan(0);
		expect(f(0.4, 0, 0.099)).toBeGreaterThan(0);
	});
});

describe('text', () => {
	it('lights the strokes and leaves the gaps', () => {
		const { f, bounds } = sdf({ type: 'text', text: 'I', height: 0.7, depth: 0.05 });
		// the I is a centre stroke 0.1 wide: the middle is solid, beside it is air
		expect(f(0, 0, 0)).toBeLessThan(0);
		expect(f(0.15, 0, 0)).toBeGreaterThan(0);
		expect(bounds.max[1]).toBeCloseTo(0.35, 6);
	});
});

describe('terrain', () => {
	it('stays inside its tile and above its base', () => {
		const { f, bounds } = sdf({ type: 'terrain', size: [4, 3], height: 0.5, seed: 2 });
		expect(bounds.max[1]).toBe(0.5);
		expect(f(2.2, 0, 0)).toBeGreaterThan(0);
		expect(f(0, -0.2, 0)).toBeGreaterThan(0);
		expect(f(0, -0.02, 0)).toBeLessThan(0);
	});
});

describe('the new shapes as parts', () => {
	it('build, pass the critics and export valid glTF', async () => {
		const r = parseScene({
			format: FORMAT,
			name: 'shop sign',
			settings: { resolution: 90 },
			parts: [
				{ id: 'post', shape: { type: 'lathe', smooth: true, profile: [[0.08, 0], [0.06, 0.1], [0.04, 1.2]] }, material: { color: '#5a4030' } },
				{ id: 'board', shape: { type: 'extrude', depth: 0.05, rounding: 0.01, outline: [[-0.4, -0.15], [0.4, -0.15], [0.45, 0], [0.4, 0.15], [-0.4, 0.15], [-0.45, 0]] }, attach: { to: 'post', side: 'top', embed: 0.5 }, material: { color: '#6b4a2b' } },
				{ id: 'word', shape: { type: 'text', text: 'SHOP', height: 0.14, depth: 0.05 }, attach: { to: 'board', side: 'front', embed: 0.5 }, material: { color: '#f2d27a' } },
				{ id: 'ground', shape: { type: 'terrain', size: [1.2, 1.2], height: 0.08, seed: 4 }, position: [0, -0.05, 0], material: { color: '#6a9a4a' } }
			]
		});
		expect(r.ok, r.ok ? '' : r.error).toBe(true);
		if (!r.ok) return;
		const b = buildScene(r.scene);
		expect(critique(b).issues.filter((i) => i.severity === 'error')).toEqual([]);
		const rep = await validator.validateBytes(exportGlb(await simplifyBuild(b, { triangles: 3000 })).glb);
		expect(rep.issues.numErrors).toBe(0);
	});
});
