import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { buildScene } from '../core/build.js';
import { compile, presetAt } from '../core/compile.js';
import { FORMAT, parseScene, type Scene } from '../core/schema.js';
import { simplifyBuild } from '../core/simplify.js';
import { exportGlb } from '../export/gltf.js';
import { chartTangent, writeMaps } from '../export/texture.js';
import { PRESETS } from '../core/materials.js';

type V3 = [number, number, number];
const scene = (preset: object, shape: object = { type: 'box', size: [1, 1, 1] }): Scene => {
	const r = parseScene({ format: FORMAT, name: 'maps', settings: { resolution: 96 }, parts: [{ id: 'a', shape, position: [0, 0.5, 0], material: { color: '#a8452f', preset } }] });
	if (!r.ok) throw new Error(r.error);
	return r.scene;
};

describe('material presets', () => {
	it('every kind builds and changes the colour across the surface', () => {
		for (const kind of PRESETS) {
			const b = buildScene(scene({ kind }));
			const c = b.meshes[0].colors;
			let lo = Infinity, hi = -Infinity;
			for (let i = 0; i < c.length; i += 3) {
				const l = c[i] + c[i + 1] + c[i + 2];
				lo = Math.min(lo, l);
				hi = Math.max(hi, l);
			}
			expect(hi - lo, kind).toBeGreaterThan(0.03);
		}
	});

	it('moves with the part: the pattern is in the part\'s own frame', () => {
		const a = compile(scene({ kind: 'brick' })).prims[0];
		const moved = compile({ ...scene({ kind: 'brick' }), parts: [{ ...scene({ kind: 'brick' }).parts[0], position: [3, 0.5, 0] }] }).prims[0];
		const n: V3 = [0, 0, 1];
		for (const [x, y] of [[0.1, 0.2], [0.33, 0.61], [-0.2, 0.44]])
			expect(presetAt(moved, [x + 3, y, 0.5], n)!.height).toBeCloseTo(presetAt(a, [x, y, 0.5], n)!.height, 9);
	});
});

describe('normal maps', () => {
	/**
	 * The engine rebuilds the surface normal from the map as T·x + B·y + N·z with
	 * B = cross(N, T)·w (glTF). That normal must lean down the slope of the relief.
	 */
	it('decode, through our tangents, to normals that lean down the relief', () => {
		const pr = compile(scene({ kind: 'cobbles', relief: 1 })).prims[0];
		const texel = 0.004;
		let checked = 0;
		for (const [N, ua, va] of [[[0, 0, 1], 0, 1], [[1, 0, 0], 2, 1], [[0, 1, 0], 0, 2], [[0, 0, -1], 0, 1]] as [V3, number, number][]) {
			for (let i = 0; i < 60; i++) {
				const p: V3 = [N[0] * 0.5 + (N[0] ? 0 : Math.sin(i * 1.7) * 0.4), 0.5 + N[1] * 0.5 + (N[1] ? 0 : Math.cos(i * 2.3) * 0.4), N[2] * 0.5 + (N[2] ? 0 : Math.sin(i * 0.9 + 1) * 0.4)];
				const nrm = new Float32Array(3), orm = new Float32Array(3);
				writeMaps(0, pr, p, N, ua, va, texel, nrm, orm);
				const [tx, ty, tz] = nrm;
				const [Tx, Ty, Tz, w] = chartTangent(N, ua, va);
				const T: V3 = [Tx, Ty, Tz];
				const B: V3 = [(N[1] * T[2] - N[2] * T[1]) * w, (N[2] * T[0] - N[0] * T[2]) * w, (N[0] * T[1] - N[1] * T[0]) * w];
				const n: V3 = [T[0] * tx + B[0] * ty + N[0] * tz, T[1] * tx + B[1] * ty + N[1] * tz, T[2] * tx + B[2] * ty + N[2] * tz];
				// the relief's slope in the world, measured independently
				const h = (q: V3) => presetAt(pr, q, N)!.height;
				const grad = [0, 1, 2].map((a) => {
					if (N[a]) return 0;
					const d: V3 = [0, 0, 0];
					d[a] = texel;
					return (h([p[0] + d[0], p[1] + d[1], p[2] + d[2]]) - h([p[0] - d[0], p[1] - d[1], p[2] - d[2]])) / (2 * texel);
				});
				const g = Math.hypot(...grad);
				if (g < 1) continue; // flat here
				// the tilt (n minus the plain normal) points against the gradient
				const tilt = [n[0] - N[0] * tz, n[1] - N[1] * tz, n[2] - N[2] * tz];
				expect(tilt[0] * grad[0] + tilt[1] * grad[1] + tilt[2] * grad[2]).toBeLessThan(0);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(40);
	});

	it('export with tangents, a normal and an ORM map, and pass the validator without warnings', async () => {
		const b = await simplifyBuild(buildScene(scene({ kind: 'brick', relief: 1 })), { triangles: 3000 });
		const g = exportGlb(b, { texture: 256 });
		const rep = await validator.validateBytes(g.glb);
		expect(rep.issues.numErrors).toBe(0);
		expect(rep.issues.numWarnings, JSON.stringify(rep.issues.messages.slice(0, 2))).toBe(0);
		const mat = (g.json.materials as { normalTexture?: unknown; pbrMetallicRoughness: { metallicRoughnessTexture?: unknown } }[])[0];
		expect(mat.normalTexture).toBeDefined();
		expect(mat.pbrMetallicRoughness.metallicRoughnessTexture).toBeDefined();
		const prim = (g.json.meshes as { primitives: { attributes: Record<string, number> }[] }[])[0].primitives[0];
		expect(prim.attributes.TANGENT).toBeTypeOf('number');
		expect((g.json.images as unknown[]).length).toBe(3);
	});

	it('leave models without presets as they were', () => {
		const r = parseScene({ format: FORMAT, name: 'plain', parts: [{ id: 'a', shape: { type: 'sphere', radius: 0.3 } }] });
		if (!r.ok) throw new Error(r.error);
		const g = exportGlb(buildScene(r.scene), { texture: 128 });
		expect((g.json.images as unknown[]).length).toBe(1);
	});
});
