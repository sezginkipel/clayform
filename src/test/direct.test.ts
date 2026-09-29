import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { buildScene, type MeshData } from '../core/build.js';
import { FORMAT, parseScene, type Scene } from '../core/schema.js';
import { exportGlb } from '../export/gltf.js';

const scene = (parts: unknown[]): Scene => {
	const r = parseScene({ format: FORMAT, name: 'direct', settings: { resolution: 64 }, parts });
	if (!r.ok) throw new Error(r.error);
	return r.scene;
};
const meshOf = (b: ReturnType<typeof buildScene>, id: string) => b.meshes.find((m) => m.name === id)!;
const extent = (m: MeshData, a: number) => {
	let lo = Infinity, hi = -Infinity;
	for (let i = a; i < m.positions.length; i += 3) {
		lo = Math.min(lo, m.positions[i]);
		hi = Math.max(hi, m.positions[i]);
	}
	return hi - lo;
};
/** Every edge used by exactly two triangles: the surface is closed. */
const closed = (m: MeshData) => {
	const key = (a: number, b: number) => {
		const pa = Array.from(m.positions.slice(a * 3, a * 3 + 3), (v) => v.toFixed(5)).join();
		const pb = Array.from(m.positions.slice(b * 3, b * 3 + 3), (v) => v.toFixed(5)).join();
		return pa < pb ? pa + '|' + pb : pb + '|' + pa;
	};
	const count = new Map<string, number>();
	for (let t = 0; t < m.indices.length; t += 3)
		for (let k = 0; k < 3; k++) {
			const e = key(m.indices[t + k], m.indices[t + ((k + 1) % 3)]);
			count.set(e, (count.get(e) ?? 0) + 1);
		}
	return [...count.values()].every((n) => n === 2);
};

describe('sheets', () => {
	it('are as thin as asked, closed, and far thinner than a grid could make them', () => {
		const b = buildScene(scene([{ id: 'card', shape: { type: 'sheet', size: [0.6, 0.4], thickness: 0.003 }, position: [0, 0.3, 0] }]));
		const m = meshOf(b, 'card');
		expect(extent(m, 2)).toBeCloseTo(0.003, 5);
		expect(extent(m, 0)).toBeCloseTo(0.6, 5);
		expect(b.cell).toBeGreaterThan(0.003 * 2);
		expect(closed(m)).toBe(true);
	});

	it('bend curls toward +Z and wave ripples', () => {
		const bent = meshOf(buildScene(scene([{ id: 'leaf', shape: { type: 'sheet', size: [0.2, 0.4], bend: 90 } }])), 'leaf');
		expect(extent(bent, 2)).toBeGreaterThan(0.05);
		expect(extent(bent, 1)).toBeLessThan(0.4);
		const flag = meshOf(buildScene(scene([{ id: 'flag', shape: { type: 'sheet', size: [0.8, 0.5], wave: { amplitude: 0.04, length: 0.4 } } }])), 'flag');
		expect(extent(flag, 2)).toBeCloseTo(0.08 + 0.004, 2);
	});

	it('a mirrored sheet still faces out', () => {
		const b = buildScene(scene([
			{ id: 'body', shape: { type: 'box', size: [0.3, 0.3, 0.3] }, position: [0, 0.15, 0] },
			{ id: 'wing', shape: { type: 'sheet', size: [0.3, 0.2] }, rotation: [0, 90, 0], attach: { to: 'body', side: 'left', embed: 0.5 }, mirror: true }
		]));
		for (const id of ['wing', 'wing.m']) {
			const m = meshOf(b, id);
			// on a closed sheet, each face's normal points away from the sheet's middle
			const c = [0, 1, 2].map((a) => { let s = 0; for (let i = a; i < m.positions.length; i += 3) s += m.positions[i]; return s / (m.positions.length / 3); });
			let out = 0;
			for (let t = 0; t < m.indices.length; t += 3) {
				const [a, bb, cc] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]);
				const u = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]], v = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
				const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
				const mid = [(a[0] + bb[0] + cc[0]) / 3 - c[0], (a[1] + bb[1] + cc[1]) / 3 - c[1], (a[2] + bb[2] + cc[2]) / 3 - c[2]];
				out += Math.sign(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]);
			}
			expect(out, id).toBeGreaterThan(0);
		}
	});

	it('export as valid glTF', async () => {
		const b = buildScene(scene([{ id: 'pole', shape: { type: 'cylinder', height: 1.5, radius: 0.03 }, position: [0, 0.75, 0] }, { id: 'flag', shape: { type: 'sheet', size: [0.6, 0.4], wave: { amplitude: 0.03, length: 0.3 } }, attach: { to: 'pole', side: 'left', offset: [0, 0.7], embed: 1 }, position: [0.3, 0, 0] }]));
		const rep = await validator.validateBytes(exportGlb(b).glb);
		expect(rep.issues.numErrors).toBe(0);
	});
});

describe('kept meshes', () => {
	it('keep the file\'s own triangles and their sharp edges', () => {
		const grid = buildScene(scene([{ id: 'crate', shape: { type: 'mesh', src: 'docs/examples/crate.obj', size: 0.8 } }]));
		const kept = buildScene(scene([{ id: 'crate', shape: { type: 'mesh', src: 'docs/examples/crate.obj', size: 0.8, keep: true } }]));
		const m = meshOf(kept, 'crate');
		expect(m.indices.length / 3).toBe(12);
		expect(grid.stats.triangles).toBeGreaterThan(1000);
		// same size either way
		expect(extent(m, 1)).toBeCloseTo(extent(meshOf(grid, 'body'), 1), 1);
		// the faces are flat: each vertex normal is one of the six axis directions
		for (let v = 0; v < m.normals.length; v += 3) expect(Math.max(...[0, 1, 2].map((a) => Math.abs(m.normals[v + a])))).toBeCloseTo(1, 5);
	});
});
