import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { clothTargets, meshMorphs } from '../anim/morph.js';
import { buildRig, sampleClip } from '../anim/rig.js';
import { buildScene } from '../core/build.js';
import { toLocal } from '../core/compile.js';
import { parseScene, type Scene } from '../core/schema.js';
import { critique } from '../critic/critics.js';
import { exportGlb } from '../export/gltf.js';
import { getTemplate } from '../templates/index.js';

function flag(extra: object = {}): Scene {
	const base = getTemplate('flagpole')!.scene;
	const r = parseScene({
		...base,
		parts: base.parts.map((p) => (p.id === 'flag' ? { ...p, role: 'flag', cloth: { wind: 5 } } : p)),
		clips: [{ id: 'wind', type: 'wind' }, { id: 'idle', type: 'idle' }, { id: 'once', type: 'nod', duration: 1.3 }],
		...extra
	});
	if (!r.ok) throw new Error(r.error);
	return r.scene;
}

describe('cloth flutter', () => {
	const scene = flag();
	const b = buildScene(scene);
	const [c] = clothTargets(b);
	const mesh = b.meshes.find((m) => m.prim === c.prim)!;
	const T = meshMorphs(b, mesh).filter((t) => c.ids.includes(t.id));
	const pr = b.compiled.prims[c.prim];

	it('four targets add up to a wave running from the pinned edge', () => {
		expect(T).toHaveLength(4);
		const k = (2 * Math.PI) / c.wavelength;
		const span = pr.lmax[0] - pr.lmin[0], len = span * pr.scl[0];
		for (const th of [0, 0.7, 2, 3.5, 5.1]) {
			const w = [Math.max(0, Math.cos(th)), Math.max(0, Math.sin(th)), Math.max(0, -Math.cos(th)), Math.max(0, -Math.sin(th))];
			for (let v = 0; v < mesh.positions.length / 3; v += 7) {
				const l = toLocal(pr, mesh.positions[v * 3] - b.offset[0], mesh.positions[v * 3 + 1] - b.offset[1], mesh.positions[v * 3 + 2] - b.offset[2]);
				const u = Math.max(0, Math.min(1, (l[0] - pr.lmin[0]) / span));
				const want = c.amplitude * u ** 1.3 * Math.sin(k * u * len - th);
				const got = [0, 1, 2].map((a) => T.reduce((s, t, i) => s + t.dp[v * 3 + a] * w[i], 0));
				// all of it along the flag's normal, and as big as the wave says
				expect(Math.hypot(...got)).toBeCloseTo(Math.abs(want), 5);
			}
		}
	});

	it('the pinned edge holds, the free edge swings', () => {
		let pinned = 0, free = 0;
		for (let v = 0; v < mesh.positions.length / 3; v++) {
			const l = toLocal(pr, mesh.positions[v * 3] - b.offset[0], mesh.positions[v * 3 + 1] - b.offset[1], mesh.positions[v * 3 + 2] - b.offset[2]);
			const d = Math.max(...T.map((t) => Math.hypot(t.dp[v * 3], t.dp[v * 3 + 1], t.dp[v * 3 + 2])));
			if (l[0] < pr.lmin[0] + 1e-4) pinned = Math.max(pinned, d);
			if (l[0] > pr.lmax[0] - 1e-3) free = Math.max(free, d);
		}
		expect(pinned).toBeLessThan(1e-6);
		expect(free).toBeGreaterThan(c.amplitude * 0.8);
	});

	it('ripples in every clip, seamlessly in loops, with weights an engine accepts', () => {
		const rig = buildRig(b);
		for (const def of scene.clips!) {
			const clip = sampleClip(b, rig, def);
			for (const id of c.ids) {
				const w = clip.morph![id];
				expect(w.every((x) => x >= 0 && x <= 1)).toBe(true);
				if (clip.loop) expect(w[0]).toBeCloseTo(w[w.length - 1], 6);
			}
		}
	});

	it('exports four targets on the flag only, animated, with no validator issues', async () => {
		const r = exportGlb(b);
		const rep = await validator.validateBytes(r.glb);
		expect(rep.issues.numErrors).toBe(0);
		expect(rep.issues.numWarnings).toBe(0);
		const meshes = r.json.meshes as { name: string; extras?: { targetNames: string[] } }[];
		expect(meshes.find((m) => m.name === 'flag')!.extras!.targetNames).toEqual(c.ids);
		expect(meshes.filter((m) => m.extras).length).toBe(1);
		const anims = r.json.animations as { channels: { target: { path: string } }[] }[];
		for (const a of anims) expect(a.channels.some((ch) => ch.target.path === 'weights')).toBe(true);
	});

	it('warns when cloth is on a part that cannot flutter', () => {
		const s = parseScene({ ...getTemplate('biped')!.scene, parts: getTemplate('biped')!.scene.parts.map((p) => (p.id === 'hair' ? { ...p, cloth: {} } : p)) });
		if (!s.ok) throw new Error(s.error);
		expect(critique(buildScene(s.scene)).issues.some((i) => i.code === 'cloth')).toBe(true);
	});
});
