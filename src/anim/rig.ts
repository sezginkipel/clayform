/**
 * Automatic rig + procedural clips.
 *
 * Every part is a joint located at its pivot (usually where it attaches), plus
 * a synthetic `root` joint on the ground. Rest rotations are identity, so a
 * joint rotation is simply "turn this part about its pivot" in world axes —
 * exactly how people describe motion ("swing the leg forward 30°").
 *
 * Clips are intent: `walk` finds the legs, pairs them by side and depth,
 * phases them (biped alternating, quadruped diagonal, insects tripod), swings
 * arms against legs, bobs the body and sways tails. Keyframe tracks can be
 * layered on top.
 */

import type { Build, MeshData } from '../core/build.js';
import { primDist } from '../core/compile.js';
import type { Prim } from '../core/compile.js';
import {
	DEG, add, m4Compose, m4Invert, m4Mul, norm, qAxisAngle, qEuler, qFromTo, qIdentity, qMul, qSlerp, sub,
	type M4, type Quat, type V3
} from '../core/math.js';
import type { Clip } from '../core/schema.js';

export interface Joint {
	name: string;
	/** prim index, or -1 for root */
	prim: number;
	parent: number;
	/** rest world position (grounded) */
	rest: V3;
	/** rest translation relative to parent */
	local: V3;
}

export interface Rig {
	joints: Joint[];
	root: number;
	/** height of the model */
	height: number;
	byPrim: Map<number, number>;
}

export function buildRig(b: Build): Rig {
	const prims = b.compiled.prims;
	const joints: Joint[] = [{ name: 'root', prim: -1, parent: -1, rest: [0, 0, 0], local: [0, 0, 0] }];
	const byPrim = new Map<number, number>();
	// prims are already in dependency order (parents first)
	for (const p of prims) {
		const rest = add(p.pivot, b.offset);
		const parent = p.parent >= 0 ? byPrim.get(p.parent) ?? 0 : 0;
		joints.push({ name: p.id, prim: p.index, parent, rest, local: sub(rest, joints[parent].rest) });
		byPrim.set(p.index, joints.length - 1);
	}
	return { joints, root: 0, height: b.max[1] - b.min[1], byPrim };
}

/* ------------------------------------------------------------ clip sampling */

export interface Channel {
	joint: number;
	rot: Quat[];
	off: V3[];
	scl: V3[] | null;
}

export interface SampledClip {
	id: string;
	type: string;
	duration: number;
	fps: number;
	times: number[];
	channels: Channel[];
}

type Motion = { rot?: V3 | Quat; off?: V3; scl?: V3 };
type Driver = (t: number) => Motion;

const PERIOD: Record<string, number> = {
	idle: 2.4, walk: 1.0, run: 0.62, hop: 0.8, fly: 0.5, swim: 1.4, drive: 1.0, spin: 4, hover: 2, wave: 1.2, nod: 1.2, keyframes: 1
};

const TAU = Math.PI * 2;
const isQuat = (r: V3 | Quat): r is Quat => r.length === 4;

function sideOf(p: Prim, cx: number) {
	return p.pivot[0] >= cx ? 1 : -1;
}

