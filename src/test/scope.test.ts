import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { bodyField, compile } from '../core/compile.js';
import { buildSceneAsync } from '../core/parallel.js';
import { FORMAT, parseScene, type Scene } from '../core/schema.js';

const scene = (parts: unknown[]): Scene => {
	const r = parseScene({ format: FORMAT, name: 'scoped', settings: { resolution: 48 }, parts });
	if (!r.ok) throw new Error(r.error);
	return r.scene;
};
const inside = (s: Scene, p: [number, number, number]) => bodyField(compile(s), ...p) < 0;

// two walls side by side, fused; a window box that pokes through both
const walls = [
	{ id: 'wall_a', shape: { type: 'box', size: [1, 1, 0.2] }, position: [-0.5, 0.5, 0] },
	{ id: 'wall_b', shape: { type: 'box', size: [1, 1, 0.2] }, position: [0.5, 0.5, 0] }
];
const window = { id: 'window', op: 'carve', shape: { type: 'box', size: [1.2, 0.3, 0.6] }, position: [0, 0.5, 0] };

describe('carve and intersect with only', () => {
	it('without only a carve cuts everything before it', () => {
		const s = scene([...walls, window]);
		expect(inside(s, [-0.3, 0.5, 0])).toBe(false);
		expect(inside(s, [0.3, 0.5, 0])).toBe(false);
	});

	it('with only it cuts the named part and leaves the rest whole', () => {
		const s = scene([...walls, { ...window, only: 'wall_a' }]);
		expect(inside(s, [-0.3, 0.5, 0])).toBe(false); // the hole in wall_a
		expect(inside(s, [0.3, 0.5, 0])).toBe(true); // wall_b is untouched
		expect(inside(s, [-0.3, 0.9, 0])).toBe(true); // wall_a above the window
	});

	it('works when the cut comes before its target, and on a list of targets', () => {
		const s = scene([{ ...window, only: ['wall_a', 'wall_b'] }, ...walls]);
		expect(inside(s, [-0.3, 0.5, 0])).toBe(false);
		expect(inside(s, [0.3, 0.5, 0])).toBe(false);
		expect(inside(s, [-0.3, 0.9, 0])).toBe(true);
	});

	it('an intersect clips only its target', () => {
		// a dome clipped to its upper half by a box, standing next to a base that must stay whole
		const s = scene([
			{ id: 'base', shape: { type: 'box', size: [0.6, 0.2, 0.6] }, position: [0, 0.1, 0] },
			{ id: 'dome', shape: { type: 'sphere', radius: 0.3 }, position: [0, 0.2, 0] },
			{ id: 'clip', op: 'intersect', only: 'dome', shape: { type: 'box', size: [1, 0.4, 1] }, position: [0, 0.4, 0] }
		]);
		expect(inside(s, [0, 0.45, 0])).toBe(true); // top of the dome
		expect(inside(s, [0.25, 0.05, 0.25])).toBe(true); // the base corner, outside the clip box
		expect(inside(s, [0, -0.05, 0])).toBe(false); // the dome's lower half is gone (below the base too)
	});

	it('cuts both mirror twins of a mirrored target', () => {
		const s = scene([
			{ id: 'post', shape: { type: 'box', size: [0.2, 1, 0.2] }, position: [0.5, 0.5, 0], mirror: true },
			{ id: 'notch', op: 'carve', only: 'post', shape: { type: 'box', size: [1.4, 0.1, 0.4] }, position: [0, 0.5, 0] }
		]);
		expect(inside(s, [0.5, 0.5, 0])).toBe(false);
		expect(inside(s, [-0.5, 0.5, 0])).toBe(false);
		expect(inside(s, [-0.5, 0.8, 0])).toBe(true);
	});

	it('meshes the same serially and on workers', async () => {
		const s = scene([...walls, { ...window, only: 'wall_a' }]);
		const a = buildScene(s), b = await buildSceneAsync(s);
		expect(b.stats.triangles).toBe(a.stats.triangles);
	});

	it('is refused on an add or with an unknown part', () => {
		const add = parseScene({ format: FORMAT, name: 'x', parts: [...walls, { ...window, op: 'add', only: 'wall_a' }] });
		expect(add.ok).toBe(false);
		if (!add.ok) expect(add.error).toMatch(/limits a carve or an intersect/);
		const unknown = parseScene({ format: FORMAT, name: 'x', parts: [...walls, { ...window, only: 'roof' }] });
		expect(unknown.ok).toBe(false);
		if (!unknown.ok) expect(unknown.error).toMatch(/unknown part "roof"/);
	});
});
