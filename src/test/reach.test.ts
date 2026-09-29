import { describe, expect, it } from 'vitest';
import { twoBoneArm } from '../anim/ik.js';
import { buildRig, jointMatrices, poseMeshes, sampleClip } from '../anim/rig.js';
import { buildScene, type Build } from '../core/build.js';
import { m4Point, type V3 } from '../core/math.js';
import { applyOps } from '../core/ops.js';
import { integrity, type Scene } from '../core/schema.js';
import { getTemplate } from '../templates/index.js';

function withClip(scene: Scene, clip: object): Scene {
	const r = applyOps(scene, [{ op: 'add_clip', clip }]);
	if (!r.ok) throw new Error(r.error);
	return r.scene;
}

/** The rest vertex of these parts farthest from a point, as [mesh, vertex]. */
function tipVertex(b: Build, ids: string[], from: V3): [number, number] {
	const set = new Set(ids.map((id) => b.compiled.byId.get(id)!.index));
	let best: [number, number] = [0, 0], d = -1;
	b.meshes.forEach((m, mi) => {
		for (let v = 0; v < m.positions.length / 3; v++) {
			if (!set.has(m.prim >= 0 ? m.prim : m.vertPrim[v])) continue;
			const l = Math.hypot(m.positions[v * 3] - from[0], m.positions[v * 3 + 1] - from[1], m.positions[v * 3 + 2] - from[2]);
			if (l > d) (d = l), (best = [mi, v]);
		}
	});
	return best;
}

const at = (ms: { positions: Float32Array }[], [mi, v]: [number, number]): V3 => [ms[mi].positions[v * 3], ms[mi].positions[v * 3 + 1], ms[mi].positions[v * 3 + 2]];
const dist = (a: V3, c: V3) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
const angle = (a: V3, c: V3) => Math.acos(Math.max(-1, Math.min(1, (a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) / (Math.hypot(...a) * Math.hypot(...c)))));

/** An arm in two parts, so the elbow can bend. */
function twoPartArm(): Scene {
	const r = applyOps(getTemplate('biped')!.scene, [
		{ op: 'remove_part', id: 'hand' },
		{ op: 'update_part', id: 'arm', set: { shape: { type: 'capsule', length: 0.19, radius: 0.052 } } },
		{ op: 'add_part', part: { id: 'forearm', role: 'arm', shape: { type: 'capsule', length: 0.19, radius: 0.046 }, attach: { to: 'arm', side: 'bottom', embed: 0.5 }, pivot: 'top', blend: 0.02, material: { color: 'shirt' } } },
		{ op: 'add_part', part: { id: 'hand', shape: { type: 'sphere', radius: 0.058 }, attach: { to: 'forearm', side: 'bottom', embed: 0.55 }, blend: 0.02, material: { color: 'skin' } } }
	]);
	if (!r.ok) throw new Error(r.error);
	return r.scene;
}

describe('two-bone arm solver', () => {
	it('puts the hand on reachable targets and bends toward the pole', () => {
		const upper: V3 = [0, -0.2, 0], lower: V3 = [0, -0.2, 0];
		const rot = (q: number[], v: V3): V3 => {
			const [x, y, z, w] = q;
			const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
			return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
		};
		const mulq = (a: number[], c: number[]) => [
			a[3] * c[0] + a[0] * c[3] + a[1] * c[2] - a[2] * c[1],
			a[3] * c[1] - a[0] * c[2] + a[1] * c[3] + a[2] * c[0],
			a[3] * c[2] + a[0] * c[1] - a[1] * c[0] + a[2] * c[3],
			a[3] * c[3] - a[0] * c[0] - a[1] * c[1] - a[2] * c[2]
		];
		for (const target of [[0.1, -0.2, 0.2], [0, 0, 0.3], [0.25, 0.1, 0.1], [-0.1, -0.3, -0.1]] as V3[]) {
			const r = twoBoneArm(upper, lower, target, [0, -0.5, -1]);
			const elbow = rot(r.shoulder, upper);
			// the forearm turns in the upper arm's frame, so its world turn is shoulder · elbow
			const hand = elbow.map((e, k) => e + rot(mulq(r.shoulder, r.elbow), lower)[k]) as V3;
			expect(dist(hand, target)).toBeLessThan(1e-4);
			expect(Math.hypot(...elbow)).toBeCloseTo(0.2, 6);
		}
		// out of reach: stretched straight toward it
		const far = twoBoneArm(upper, lower, [0, 0, 1], [0, -0.5, -1]);
		expect(far.reach).toBeGreaterThan(1);
	});
});

