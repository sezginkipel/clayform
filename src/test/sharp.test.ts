import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { buildScene } from '../core/build.js';
import { simplifyBuild } from '../core/simplify.js';
import { critique } from '../critic/critics.js';
import { exportGlb } from '../export/gltf.js';
import { getTemplate } from '../templates/index.js';
import { scene } from './helpers.js';

const box = (edges: 'soft' | 'sharp') => buildScene(scene([{ id: 'box', shape: { type: 'box', size: [1, 1, 1] } }], { settings: { resolution: 48, edges } }));

function cornerGap(b: ReturnType<typeof box>): number {
	const P = b.meshes[0].positions;
	let worst = 0;
	for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) {
		let best = Infinity;
		for (let i = 0; i < P.length; i += 3) best = Math.min(best, Math.hypot(P[i] - x, P[i + 1] - y, P[i + 2] - z));
		worst = Math.max(worst, best);
	}
	return worst / b.cell;
}

describe('sharp edges (dual contouring)', () => {
	it('puts vertices on the corners of a box', () => {
		expect(cornerGap(box('soft'))).toBeGreaterThan(0.5);
		expect(cornerGap(box('sharp'))).toBeLessThan(0.15);
	});

	it('faces along an edge lie flat on one side or the other (dihedral ≈ 90°)', () => {
		const b = box('sharp');
		const { positions: P, indices: I } = b.meshes[0];
		let near = 0, flat = 0;
		for (let t = 0; t < I.length; t += 3) {
			const a = I[t] * 3, c = I[t + 1] * 3, d = I[t + 2] * 3;
			const cy = (P[a + 1] + P[c + 1] + P[d + 1]) / 3, cz = (P[a + 2] + P[c + 2] + P[d + 2]) / 3;
			// faces within one cell of the top-front edge (y = 1, z = 0.5)
			if (Math.hypot(cy - 1, cz - 0.5) > b.cell) continue;
			near++;
			const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
			const vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
			const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
			const l = Math.hypot(nx, ny, nz) || 1;
			if (Math.max(Math.abs(ny), Math.abs(nz)) / l > 0.97) flat++;
		}
		expect(near).toBeGreaterThan(20);
		expect(flat / near).toBeGreaterThan(0.9);
	});

	it('keeps the size within one cell and the body in one piece', () => {
		const b = box('sharp');
		[0, 1, 2].forEach((a) => expect(Math.abs(b.max[a] - b.min[a] - 1)).toBeLessThan(b.cell));
		const r = critique(b);
		expect(r.stats.islands).toBe(1);
		expect(r.issues.filter((i) => i.severity !== 'info')).toEqual([]);
	});

	it('exports valid glTF with split normals', async () => {
		const b = await simplifyBuild(buildScene(getTemplate('house')!.scene));
		const report = await validator.validateBytes(exportGlb(b).glb, { maxIssues: 20 });
		expect(report.issues.numErrors).toBe(0);
	});
});
