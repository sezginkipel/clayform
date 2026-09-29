import { describe, expect, it } from 'vitest';
import { buildRig, critiqueClip, legChains, sampleClip } from '../anim/rig.js';
import { buildScene } from '../core/build.js';
import { compile } from '../core/compile.js';
import { FORMAT, parseScene, type Scene } from '../core/schema.js';
import { critique } from '../critic/critics.js';

const scene = (parts: unknown[], extra: object = {}): Scene => {
	const r = parseScene({ format: FORMAT, name: 'copies', settings: { resolution: 64 }, parts, ...extra });
	if (!r.ok) throw new Error(r.error);
	return r.scene;
};
const centre = (p: { min: number[]; max: number[] }) => p.min.map((v, i) => (v + p.max[i]) / 2);

describe('repeat', () => {
	it('steps copies of the part and of what is attached to it', () => {
		const c = compile(
			scene([
				{ id: 'wall', shape: { type: 'box', size: [3, 1, 0.2] }, position: [0, 0.5, 0] },
				{ id: 'post', shape: { type: 'box', size: [0.1, 0.4, 0.1] }, attach: { to: 'wall', side: 'top', offset: [-0.8, 0] }, repeat: { count: 4, step: [0.5, 0, 0] } },
				{ id: 'cap', shape: { type: 'sphere', radius: 0.06 }, attach: { to: 'post', side: 'top' } }
			])
		);
		const posts = c.prims.filter((p) => p.partId === 'post');
		const caps = c.prims.filter((p) => p.partId === 'cap');
		expect(posts.map((p) => p.id)).toEqual(['post', 'post.2', 'post.3', 'post.4']);
		expect(caps.length).toBe(4);
		posts.forEach((p, k) => expect(p.pos[0] - posts[0].pos[0]).toBeCloseTo(0.5 * k, 6));
		// each cap sits on its own post and hangs from it in the rig
		caps.forEach((cap, k) => {
			expect(cap.pos[0]).toBeCloseTo(posts[k].pos[0], 6);
			expect(c.prims[cap.parent].id).toBe(posts[k].id);
		});
	});

	it('turns copies around a part, keeping their distance from its centre', () => {
		const c = compile(
			scene([
				{ id: 'floor', shape: { type: 'cylinder', height: 0.2, radius: 1.2 }, position: [0, 0.1, 0] },
				{ id: 'column', shape: { type: 'cylinder', height: 1, radius: 0.08 }, position: [1, 0.7, 0], repeat: { count: 6, turn: 60, around: 'floor' } }
			])
		);
		const cols = c.prims.filter((p) => p.partId === 'column');
		expect(cols.length).toBe(6);
		for (const p of cols) expect(Math.hypot(p.pos[0], p.pos[2])).toBeCloseTo(1, 6);
		expect(cols[3].pos[0]).toBeCloseTo(-1, 6); // half way round
	});

	it('makes a grid with rows, and mirrors with the twins', () => {
		const c = compile(
			scene([
				{ id: 'wall', shape: { type: 'box', size: [3, 2, 0.2] }, position: [0, 1, 0] },
				{ id: 'win', shape: { type: 'box', size: [0.2, 0.3, 0.1] }, attach: { to: 'wall', side: 'front', offset: [0.3, -0.5] }, mirror: true, repeat: { count: 3, step: [0.3, 0, 0], rows: { count: 2, step: [0, 0.6, 0] } } }
			])
		);
		const wins = c.prims.filter((p) => p.partId === 'win');
		expect(wins.length).toBe(12); // 3 × 2, and each mirrored
		const xs = wins.map((p) => Math.round(p.pos[0] * 100) / 100);
		for (const x of xs) expect(xs).toContain(-x);
	});

	it('repeated legs walk', () => {
		const s = scene(
			[
				{ id: 'body', role: 'body', shape: { type: 'capsule', length: 1.2, radius: 0.12 }, rotation: [90, 0, 0], position: [0, 0.3, 0] },
				{ id: 'leg', role: 'leg', shape: { type: 'capsule', length: 0.3, radius: 0.03 }, attach: { to: 'body', side: 'bottom', offset: [0.6, -0.6], embed: 0.5 }, mirror: true, repeat: { count: 3, step: [0, 0, 0.45] } }
			],
			{ clips: [{ id: 'walk', type: 'walk' }] }
		);
		const b = buildScene(s);
		const rig = buildRig(b);
		expect(legChains(b, rig).length).toBe(6);
		const clip = sampleClip(b, rig, s.clips![0]);
		expect(clip.speed).toBeGreaterThan(0);
		expect(critiqueClip(b, rig, clip, true).issues.filter((i) => /sinks|slides/.test(i))).toEqual([]);
	});
});

describe('scatter', () => {
	const meadow = (seed = 3) =>
		scene([
			{ id: 'ground', shape: { type: 'terrain', size: [4, 4], height: 0.3, seed: 5 } },
			{ id: 'rock', shape: { type: 'ellipsoid', radii: [0.1, 0.06, 0.08] }, scatter: { on: 'ground', count: 12, minGap: 0.3, scale: [0.8, 1.2], seed } }
		]);

	it('spreads copies over the top of the target, apart and on it', () => {
		const s = meadow();
		const c = compile(s);
		const rocks = c.prims.filter((p) => p.partId === 'rock');
		expect(rocks.length).toBe(12);
		for (const r of rocks) {
			const [x, , z] = centre(r);
			expect(Math.abs(x)).toBeLessThan(2);
			expect(Math.abs(z)).toBeLessThan(2);
		}
		for (let i = 0; i < rocks.length; i++)
			for (let j = i + 1; j < rocks.length; j++) expect(Math.hypot(rocks[i].pos[0] - rocks[j].pos[0], rocks[i].pos[2] - rocks[j].pos[2])).toBeGreaterThan(0.25);
		// sitting in the ground, not floating
		expect(critique(buildScene(s)).issues.filter((i) => i.code === 'floating')).toEqual([]);
	});

	it('is repeatable by seed and changes with it', () => {
		const a = compile(meadow(3)).prims.filter((p) => p.partId === 'rock').map((p) => p.pos);
		const b = compile(meadow(3)).prims.filter((p) => p.partId === 'rock').map((p) => p.pos);
		const c = compile(meadow(4)).prims.filter((p) => p.partId === 'rock').map((p) => p.pos);
		expect(a).toEqual(b);
		expect(a).not.toEqual(c);
	});

	it('is refused on an unknown part or together with repeat', () => {
		const bad = parseScene({ format: FORMAT, name: 'x', parts: [{ id: 'a', shape: { type: 'sphere', radius: 0.1 }, scatter: { on: 'nope', count: 3 } }] });
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.error).toMatch(/unknown part "nope"/);
		const both = parseScene({ format: FORMAT, name: 'x', parts: [{ id: 'g', shape: { type: 'box', size: [1, 0.1, 1] } }, { id: 'a', shape: { type: 'sphere', radius: 0.1 }, scatter: { on: 'g', count: 3 }, repeat: { count: 2, step: [1, 0, 0] } }] });
		expect(both.ok).toBe(false);
		if (!both.ok) expect(both.error).toMatch(/pick one/);
	});
});
