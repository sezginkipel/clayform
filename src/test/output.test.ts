import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { buildRig, critiqueClip, poseMeshes, sampleClip } from '../anim/rig.js';
import { buildScene } from '../core/build.js';
import { simplifyBuild } from '../core/simplify.js';
import { exportGlb, exportObj } from '../export/gltf.js';
import { renderClipStrip } from '../render/motion.js';
import { renderSheet } from '../render/views.js';
import { getTemplate } from '../templates/index.js';
import { bakeEffect, PRESETS, resolveEffect } from '../vfx/effects.js';
import { EFFECT_PRESETS } from '../core/schema.js';
import { ball, scene } from './helpers.js';

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const tpl = (id: string) => buildScene(getTemplate(id)!.scene);

async function validate(glb: Uint8Array) {
	const report = await validator.validateBytes(glb, { maxIssues: 50 });
	return report.issues as { numErrors: number; numWarnings: number; messages: { code: string; message: string; severity: number }[] };
}

describe('render', () => {
	it('produces a labelled PNG that is not blank, and a parts legend', () => {
		const s = renderSheet(tpl('snowman'), { size: 160, mode: 'parts' });
		expect([...s.png.subarray(0, 8)]).toEqual(PNG);
		expect(s.views).toEqual(['front', 'left', 'top', 'three_quarter']);
		expect(s.legend.map((l) => l.id)).toEqual(expect.arrayContaining(['base', 'torso', 'head', 'arm', 'arm.m']));
		expect(s.png.length).toBeGreaterThan(8000);
	});
});

describe('glTF export (Khronos validator)', () => {
	it('static prop: zero errors', async () => {
		const r = exportGlb(await simplifyBuild(tpl('chest')));
		const v = await validate(r.glb);
		expect(v.numErrors, JSON.stringify(v.messages.slice(0, 5))).toBe(0);
		expect(r.stats.animations).toBe(0);
	});

	it('skinned + animated character: zero errors', async () => {
		const r = exportGlb(await simplifyBuild(tpl('biped'), { triangles: 3000 }));
		const v = await validate(r.glb);
		expect(v.numErrors, JSON.stringify(v.messages.slice(0, 5))).toBe(0);
		expect(r.stats.animations).toBe(2);
		expect(r.stats.joints).toBeGreaterThan(10);
	});

	it('separate wheels, emissive strength, metal: zero errors', async () => {
		for (const id of ['car', 'potion', 'robot']) {
			const r = exportGlb(await simplifyBuild(tpl(id)));
			const v = await validate(r.glb);
			expect(v.numErrors, `${id}: ${JSON.stringify(v.messages.slice(0, 5))}`).toBe(0);
		}
	});

	it('OBJ has vertices and faces', () => {
		const obj = exportObj(buildScene(scene([ball('s', 0.3)]), { resolution: 24 }));
		expect(obj).toMatch(/^v /m);
		expect(obj).toMatch(/^f \d+\/\/\d+/m);
	});
});

describe('simplify', () => {
	it('cuts triangles and keeps the silhouette', async () => {
		const full = tpl('house');
		const s = await simplifyBuild(full);
		expect(s.stats.triangles).toBeLessThan(full.stats.triangles / 5);
		const size = (b: typeof full) => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
		let sMin = [Infinity, Infinity, Infinity], sMax = [-Infinity, -Infinity, -Infinity];
		for (const m of s.meshes)
			for (let i = 0; i < m.positions.length; i += 3)
				for (let a = 0; a < 3; a++) {
					sMin[a] = Math.min(sMin[a], m.positions[i + a]);
					sMax[a] = Math.max(sMax[a], m.positions[i + a]);
				}
		size(full).forEach((v, a) => expect(Math.abs(sMax[a] - sMin[a] - v)).toBeLessThan(v * 0.02));
		const b = await simplifyBuild(full, { triangles: 2000 });
		expect(b.stats.triangles).toBeLessThanOrEqual(2000);
	});
});

describe('animation', () => {
	it('walk swings the two legs in opposite phase and keeps feet on the ground', () => {
		const b = tpl('biped');
		const rig = buildRig(b);
		const clip = sampleClip(b, rig, b.compiled.scene.clips!.find((c) => c.id === 'walk')!);
		const leg = rig.byPrim.get(b.compiled.byId.get('leg')!.index)!;
		const twin = rig.byPrim.get(b.compiled.byId.get('leg.m')!.index)!;
		const q = (j: number, f: number) => clip.channels.find((c) => c.joint === j)!.rot[f];
		const f = Math.round(clip.times.length / 4);
		expect(Math.sign(q(leg, f)[0])).toBe(-Math.sign(q(twin, f)[0]));
		const m = critiqueClip(b, rig, clip, true);
		expect(m.issues).toEqual([]);
		expect(m.minY).toBeGreaterThan(-b.cell * 2);
	});

	it('posing moves vertices and rest pose does not', () => {
		const b = tpl('quadruped');
		const rig = buildRig(b);
		const rest = poseMeshes(b, rig, null, 0)[0];
		let drift = 0;
		for (let i = 0; i < rest.positions.length; i++) drift = Math.max(drift, Math.abs(rest.positions[i] - b.meshes[0].positions[i]));
		expect(drift).toBeLessThan(1e-4);
		const clip = sampleClip(b, rig, { id: 'w', type: 'walk' });
		const moved = poseMeshes(b, rig, clip, Math.round(clip.times.length / 4))[0];
		let d = 0;
		for (let i = 0; i < moved.positions.length; i++) d = Math.max(d, Math.abs(moved.positions[i] - b.meshes[0].positions[i]));
		expect(d).toBeGreaterThan(0.02);
	});

	it('film strip renders', () => {
		const s = renderClipStrip(tpl('robot'), 'wave', { frames: 3, size: 96 });
		expect([...s.png.subarray(0, 8)]).toEqual(PNG);
		expect(s.times.length).toBe(3);
	});
});

describe('effects', () => {
	it('every preset bakes a non-empty flipbook', () => {
		for (const p of EFFECT_PRESETS) {
			expect(PRESETS[p], p).toBeDefined();
			const fb = bakeEffect(resolveEffect(scene([]), { id: 'e', preset: p, frames: 4, tile: 48 }));
			expect(fb.stats.peakAlive, p).toBeGreaterThan(0);
			expect([...fb.sheet.subarray(0, 8)]).toEqual(PNG);
			expect(fb.meta.columns * fb.meta.rows).toBeGreaterThanOrEqual(4);
		}
	});
});
