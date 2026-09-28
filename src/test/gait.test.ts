import { describe, expect, it } from 'vitest';
import { footPath, twoBoneLeg } from '../anim/ik.js';
import { buildRig, critiqueClip, legChains, poseMeshes, sampleClip } from '../anim/rig.js';
import { buildScene, type Build } from '../core/build.js';
import { applyOps } from '../core/ops.js';
import type { Scene } from '../core/schema.js';
import { exportGlb } from '../export/gltf.js';
import { getTemplate } from '../templates/index.js';

/** Lowest point of each planted leg in every frame, with whether the gait has that foot down. */
function stanceHeights(b: Build, clipId: string) {
	const rig = buildRig(b);
	const def = b.compiled.scene.clips!.find((c) => c.id === clipId)!;
	const clip = sampleClip(b, rig, def);
	const chains = legChains(b, rig);
	const out: number[] = [];
	for (let f = 0; f < clip.times.length; f += 2) {
		const meshes = poseMeshes(b, rig, clip, f);
		for (const c of chains) {
			let y = Infinity;
			for (const m of meshes) for (let v = 0; v < m.positions.length / 3; v++) if (c.subtree.has(m.prim >= 0 ? m.prim : m.vertPrim[v])) y = Math.min(y, m.positions[v * 3 + 1]);
			out.push(y);
		}
	}
	return { rig, clip, chains, heights: out, report: critiqueClip(b, rig, clip, true) };
}

const kneed = (): Scene => {
	const r = applyOps(getTemplate('biped')!.scene, [
		{ op: 'update_part', id: 'leg', set: { shape: { type: 'capsule', length: 0.2, radius: 0.068 } } },
		{ op: 'add_part', after: 'leg', part: { id: 'shin', role: 'leg', shape: { type: 'capsule', length: 0.2, radius: 0.06 }, attach: { to: 'leg', side: 'bottom', embed: 0.5 }, blend: 0.02, mirror: true, material: { color: 'pants' } } },
		{ op: 'update_part', id: 'foot', set: { attach: { to: 'shin', side: 'bottom', embed: 0.55 } } }
	]);
	if (!r.ok) throw new Error(r.error);
	return r.scene;
};

describe('leg solvers', () => {
	it('two-bone IK puts the foot on the target and bends the knee the rest way', () => {
		const knee: [number, number] = [-0.2, 0.01], foot: [number, number] = [-0.4, 0];
		for (const target of [[-0.35, 0.1], [-0.3, -0.12], [-0.38, 0]] as [number, number][]) {
			const s = twoBoneLeg(knee, foot, target);
			const rot = (v: [number, number], a: number): [number, number] => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
			const k = rot(knee, s.hip);
			const shin = rot([foot[0] - knee[0], foot[1] - knee[1]], s.hip + s.knee);
			expect(k[0] + shin[0]).toBeCloseTo(target[0], 4);
			expect(k[1] + shin[1]).toBeCloseTo(target[1], 4);
			// knee ahead of the hip→foot line, like at rest
			const cross = k[0] * (target[1] - k[1]) - k[1] * (target[0] - k[0]);
			expect(Math.sign(cross)).toBe(Math.sign(knee[0] * (foot[1] - knee[1]) - knee[1] * (foot[0] - knee[0])));
		}
	});

	it('the foot path stays on the ground during stance and sweeps back at a constant rate', () => {
		const a = footPath(0.1, 0.6, 0.2, 0.05), b = footPath(0.2, 0.6, 0.2, 0.05);
		expect(a.stance && b.stance).toBe(true);
		expect(a.dy).toBe(0);
		expect(a.dz - b.dz).toBeCloseTo((0.2 * 0.1) / 0.6, 6);
		expect(footPath(0.8, 0.6, 0.2, 0.05).dy).toBeCloseTo(0.05, 6);
	});
});

