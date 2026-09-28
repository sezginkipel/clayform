import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { buildScene } from '../core/build.js';
import { simplifyBuild } from '../core/simplify.js';
import { exportGlb } from '../export/gltf.js';
import { convexHull } from '../export/hull.js';
import { getTemplate } from '../templates/index.js';

describe('convex hull', () => {
	it('is convex and covers the input to within one thinning cell', () => {
		const pts: [number, number, number][] = [];
		for (let i = 0; i < 400; i++) {
			const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.cbrt(Math.random());
			pts.push([Math.sqrt(1 - u * u) * Math.cos(t) * r, u * r * 0.5, Math.sqrt(1 - u * u) * Math.sin(t) * r]);
		}
		const h = convexHull(pts)!;
		expect(h.indices.length / 3).toBeGreaterThan(20);
		expect(h.positions.length / 3).toBeLessThanOrEqual(255);
		const P = h.positions;
		let worst = -Infinity;
		for (let t = 0; t < h.indices.length; t += 3) {
			const a = h.indices[t] * 3, b = h.indices[t + 1] * 3, c = h.indices[t + 2] * 3;
			const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
			const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
			const l = Math.hypot(n[0], n[1], n[2]);
			// every point on or behind every face
			for (const p of pts) worst = Math.max(worst, ((p[0] - P[a]) * n[0] + (p[1] - P[a + 1]) * n[1] + (p[2] - P[a + 2]) * n[2]) / l);
		}
		// thinning cell: 2 m across / 14 cells
		expect(worst).toBeLessThan(2 / 14);
	});

	it('refuses flat input', () => {
		expect(convexHull([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0.5, 0.5, 0]])).toBeNull();
	});
});

describe('LODs and colliders in glTF', () => {
	it('writes decreasing LODs and one convex collider per part, named for the engine, with zero validator errors', async () => {
		const full = buildScene(getTemplate('chest')!.scene);
		const b = await simplifyBuild(full);
		const lods = [await simplifyBuild(full, { triangles: Math.round(b.stats.triangles * 0.5) }), await simplifyBuild(full, { triangles: Math.round(b.stats.triangles * 0.2) })];
		expect(lods[0].stats.triangles).toBeLessThan(b.stats.triangles);
		expect(lods[1].stats.triangles).toBeLessThan(lods[0].stats.triangles);
		for (const engine of ['godot', 'unreal', 'unity', 'plain'] as const) {
			const r = exportGlb(b, { lods, collision: 'parts', naming: engine });
			const names = (r.json.nodes as { name: string }[]).map((n) => n.name);
			expect(names).toEqual(expect.arrayContaining(['body_LOD0', 'body_LOD1', 'body_LOD2']));
			const colliders = names.filter((n) => (engine === 'godot' ? n.endsWith('-convcolonly') : engine === 'unreal' ? n.startsWith('UCX_') : engine === 'unity' ? n.endsWith('_collider') : n.endsWith('_collision')));
			expect(colliders.length).toBe(r.stats.colliders);
			expect(r.stats.colliders).toBeGreaterThanOrEqual(5);
			const report = await validator.validateBytes(r.glb, { maxIssues: 20 });
			expect(report.issues.numErrors, JSON.stringify(report.issues.messages.slice(0, 3))).toBe(0);
		}
	}, 60_000);

	it('a single hull for the whole model', () => {
		const r = exportGlb(buildScene(getTemplate('barrel')!.scene), { collision: 'hull' });
		expect(r.stats.colliders).toBe(1);
	});
});