/** Procedural drivers per joint for one clip. */
function drivers(b: Build, rig: Rig, clip: Clip): { period: number; drive: Map<number, Driver> } {
	const prims = b.compiled.prims;
	const amp = clip.amplitude ?? 1;
	const period = (PERIOD[clip.type] ?? 1) / (clip.speed ?? 1);
	const drive = new Map<number, Driver>();
	const j = (p: Prim) => rig.byPrim.get(p.index)!;
	const role = (r: string) => prims.filter((p) => p.role === r && !p.hidden);
	const h = Math.max(rig.height, 1e-3);
	const bodyPrims = prims.filter((p) => p.op === 'add' && !p.hidden);
	const cx = bodyPrims.length ? bodyPrims.reduce((s, p) => s + p.pivot[0], 0) / bodyPrims.length : 0;
	const cz = bodyPrims.length ? bodyPrims.reduce((s, p) => s + p.pivot[2], 0) / bodyPrims.length : 0;
	const w = (t: number, ph = 0) => Math.sin(TAU * (t / period + ph));
	const set = (joint: number, f: Driver) => {
		const prev = drive.get(joint);
		drive.set(joint, prev ? (t) => combine(prev(t), f(t)) : f);
	};

	// legs: only the top joint of a chain swings; lower segments bend
	const legs = role('leg');
	const legSet = new Set(legs.map((p) => p.index));
	const topLegs = legs.filter((p) => !legSet.has(p.parent));
	const lowerLegs = legs.filter((p) => legSet.has(p.parent));
	const legPhase = new Map<number, number>();
	if (topLegs.length <= 2) topLegs.forEach((p) => legPhase.set(p.index, sideOf(p, cx) > 0 ? 0 : 0.5));
	else if (topLegs.length <= 4) topLegs.forEach((p) => legPhase.set(p.index, (sideOf(p, cx) > 0) === p.pivot[2] >= cz ? 0 : 0.5));
	else {
		const sorted = topLegs.slice().sort((a, c) => a.pivot[2] - c.pivot[2]);
		const bySide = { l: sorted.filter((p) => sideOf(p, cx) > 0), r: sorted.filter((p) => sideOf(p, cx) < 0) };
		bySide.l.forEach((p, i) => legPhase.set(p.index, i % 2 ? 0.5 : 0));
		bySide.r.forEach((p, i) => legPhase.set(p.index, i % 2 ? 0 : 0.5));
	}
	const phaseOf = (p: Prim): number => {
		let cur: Prim | undefined = p;
		while (cur) {
			if (legPhase.has(cur.index)) return legPhase.get(cur.index)!;
			cur = cur.parent >= 0 ? prims[cur.parent] : undefined;
		}
		return 0;
	};
	const arms = role('arm');
	const armSet = new Set(arms.map((p) => p.index));
	const topArms = arms.filter((p) => !armSet.has(p.parent));
	const tails = role('tail');
	const wings = role('wing');
	const heads = role('head');
	const wheels = role('wheel');
	const rotors = role('rotor');
	const ears = role('ear');
	const R = rig.root;

	const spinWheels = (mps: number) =>
		wheels.forEach((p) => {
			const rad = Math.max(0.01, Math.min(p.max[1] - p.min[1], Math.max(p.max[2] - p.min[2], p.max[0] - p.min[0])) / 2);
			set(j(p), (t) => ({ rot: qAxisAngle([1, 0, 0], (mps * t) / rad) }));
		});
	// a flat rotor turns around its thinnest axis: a propeller facing forward around Z, a helicopter rotor around Y
	const spinAxis = (p: { min: V3; max: V3 }): V3 => {
		const d = [0, 1, 2].map((k) => p.max[k] - p.min[k]);
		const k = d.indexOf(Math.min(...d));
		return d[k] < 0.5 * Math.max(...d) ? ([0, 0, 0].map((_, i) => (i === k ? 1 : 0)) as V3) : [0, 1, 0];
	};
	const spinRotors = (rps: number) => rotors.forEach((p) => set(j(p), (t) => ({ rot: qAxisAngle(spinAxis(p), TAU * rps * t) })));

	switch (clip.type) {
		case 'walk':
		case 'run': {
			const run = clip.type === 'run';
			const legA = (run ? 42 : 26) * amp, armA = (run ? 38 : 20) * amp;
			topLegs.forEach((p) => set(j(p), (t) => ({ rot: [legA * w(t, phaseOf(p)), 0, 0] })));
			lowerLegs.forEach((p) => set(j(p), (t) => ({ rot: [Math.max(0, -w(t, phaseOf(p) - 0.15)) * legA * 1.2, 0, 0] })));
			topArms.forEach((p) => {
				const same = topLegs.find((l) => sideOf(l, cx) === sideOf(p, cx));
				const ph = same ? phaseOf(same) + 0.5 : sideOf(p, cx) > 0 ? 0.5 : 0;
				set(j(p), (t) => ({ rot: [armA * w(t, ph), 0, 0] }));
			});
			const bob = h * (run ? 0.04 : 0.018) * amp;
			set(R, (t) => ({
				off: [0, bob * (0.5 - 0.5 * Math.cos(TAU * 2 * (t / period))), 0],
				rot: qEuler([run ? 7 * amp : 0, 0, 2.5 * amp * w(t)])
			}));
			heads.forEach((p) => set(j(p), (t) => ({ rot: [-2.5 * amp * Math.cos(TAU * 2 * (t / period)), 3 * amp * w(t), 0] })));
			tails.forEach((p) => set(j(p), (t) => ({ rot: [0, 14 * amp * w(t, 0.25), 0] })));
			wings.forEach((p) => set(j(p), (t) => ({ rot: [0, 0, sideOf(p, cx) * 6 * amp * w(t, 0.25)] })));
			ears.forEach((p) => set(j(p), (t) => ({ rot: [5 * amp * w(t, 0.3), 0, 0] })));
			spinWheels(run ? 4 : 2);
			break;
		}
		case 'idle': {
			set(R, (t) => ({ off: [0, h * 0.006 * amp * (0.5 - 0.5 * Math.cos(TAU * (t / period))), 0] }));
			heads.forEach((p) => set(j(p), (t) => ({ rot: [2 * amp * w(t, 0.1), 7 * amp * Math.sin(TAU * (t / period) * 0.5), 0] })));
			topArms.forEach((p) => set(j(p), (t) => ({ rot: [3 * amp * w(t, 0.2), 0, sideOf(p, cx) * 2 * amp * w(t)] })));
			tails.forEach((p) => set(j(p), (t) => ({ rot: [0, 10 * amp * w(t), 0] })));
			ears.forEach((p) => set(j(p), (t) => ({ rot: [0, 0, sideOf(p, cx) * 4 * amp * w(t, 0.4)] })));
			wings.forEach((p) => set(j(p), (t) => ({ rot: [0, 0, sideOf(p, cx) * 4 * amp * w(t)] })));
			spinRotors(0.5);
			break;
		}
		case 'hop': {
			set(R, (t) => {
				const ph = (t / period) % 1;
				const air = Math.max(0, Math.sin(TAU * ph));
				const land = Math.max(0, -Math.sin(TAU * ph));
				const sq = 1 - 0.12 * amp * land + 0.06 * amp * air;
				return { off: [0, h * 0.28 * amp * air, 0], scl: [1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)] };
			});
			topLegs.forEach((p) => set(j(p), (t) => ({ rot: [-15 * amp * Math.max(0, w(t)), 0, 0] })));
			topArms.forEach((p) => set(j(p), (t) => ({ rot: [0, 0, sideOf(p, cx) * 25 * amp * Math.max(0, w(t))] })));
			tails.forEach((p) => set(j(p), (t) => ({ rot: [-12 * amp * w(t), 0, 0] })));
			ears.forEach((p) => set(j(p), (t) => ({ rot: [12 * amp * w(t, 0.1), 0, 0] })));
			break;
		}
		case 'fly': {
			wings.forEach((p) => set(j(p), (t) => ({ rot: [0, 0, sideOf(p, cx) * 38 * amp * w(t)] })));
			set(R, (t) => ({ off: [0, h * 0.35 + h * 0.04 * amp * w(t, 0.25), 0], rot: [4 * amp * w(t, 0.25), 0, 0] }));
			topLegs.forEach((p) => set(j(p), () => ({ rot: [-35, 0, 0] })));
			tails.forEach((p) => set(j(p), (t) => ({ rot: [6 * amp * w(t, 0.5), 0, 0] })));
			spinRotors(6);
			break;
		}
		case 'swim': {
			set(R, (t) => ({ rot: [0, 6 * amp * w(t), 0] }));
			tails.forEach((p) => set(j(p), (t) => ({ rot: [0, 28 * amp * w(t, 0.25), 0] })));
			wings.forEach((p) => set(j(p), (t) => ({ rot: [0, 0, sideOf(p, cx) * 18 * amp * w(t)] })));
			topArms.forEach((p) => set(j(p), (t) => ({ rot: [0, 0, sideOf(p, cx) * 18 * amp * w(t)] })));
			heads.forEach((p) => set(j(p), (t) => ({ rot: [0, -4 * amp * w(t), 0] })));
			break;
		}
		case 'drive': {
			spinWheels(3 * (clip.speed ?? 1));
			spinRotors(4);
			set(R, (t) => ({ off: [0, h * 0.006 * amp * w(t * 3), 0], rot: [0.8 * amp * w(t * 2, 0.3), 0, 0.8 * amp * w(t * 1.3)] }));
			break;
		}
		case 'spin': {
			const target = clip.target ? prims.find((p) => p.id === clip.target) : undefined;
			const axis = target ? spinAxis(target) : ([0, 1, 0] as V3);
			set(target ? j(target) : R, (t) => ({ rot: qAxisAngle(axis, (TAU * t) / period) }));
			break;
		}
		case 'hover': {
			set(R, (t) => ({ off: [0, h * 0.08 + h * 0.03 * amp * w(t), 0], rot: [0, 0, 3 * amp * w(t, 0.25)] }));
			spinRotors(8);
			break;
		}
		case 'wave': {
			const arm = clip.target ? prims.find((p) => p.id === clip.target) : topArms.slice().sort((a, c) => a.pivot[0] - c.pivot[0])[0];
			if (arm) {
				const s = sideOf(arm, cx);
				const center = add(arm.pivot, [0, 0, 0]);
				const mid: V3 = [(arm.min[0] + arm.max[0]) / 2, (arm.min[1] + arm.max[1]) / 2, (arm.min[2] + arm.max[2]) / 2];
				const restDir = norm(sub(mid, center));
				const up = qFromTo(restDir, norm([s * 0.45, 0.9, 0.15]));
				set(j(arm), (t) => ({ rot: qMul(qAxisAngle([0, 0, 1], s * 22 * amp * w(t) * DEG), up) }));
				heads.forEach((p) => set(j(p), (t) => ({ rot: [0, s * 8, 3 * w(t)] })));
			}
			break;
		}
		case 'nod': {
			const head = clip.target ? prims.find((p) => p.id === clip.target) : heads[0];
			if (head) set(j(head), (t) => ({ rot: [14 * amp * Math.max(0, w(t)), 0, 0] }));
			break;
		}
		case 'keyframes':
			break;
	}
	return { period, drive };
}