describe('planted walks', () => {
	for (const id of ['biped', 'quadruped']) {
		it(`${id}: stance feet stay within one cell of the ground and do not slide`, () => {
			const b = buildScene(getTemplate(id)!.scene);
			const { heights, report, clip, chains } = stanceHeights(b, 'walk');
			expect(chains.length).toBe(id === 'biped' ? 2 : 4);
			expect(clip.speed).toBeGreaterThan(0.05);
			// the lowest foot is always on the ground: no frame where every foot floats or sinks
			const perFrame: number[] = [];
			for (let i = 0; i < heights.length; i += chains.length) perFrame.push(Math.min(...heights.slice(i, i + chains.length)));
			for (const y of perFrame) expect(Math.abs(y)).toBeLessThan(b.cell);
			for (const f of report.feet) expect(f.slide, f.leg).toBeLessThan(b.cell);
			expect(report.issues).toEqual([]);
		});
	}

	it('two-segment legs bend at the knee and still plant', () => {
		const b = buildScene(kneed());
		const { report, clip, chains, rig } = stanceHeights(b, 'walk');
		expect(chains.every((c) => c.lower >= 0)).toBe(true);
		const knee = clip.channels.find((c) => c.joint === rig.byPrim.get(b.compiled.byId.get('shin')!.index))!;
		const bend = Math.max(...knee.rot.map((q) => 2 * Math.asin(Math.min(1, Math.hypot(q[0], q[1], q[2])))));
		expect(bend).toBeGreaterThan(0.2);
		for (const f of report.feet) expect(f.slide, f.leg).toBeLessThan(b.cell);
		expect(report.issues).toEqual([]);
	});

	it('the critic reports a foot dragged along the ground', () => {
		const scene = getTemplate('biped')!.scene;
		const drag = applyOps(scene, [
			{ op: 'add_clip', clip: { id: 'drag', type: 'keyframes', duration: 1, tracks: [{ part: 'leg', keys: [{ t: 0, rotation: [-12, 0, 0] }, { t: 1, rotation: [12, 0, 0] }] }, { part: 'leg.m', keys: [{ t: 0, rotation: [12, 0, 0] }, { t: 1, rotation: [-12, 0, 0] }] }] } }
		]);
		if (!drag.ok) throw new Error(drag.error);
		const b = buildScene(drag.scene);
		const rig = buildRig(b);
		const m = critiqueClip(b, rig, sampleClip(b, rig, drag.scene.clips!.find((c) => c.id === 'drag')!), true);
		expect(m.issues.join(' ')).toMatch(/slides .* cm while its foot is on the ground/);
	});

	it('exports the walking speed with the animation', () => {
		const b = buildScene(getTemplate('biped')!.scene);
		const anims = exportGlb(b).json.animations as { name: string; extras?: { speed: number } }[];
		expect(anims.find((a) => a.name === 'walk')!.extras!.speed).toBeGreaterThan(0.05);
		expect(anims.find((a) => a.name === 'idle')!.extras).toBeUndefined();
	});
});

describe('secondary motion', () => {
	const angle = (q: number[], r: number[]) => 2 * Math.acos(Math.min(1, Math.abs(q[0] * r[0] + q[1] * r[1] + q[2] * r[2] + q[3] * r[3])));

	it('tails and ears follow through with a spring and the clip still loops', () => {
		const b = buildScene(getTemplate('quadruped')!.scene);
		const rig = buildRig(b);
		const def = b.compiled.scene.clips!.find((c) => c.id === 'walk')!;
		const on = sampleClip(b, rig, def), off = sampleClip(b, rig, { ...def, secondary: false });
		for (const id of ['tail', 'ear']) {
			const J = rig.byPrim.get(b.compiled.byId.get(id)!.index)!;
			const a = on.channels.find((c) => c.joint === J)!, z = off.channels.find((c) => c.joint === J)!;
			const extra = Math.max(...a.rot.map((q, i) => angle(q, z.rot[i])));
			expect(extra, id).toBeGreaterThan(2 * (Math.PI / 180));
			expect(angle(a.rot[0], a.rot[a.rot.length - 1]), id).toBeLessThan(0.5 * (Math.PI / 180));
		}
		expect(critiqueClip(b, rig, on, true).issues).toEqual([]);
	});

	it('the follow-through lags the motion that drives it', () => {
		// a still tail on a body that sways: the tail turns only through the spring, after the body
		const r = applyOps(getTemplate('quadruped')!.scene, [
			{ op: 'add_clip', clip: { id: 'sway', type: 'keyframes', duration: 2, tracks: [{ part: 'body', keys: [{ t: 0, rotation: [0, 0, 0] }, { t: 0.3, rotation: [0, 25, 0] }, { t: 2, rotation: [0, 25, 0] }] }] } }
		]);
		if (!r.ok) throw new Error(r.error);
		const b = buildScene(r.scene);
		const rig = buildRig(b);
		const clip = sampleClip(b, rig, r.scene.clips!.find((c) => c.id === 'sway')!);
		const J = rig.byPrim.get(b.compiled.byId.get('tail')!.index)!;
		const ch = clip.channels.find((c) => c.joint === J)!;
		// signed turn about Y (the body turns +25°): the tail trails during the turn, overshoots after the stop, then settles
		const yaw = ch.rot.map((q) => 2 * Math.atan2(q[1], q[3]));
		const during = yaw.filter((_, i) => clip.times[i] > 0.05 && clip.times[i] < 0.3);
		const after = yaw.filter((_, i) => clip.times[i] > 0.3 && clip.times[i] < 0.8);
		expect(Math.min(...during)).toBeLessThan(-3 * (Math.PI / 180));
		expect(Math.max(...after)).toBeGreaterThan(1 * (Math.PI / 180));
		expect(Math.abs(yaw[yaw.length - 1])).toBeLessThan(0.5 * (Math.PI / 180));
	});

	it('can be turned off per clip', () => {
		const b = buildScene(getTemplate('quadruped')!.scene);
		const rig = buildRig(b);
		const clip = sampleClip(b, rig, { id: 'i', type: 'idle', secondary: false });
		const J = rig.byPrim.get(b.compiled.byId.get('tail')!.index)!;
		const plain = sampleClip(b, rig, { id: 'i', type: 'idle' });
		const a = clip.channels.find((c) => c.joint === J)!.rot, z = plain.channels.find((c) => c.joint === J)!.rot;
		expect(a.some((q, i) => angle(q, z[i]) > 1e-4)).toBe(true);
	});
});