describe('reach, point, pick up', () => {
	it('a two-part arm touches the point with its fingertip', () => {
		const scene = withClip(twoPartArm(), { id: 'reach', type: 'reach', at: [-0.2, 0.55, 0.22] });
		const b = buildScene(scene);
		const rig = buildRig(b);
		const clip = sampleClip(b, rig, scene.clips!.find((c) => c.id === 'reach')!);
		const shoulder = rig.joints[rig.byPrim.get(b.compiled.byId.get('arm.m')!.index)!].rest;
		const tip = tipVertex(b, ['arm.m', 'forearm.m', 'hand.m'], shoulder);
		const f = Math.round(clip.times.length * 0.5);
		expect(dist(at(poseMeshes(b, rig, clip, f), tip), [-0.2, 0.55, 0.22])).toBeLessThan(b.cell * 1.5);
		// and ends where it started
		expect(dist(at(poseMeshes(b, rig, clip, clip.times.length - 1), tip), at(b.meshes, tip))).toBeLessThan(1e-4);
	});

	it('a one-piece arm aims its tip at the point', () => {
		const goal: V3 = [-0.25, 0.9, 0.6];
		const scene = withClip(getTemplate('biped')!.scene, { id: 'point', type: 'point', at: goal });
		const b = buildScene(scene);
		const rig = buildRig(b);
		const clip = sampleClip(b, rig, scene.clips!.find((c) => c.id === 'point')!);
		const J = rig.byPrim.get(b.compiled.byId.get('arm.m')!.index)!;
		const shoulderRest = rig.joints[J].rest;
		const tip = tipVertex(b, ['arm.m', 'hand.m'], shoulderRest);
		const f = Math.round(clip.times.length * 0.5);
		const shoulder = m4Point(jointMatrices(rig, clip, f)[J], [0, 0, 0]);
		const p = at(poseMeshes(b, rig, clip, f), tip);
		expect(angle([p[0] - shoulder[0], p[1] - shoulder[1], p[2] - shoulder[2]], [goal[0] - shoulder[0], goal[1] - shoulder[1], goal[2] - shoulder[2]])).toBeLessThan(2 * (Math.PI / 180));
	});

	it('pick up bends over until the hand reaches the ground, feet planted', () => {
		const scene = withClip(twoPartArm(), { id: 'pickup', type: 'pickup' });
		const b = buildScene(scene);
		const rig = buildRig(b);
		const clip = sampleClip(b, rig, scene.clips!.find((c) => c.id === 'pickup')!);
		const shoulder = rig.joints[rig.byPrim.get(b.compiled.byId.get('arm.m')!.index)!].rest;
		const tip = tipVertex(b, ['arm.m', 'forearm.m', 'hand.m'], shoulder);
		const f = Math.round(clip.times.length * 0.47);
		const posed = poseMeshes(b, rig, clip, f);
		expect(at(posed, tip)[1]).toBeLessThan(0.08);
		// the feet stay where they stood
		const foot = tipVertex(b, ['foot'], [0, 1, 0]);
		expect(dist(at(posed, foot), at(b.meshes, foot))).toBeLessThan(0.03);
	});
});

describe('look', () => {
	it('turns the head toward a point, and holds a gaze through another clip', () => {
		const goal: V3 = [0.8, 1.0, 0.8];
		for (const clipDef of [{ id: 'look', type: 'look', at: goal }, { id: 'stroll', type: 'walk', lookAt: goal }]) {
			const scene = withClip(getTemplate('biped')!.scene, clipDef);
			const b = buildScene(scene);
			const rig = buildRig(b);
			const clip = sampleClip(b, rig, scene.clips!.find((c) => c.id === clipDef.id)!);
			const H = rig.byPrim.get(b.compiled.byId.get('head')!.index)!;
			const f = Math.round(clip.times.length * 0.5);
			const W = jointMatrices(rig, clip, f)[H];
			const pivot = m4Point(W, [0, 0, 0]);
			const fwd = m4Point(W, [0, 0, 1]);
			const face: V3 = [fwd[0] - pivot[0], 0, fwd[2] - pivot[2]];
			const want: V3 = [goal[0] - pivot[0], 0, goal[2] - pivot[2]];
			expect(angle(face, want)).toBeLessThan(6 * (Math.PI / 180));
		}
	});

	it('rejects a part it cannot find', () => {
		const s = { ...getTemplate('biped')!.scene, clips: [{ id: 'l', type: 'look' as const, at: 'nobody' }] };
		expect(integrity(s).some((e) => e.path === 'clips[0].at')).toBe(true);
	});
});