function toQuat(r: V3 | Quat | undefined): Quat {
	if (!r) return qIdentity();
	return isQuat(r) ? r : qEuler(r);
}

function combine(a: Motion, b: Motion): Motion {
	return {
		rot: qMul(toQuat(a.rot), toQuat(b.rot)),
		off: a.off || b.off ? add(a.off ?? [0, 0, 0], b.off ?? [0, 0, 0]) : undefined,
		scl: a.scl || b.scl ? [(a.scl?.[0] ?? 1) * (b.scl?.[0] ?? 1), (a.scl?.[1] ?? 1) * (b.scl?.[1] ?? 1), (a.scl?.[2] ?? 1) * (b.scl?.[2] ?? 1)] : undefined
	};
}

function trackDriver(keys: NonNullable<Clip['tracks']>[number]['keys']): Driver {
	const ks = keys.slice().sort((a, b) => a.t - b.t);
	return (t) => {
		if (t <= ks[0].t) return { rot: ks[0].rotation as V3 | undefined, off: ks[0].offset as V3 | undefined };
		const last = ks[ks.length - 1];
		if (t >= last.t) return { rot: last.rotation as V3 | undefined, off: last.offset as V3 | undefined };
		let i = 0;
		while (ks[i + 1].t < t) i++;
		const a = ks[i], c = ks[i + 1];
		const u = (t - a.t) / Math.max(1e-6, c.t - a.t);
		const e = u * u * (3 - 2 * u); // ease in-out
		const ra = qEuler((a.rotation ?? [0, 0, 0]) as V3), rc = qEuler((c.rotation ?? [0, 0, 0]) as V3);
		const oa = (a.offset ?? [0, 0, 0]) as V3, oc = (c.offset ?? [0, 0, 0]) as V3;
		return { rot: qSlerp(ra, rc, e), off: [oa[0] + (oc[0] - oa[0]) * e, oa[1] + (oc[1] - oa[1]) * e, oa[2] + (oc[2] - oa[2]) * e] };
	};
}

