import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { buildSceneAsync } from '../core/parallel.js';
import { getTemplate } from '../templates/index.js';

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => v === b[i]);

describe('parallel builds', () => {
	// soft and sharp, fused and separate parts, patterns and sculpts
	for (const id of ['slime', 'house', 'car'])
		it(`${id}: identical to a serial build, vertex for vertex`, async () => {
			const scene = getTemplate(id)!.scene;
			const a = buildScene(scene), b = await buildSceneAsync(scene);
			expect(b.meshes.length).toBe(a.meshes.length);
			a.meshes.forEach((m, i) => {
				const n = b.meshes[i];
				for (const k of ['positions', 'normals', 'colors', 'ao', 'indices', 'vertPrim', 'triPrim', 'joints', 'weights'] as const) expect(same(m[k], n[k]), `${id} ${m.name} ${k}`).toBe(true);
			});
			expect(b.stats.triangles).toBe(a.stats.triangles);
		}, 60_000);
});
