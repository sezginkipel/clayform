import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { FORMAT, type Scene } from '../core/schema.js';
import { simplifyBuild } from '../core/simplify.js';

const one = (shape: unknown, rotation?: number[]): Scene => ({
	format: FORMAT,
	name: 'one',
	settings: { resolution: 64, edges: 'sharp' },
	parts: [{ id: 'a', shape: shape as never, rotation: rotation as never }]
});

describe('simplification', () => {
	it('reduces tilted flat shapes with sharp edges to their few real faces', async () => {
		const tilted = await simplifyBuild(buildScene(one({ type: 'box', size: [1, 0.6, 0.8] }, [0, 0, 20])), { triangles: 12 });
		expect(tilted.stats.triangles).toBe(12);
		const pyramid = await simplifyBuild(buildScene(one({ type: 'cone', height: 0.3, radius: 0.5, sides: 4 })), { triangles: 6 });
		expect(pyramid.stats.triangles).toBe(6);
	});

	it('never lets a separate part vanish to meet a budget, and says the budget was missed', async () => {
		// a wall with 30 separate little windows: 30 × 12 triangles cannot fit in 100
		const parts: unknown[] = [{ id: 'wall', shape: { type: 'box', size: [3, 2, 0.2] }, position: [0, 1, 0] }];
		for (let i = 0; i < 30; i++)
			parts.push({ id: `w${i}`, shape: { type: 'box', size: [0.12, 0.16, 0.04] }, position: [-1.3 + (i % 10) * 0.29, 0.4 + Math.floor(i / 10) * 0.6, 0.11], separate: true });
		const b = buildScene({ format: FORMAT, name: 'windows', settings: { resolution: 96, edges: 'sharp' }, parts: parts as never });
		const s = await simplifyBuild(b, { triangles: 100 });
		expect(s.meshes.length).toBe(31);
		for (const m of s.meshes) expect(m.indices.length / 3).toBeGreaterThanOrEqual(12);
		expect(s.simplified?.overBudget).toBe(true);
	});

	it('fits a body and its separate wheel in a tight budget, both kept', async () => {
		// one error for both: the flat body collapses to a few faces and the round wheel keeps what it needs
		const b = buildScene({
			format: FORMAT,
			name: 'cart',
			settings: { resolution: 96 },
			parts: [
				{ id: 'body', shape: { type: 'box', size: [2, 0.6, 1], rounding: 0.05 }, position: [0, 0.6, 0] },
				{ id: 'wheel', shape: { type: 'cylinder', height: 0.08, radius: 0.18 }, rotation: [0, 0, 90], position: [1.05, 0.2, 0.4], separate: true }
			] as never
		});
		const s = await simplifyBuild(b, { triangles: 300 });
		expect(s.stats.triangles).toBeLessThanOrEqual(300);
		expect(s.simplified?.overBudget).toBe(false);
		for (const m of s.meshes) expect(m.indices.length / 3).toBeGreaterThanOrEqual(12);
	});

	it('uses a budget with room to spare for a finer model than the default', async () => {
		const b = buildScene(one({ type: 'sphere', radius: 0.5 }));
		const d = await simplifyBuild(b);
		const roomy = await simplifyBuild(b, { triangles: d.stats.triangles * 3 });
		expect(roomy.stats.triangles).toBeGreaterThan(d.stats.triangles);
		expect(roomy.simplified!.error).toBeLessThan(d.simplified!.error);
	});
});