export function sampleClip(b: Build, rig: Rig, clip: Clip): SampledClip {
	const { period, drive } = drivers(b, rig, clip);
	let duration = clip.duration ?? period;
	for (const tr of clip.tracks ?? []) {
		const p = b.compiled.byId.get(tr.part);
		if (!p) continue;
		const joint = rig.byPrim.get(p.index)!;
		const d = trackDriver(tr.keys);
		const prev = drive.get(joint);
		drive.set(joint, prev ? (t) => combine(prev(t), d(t)) : d);
		if (clip.type === 'keyframes' && clip.duration === undefined) duration = Math.max(duration === period ? 0 : duration, ...tr.keys.map((k) => k.t));
	}
	if (duration <= 0) duration = 1;
	const fps = clip.fps ?? 30;
	const frames = Math.max(2, Math.round(duration * fps) + 1);
	const times = Array.from({ length: frames }, (_, i) => (i / (frames - 1)) * duration);
	const channels: Channel[] = [];
	for (const [joint, f] of drive) {
		const rot: Quat[] = [], off: V3[] = [], scl: V3[] = [];
		let hasScl = false;
		for (const t of times) {
			const m = f(t);
			rot.push(toQuat(m.rot));
			off.push(m.off ?? [0, 0, 0]);
			scl.push(m.scl ?? [1, 1, 1]);
			if (m.scl) hasScl = true;
		}
		channels.push({ joint, rot, off, scl: hasScl ? scl : null });
	}
	return { id: clip.id, type: clip.type, duration, fps, times, channels };
}

/* ------------------------------------------------------------------ pose */

/** Joint world matrices at frame `f` of a sampled clip (or rest if null). */
export function jointMatrices(rig: Rig, clip: SampledClip | null, f: number): M4[] {
	const rot: (Quat | null)[] = new Array(rig.joints.length).fill(null);
	const off: (V3 | null)[] = new Array(rig.joints.length).fill(null);
	const scl: (V3 | null)[] = new Array(rig.joints.length).fill(null);
	if (clip)
		for (const ch of clip.channels) {
			rot[ch.joint] = ch.rot[f];
			off[ch.joint] = ch.off[f];
			if (ch.scl) scl[ch.joint] = ch.scl[f];
		}
	const world: M4[] = [];
	rig.joints.forEach((jt, i) => {
		const local = m4Compose(add(jt.local, off[i] ?? [0, 0, 0]), rot[i] ?? qIdentity(), scl[i] ?? [1, 1, 1]);
		world.push(jt.parent >= 0 ? m4Mul(world[jt.parent], local) : local);
	});
	return world;
}

export function skinMatrices(rig: Rig, world: M4[]): M4[] {
	return rig.joints.map((jt, i) => m4Mul(world[i], m4Invert(m4Compose(jt.rest, qIdentity()))));
}

/** Deform meshes on the CPU (for previews and critics). */
export function poseMeshes(b: Build, rig: Rig, clip: SampledClip | null, f: number): MeshData[] {
	const skin = skinMatrices(rig, jointMatrices(rig, clip, f));
	return b.meshes.map((m) => {
		const n = m.positions.length / 3;
		const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
		for (let v = 0; v < n; v++) {
			const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
			const nx = m.normals[v * 3], ny = m.normals[v * 3 + 1], nz = m.normals[v * 3 + 2];
			let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
			for (let k = 0; k < 4; k++) {
				const wgt = m.weights[v * 4 + k];
				if (wgt <= 0) continue;
				const jnt = rig.byPrim.get(m.joints[v * 4 + k]) ?? 0;
				const M = skin[jnt];
				px += (M[0] * x + M[4] * y + M[8] * z + M[12]) * wgt;
				py += (M[1] * x + M[5] * y + M[9] * z + M[13]) * wgt;
				pz += (M[2] * x + M[6] * y + M[10] * z + M[14]) * wgt;
				qx += (M[0] * nx + M[4] * ny + M[8] * nz) * wgt;
				qy += (M[1] * nx + M[5] * ny + M[9] * nz) * wgt;
				qz += (M[2] * nx + M[6] * ny + M[10] * nz) * wgt;
			}
			P[v * 3] = px; P[v * 3 + 1] = py; P[v * 3 + 2] = pz;
			const l = Math.hypot(qx, qy, qz) || 1;
			N[v * 3] = qx / l; N[v * 3 + 1] = qy / l; N[v * 3 + 2] = qz / l;
		}
		return { ...m, positions: P, normals: N };
	});
}

/* ---------------------------------------------------------- motion critic */

export interface MotionReport {
	minY: number;
	maxY: number;
	lowest: { t: number; y: number };
	issues: string[];
}

export function critiqueClip(b: Build, rig: Rig, clip: SampledClip, standing: boolean): MotionReport {
	const samples = Math.min(clip.times.length, 16);
	let minY = Infinity, maxY = -Infinity, lowest = { t: 0, y: Infinity };
	const issues: string[] = [];
	const perFrameMin: number[] = [];
	for (let s = 0; s < samples; s++) {
		const f = Math.round((s / Math.max(1, samples - 1)) * (clip.times.length - 1));
		const meshes = poseMeshes(b, rig, clip, f);
		let fm = Infinity;
		for (const m of meshes)
			for (let i = 0; i < m.positions.length; i += 3) {
				const y = m.positions[i + 1];
				if (y < fm) fm = y;
				if (y > maxY) maxY = y;
			}
		perFrameMin.push(fm);
		if (fm < lowest.y) lowest = { t: clip.times[f], y: fm };
		minY = Math.min(minY, fm);
	}
	issues.push(...intersections(b, rig, clip));
	const tol = b.cell * 2;
	if (standing && minY < -tol)
		issues.push(`${clip.id}: sinks ${(-minY * 100).toFixed(1)} cm below the ground at t=${lowest.t.toFixed(2)}s — lower amplitude or shorten the swinging parts`);
	if (standing && ['walk', 'run', 'idle', 'wave', 'nod'].includes(clip.type) && Math.min(...perFrameMin) > tol * 2)
		issues.push(`${clip.id}: never touches the ground during the clip`);
	if (!clip.channels.length) issues.push(`${clip.id}: no parts move — give parts roles (leg, arm, tail, wing, wheel, rotor, head) or add keyframe tracks`);
	return { minY, maxY, lowest, issues };
}

/**
 * Parts passing through each other during a clip. Each posed vertex is taken
 * back into the rest space of every unrelated part and tested against that
 * part's own distance field. Pairs that already overlap at rest are ignored
 * (that is modeling, not motion).
 */
function intersections(b: Build, rig: Rig, clip: SampledClip): string[] {
	const c = b.compiled;
	const prims = c.prims.filter((p) => p.op === 'add' && !p.hidden);
	const related = (a: number, q: number) => a === q || c.prims[a].parent === q || c.prims[q].parent === a;
	const depthLimit = -b.cell * 1.5;
	const test = (f: number | null) => {
		const skin = skinMatrices(rig, jointMatrices(rig, f === null ? null : clip, f ?? 0));
		const inv = new Map<number, M4>();
		for (const p of prims) inv.set(p.index, m4Invert(skin[rig.byPrim.get(p.index) ?? 0]));
		const meshes = f === null ? b.meshes : poseMeshes(b, rig, clip, f);
		const hits = new Map<string, number>();
		for (const m of meshes) {
			const step = Math.max(1, Math.floor(m.positions.length / 3 / 2500));
			for (let v = 0; v < m.positions.length / 3; v += step) {
				const dom = m.vertPrim[v];
				const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
				for (const q of prims) {
					if (related(dom, q.index)) continue;
					const M = inv.get(q.index)!;
					const rx = M[0] * x + M[4] * y + M[8] * z + M[12];
					const ry = M[1] * x + M[5] * y + M[9] * z + M[13] - b.offset[1];
					const rz = M[2] * x + M[6] * y + M[10] * z + M[14];
					const d = primDist(q, rx, ry, rz);
					if (d < depthLimit) {
						const key = [c.prims[dom].id, q.id].sort().join('|');
						hits.set(key, Math.min(hits.get(key) ?? 0, d));
					}
				}
			}
		}
		return hits;
	};
	const rest = test(null);
	const worst = new Map<string, { depth: number; t: number }>();
	const frames = Math.min(clip.times.length, 10);
	for (let s = 0; s < frames; s++) {
		const f = Math.round((s / Math.max(1, frames - 1)) * (clip.times.length - 1));
		for (const [k, d] of test(f)) {
			if (rest.has(k)) continue;
			const w = worst.get(k);
			if (!w || d < w.depth) worst.set(k, { depth: d, t: clip.times[f] });
		}
	}
	return [...worst.entries()]
		.sort((a, z) => a[1].depth - z[1].depth)
		.slice(0, 4)
		.map(([k, w]) => `${clip.id}: ${k.replace('|', ' and ')} pass through each other at t=${w.t.toFixed(2)}s (${(-w.depth * 100).toFixed(1)} cm deep) — lower the amplitude, move the pivot, or angle the part away`);
}
