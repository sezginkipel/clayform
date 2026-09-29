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
	DEG, add, m4Compose, qConj, m4Invert, m4Mul, m4Point, norm, qAxisAngle, qEuler, qFromTo, qIdentity, qMul, qRotate, qSlerp, sub,
	type M4, type Quat, type V3
} from '../core/math.js';
import type { Clip } from '../core/schema.js';
import { footPath, rigidLeg, twoBoneArm, twoBoneLeg } from './ik.js';
import { clothTargets, expressionProblems, meshMorphs } from './morph.js';

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
	/** walking speed the feet are planted for, m/s (move the character at this speed to avoid sliding) */
	speed: number;
	/** the clip is a cycle (last frame = first frame) */
	loop: boolean;
	/** expression weights per frame, by expression id (morph targets) */
	morph?: Record<string, number[]>;
}

/** A leg from the hip down: its top joint, optional knee, and the lowest point of everything it carries. */
export interface LegChain {
	top: number;
	lower: number;
	/** prims that ride on the leg (boots, paws …) */
	subtree: Set<number>;
	/** non-leg parts on the last segment, kept flat on the ground */
	flat: number[];
	hip: V3;
	knee: V3 | null;
	foot: V3;
	/** where the flat foot hinges (its pivot), or the foot point when there is none; IK aims this */
	ankle: V3;
}

/** Legs that stand on the ground at rest, ready for foot planting. */
export function legChains(b: Build, rig: Rig): LegChain[] {
	const prims = b.compiled.prims;
	const legs = prims.filter((p) => p.role === 'leg' && !p.hidden);
	const legSet = new Set(legs.map((p) => p.index));
	const out: LegChain[] = [];
	for (const top of legs.filter((p) => !legSet.has(p.parent))) {
		const subtree = new Set([top.index]);
		for (const p of prims) if (p.parent >= 0 && subtree.has(p.parent)) subtree.add(p.index);
		const lower = prims.find((p) => p.parent === top.index && p.role === 'leg');
		const last = lower ?? top;
		const foot = lowestPoint(b, subtree);
		if (!foot) continue;
		const hip = add(top.pivot, b.offset);
		// only legs that reach the ground and hang down from their hip (a flat flipper-foot rocks, it does not step)
		const drop = hip[1] - foot[1], reachZ = Math.abs(foot[2] - hip[2]);
		if (foot[1] > b.cell * 2 || drop < b.cell * 3 || drop < reachZ * 1.5 || drop < rig.height * 0.08) continue;
		const flat = prims.filter((p) => p.parent === last.index && p.role !== 'leg');
		out.push({
			top: rig.byPrim.get(top.index)!,
			lower: lower ? rig.byPrim.get(lower.index)! : -1,
			subtree,
			flat: flat.map((p) => rig.byPrim.get(p.index)!),
			hip,
			knee: lower ? add(lower.pivot, b.offset) : null,
			foot,
			// a flat foot keeps its shape: its sole moves with its hinge, so the hinge is what the leg reaches for
			ankle: flat.length ? add(flat[0].pivot, b.offset) : foot
		});
	}
	return out;
}

/** Lowest rest point of a set of prims (grounded): the mean of the vertices within half a cell of the bottom. */
function lowestPoint(b: Build, set: Set<number>): V3 | null {
	let minY = Infinity;
	for (const m of b.meshes)
		for (let v = 0; v < m.positions.length / 3; v++)
			if (set.has(m.prim >= 0 ? m.prim : m.vertPrim[v]) && m.positions[v * 3 + 1] < minY) minY = m.positions[v * 3 + 1];
	if (!isFinite(minY)) return null;
	let x = 0, z = 0, n = 0;
	for (const m of b.meshes)
		for (let v = 0; v < m.positions.length / 3; v++)
			if (set.has(m.prim >= 0 ? m.prim : m.vertPrim[v]) && m.positions[v * 3 + 1] < minY + b.cell * 0.5) {
				x += m.positions[v * 3];
				z += m.positions[v * 3 + 2];
				n++;
			}
	return [x / n, minY, z / n];
}

type Motion = { rot?: V3 | Quat; off?: V3; scl?: V3 };
type Driver = (t: number) => Motion;

const PERIOD: Record<string, number> = {
	idle: 2.4, walk: 1.0, run: 0.62, hop: 0.8, fly: 0.5, swim: 1.4, drive: 1.0, spin: 4, hover: 2, wave: 1.2, nod: 1.2,
	attack: 0.9, jump: 1.2, sit: 1.6, turn: 1.2, die: 1.8, reach: 2, point: 1.8, pickup: 2.6, look: 2.4, blink: 3.2, talk: 1.6, expression: 1.6, wind: 2, blend: 0.4, keyframes: 1
};

const TAU = Math.PI * 2;
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** Clips that cycle; the rest play once. */
const LOOPS = new Set(['idle', 'walk', 'run', 'hop', 'fly', 'swim', 'drive', 'spin', 'hover', 'wave', 'nod', 'blink', 'talk', 'wind']);
const isQuat = (r: V3 | Quat): r is Quat => r.length === 4;

function sideOf(p: Prim, cx: number) {
	return p.pivot[0] >= cx ? 1 : -1;
}

/** Procedural drivers per joint for one clip. */
function drivers(b: Build, rig: Rig, clip: Clip): { period: number; drive: Map<number, Driver>; speed: number; followThrough: (duration: number, loop: boolean) => void } {
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
	/** World matrix of a joint at time t from the drivers set so far. */
	const worldAt = (joint: number, t: number): M4 => {
		const jt = rig.joints[joint];
		const m = drive.get(joint)?.(t) ?? {};
		const local = m4Compose(add(jt.local, m.off ?? [0, 0, 0]), toQuat(m.rot), m.scl ?? [1, 1, 1]);
		return jt.parent >= 0 ? m4Mul(worldAt(jt.parent, t), local) : local;
	};
	/** World rotation of a joint at time t from the drivers set so far. */
	const rotAt = (joint: number, t: number): Quat => {
		const jt = rig.joints[joint];
		const r = toQuat(drive.get(joint)?.(t)?.rot);
		return jt.parent >= 0 ? qMul(rotAt(jt.parent, t), r) : r;
	};
	let speed = 0;

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

	/**
	 * Treadmill gait: each foot slides back on the ground during stance and
	 * swings forward in the air; the root drops just enough for the stance feet
	 * to reach, and legs are solved to their targets (two-bone IK, or a rigid
	 * swing with an outward lift to clear the ground). Returns the speed.
	 */
	const plantFeet = (chains: LegChain[], run: boolean): number => {
		const X: V3 = [1, 0, 0], Z: V3 = [0, 0, 1];
		const duty = run ? 0.38 : chains.length >= 6 ? 0.5 : 0.6;
		const two = chains.every((c) => c.lower >= 0);
		const info = chains.map((c) => {
			const rest = sub(c.ankle, c.hip);
			const rigidLen = Math.hypot(rest[1], rest[2]);
			const k = c.knee ? sub(c.knee, c.hip) : null;
			const twoLen = k ? Math.hypot(k[1], k[2]) + Math.hypot(c.ankle[1] - c.knee![1], c.ankle[2] - c.knee![2]) : rigidLen;
			// a rigid leg shortens its vertical reach as it swings: keep the step where that stays under a cell
			const maxReach = k ? (run ? 0.9 : 0.6) * twoLen : Math.min(0.5 * rigidLen, 2 * rigidLen * Math.sin(Math.sqrt((1.6 * b.cell) / rigidLen)));
			return { c, rest, rigidLen, twoLen, maxReach, side: c.hip[0] >= cx ? 1 : -1, phase: phaseOf(prims[rig.joints[c.top].prim]) };
		});
		const reach = Math.min(...info.map((i) => i.maxReach)) * amp;
		const lift = (k: (typeof info)[number]) => (two ? (run ? 0.2 : 0.12) * k.twoLen * amp : b.cell * 3);
		const rootRot = (t: number) => qEuler([run && two ? 6 * amp : 0, 0, (two ? 2 : 1) * amp * w(t)]);
		// how far the root must drop for this leg's foot to reach its target at dz
		const dropFor = (k: (typeof info)[number], rot: Quat, dz: number) => {
			const hip = qRotate(rot, k.c.hip);
			const ty = k.c.ankle[1], tz = k.c.ankle[2] + dz;
			const L = two ? 0.97 * k.twoLen : k.rigidLen;
			const d = hip[1] - ty - Math.sqrt(Math.max(0, L * L - (hip[2] - tz) ** 2));
			return two ? Math.max(0, d) : d;
		};
		set(R, (t) => {
			const rot = rootRot(t);
			let drop = -Infinity;
			for (const k of info) {
				const fp = footPath(t / period + k.phase, duty, reach, 0);
				if (fp.stance) drop = Math.max(drop, dropFor(k, rot, fp.dz));
			}
			if (drop === -Infinity) {
				// flight (run): a short ballistic arc between the push-off and the landing
				const q = (((t / period) % 0.5) + 0.5) % 0.5;
				const u = (q - duty) / (0.5 - duty);
				const tf = (0.5 - duty) * period;
				const d0 = Math.max(...info.map((k) => dropFor(k, rot, -reach / 2)));
				const d1 = Math.max(...info.map((k) => dropFor(k, rot, reach / 2)));
				return { rot, off: [0, -(d0 + (d1 - d0) * u) + ((9.81 * tf * tf) / 8) * Math.sin(Math.PI * u), 0] };
			}
			return { rot, off: [0, -drop, 0] };
		});
		for (const k of info) {
			const c = k.c;
			const jt = rig.joints[c.top];
			let memoT = NaN, memo = { hip: qIdentity(), knee: 0, flat: qIdentity() };
			const solve = (t: number) => {
				if (t === memoT) return memo;
				const fp = footPath(t / period + k.phase, duty, reach, lift(k));
				const target: V3 = [c.ankle[0], c.ankle[1] + fp.dy, c.ankle[2] + fp.dz];
				const Wp = worldAt(jt.parent, t);
				const tp = sub(m4Point(m4Invert(Wp), target), jt.local);
				if (c.knee) {
					const kn = sub(c.knee, c.hip);
					const s2 = twoBoneLeg([kn[1], kn[2]], [k.rest[1], k.rest[2]], [tp[1], tp[2]]);
					memo = { hip: qAxisAngle(X, s2.hip), knee: s2.knee, flat: qAxisAngle(X, -(s2.hip + s2.knee)) };
				} else {
					const a = rigidLeg([k.rest[1], k.rest[2]], [tp[1], tp[2]]);
					let q = qAxisAngle(X, a);
					if (!fp.stance) {
						// a rigid leg cannot shorten: tip it outward until the foot clears its swing height
						const footY = m4Point(Wp, add(jt.local, qRotate(q, k.rest)))[1];
						const need = target[1] - footY;
						if (need > 0) {
							const phi = Math.min(30 * DEG, Math.acos(Math.max(-1, Math.min(1, 1 - need / Math.hypot(...k.rest)))));
							q = qMul(qAxisAngle(Z, k.side * phi), q);
						}
					}
					// the sole stays level: the foot undoes the leg's whole turn, sideways lift included
					memo = { hip: q, knee: 0, flat: qConj(q) };
				}
				memoT = t;
				return memo;
			};
			drive.set(c.top, (t) => ({ rot: solve(t).hip }));
			if (c.lower >= 0) drive.set(c.lower, (t) => ({ rot: qAxisAngle(X, solve(t).knee) }));
			for (const f of c.flat) set(f, (t) => ({ rot: solve(t).flat }));
		}
		return reach / (duty * period);
	};

	/**
	 * Secondary motion: the tip of each tail, ear and antenna is a point on a
	 * damped spring that chases where the tip would be if the part were rigid.
	 * The lag between the two becomes an extra turn at the part's pivot, baked
	 * into the clip. Looping clips are simulated for three cycles and the last
	 * one kept, so the clip still loops.
	 */
	const followThrough = (D: number, loop: boolean) => {
		const springs: Record<string, number> = { tail: 2.2, ear: 3.5, antenna: 3, hair: 2.5, cape: 1.6, cloth: 1.8 };
		const followers = prims.filter((p) => springs[p.role] && !p.hidden && p.op === 'add');
		const dt = 1 / 120;
		for (const p of followers) {
			const J = j(p);
			const jt = rig.joints[J];
			// tip: the point of the part (and what rides on it) farthest from its pivot
			const sub = new Set([p.index]);
			for (const q of prims) if (q.parent >= 0 && sub.has(q.parent)) sub.add(q.index);
			let tip: V3 | null = null, far = 0;
			for (const m of b.meshes) {
				const step = Math.max(1, Math.floor(m.positions.length / 3 / 4000));
				for (let v = 0; v < m.positions.length / 3; v += step) {
					if (!sub.has(m.prim >= 0 ? m.prim : m.vertPrim[v])) continue;
					const q: V3 = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]];
					const d = Math.hypot(q[0] - jt.rest[0], q[1] - jt.rest[1], q[2] - jt.rest[2]);
					if (d > far) { far = d; tip = q; }
				}
			}
			if (!tip || far < b.cell * 2) continue;
			const tipLocal = sub3(tip, jt.rest);
			const omega = TAU * springs[p.role], zeta = 0.3;
			const t0 = loop ? -2 * D : 0;
			const steps = Math.round((D - t0) / dt);
			const keep = Math.round(D / dt);
			const lags: Quat[] = [];
			let x: V3 | null = null, vel: V3 = [0, 0, 0];
			let peak = 0;
			for (let k = 0; k <= steps; k++) {
				const t = t0 + k * dt;
				const W = worldAt(J, t);
				const pivot = m4Point(W, [0, 0, 0]);
				const rigid = m4Point(W, tipLocal);
				if (!x) x = rigid;
				else {
					const acc: V3 = [0, 1, 2].map((a) => omega * omega * (rigid[a] - x![a]) - 2 * zeta * omega * vel[a]) as V3;
					vel = add(vel, [acc[0] * dt, acc[1] * dt, acc[2] * dt]);
					x = add(x, [vel[0] * dt, vel[1] * dt, vel[2] * dt]);
					// stay on the part's length: drop the stretch and the radial speed
					const r = sub3(x, pivot);
					const rl = Math.hypot(...r) || 1;
					x = add(pivot, [(r[0] / rl) * far, (r[1] / rl) * far, (r[2] / rl) * far]);
					const radial = (vel[0] * r[0] + vel[1] * r[1] + vel[2] * r[2]) / rl;
					vel = [vel[0] - (radial * r[0]) / rl, vel[1] - (radial * r[1]) / rl, vel[2] - (radial * r[2]) / rl];
				}
				if (k < steps - keep) continue;
				// the lag as a turn in the parent's frame, applied before the part's own turn
				const Pinv = m4Invert(worldAt(jt.parent, t));
				const dr = norm(sub3(m4Point(Pinv, rigid), m4Point(Pinv, pivot)));
				const ds = norm(sub3(m4Point(Pinv, x), m4Point(Pinv, pivot)));
				const q = qFromTo(dr, ds);
				peak = Math.max(peak, 2 * Math.acos(Math.min(1, Math.abs(q[3]))));
				lags.push(q);
			}
			if (peak < 0.5 * DEG) continue;
			const lagAt = (t: number): Quat => {
				let u = (t / dt) % lags.length;
				if (u < 0) u += lags.length;
				const i = Math.floor(u), f = u - i;
				return qSlerp(lags[Math.min(i, lags.length - 1)], lags[Math.min(i + 1, lags.length - 1)], f);
			};
			const prev = drive.get(J);
			// a one-shot ends at rest, ready for the next clip: the follow-through fades out over its last fifth
			const fade = (t: number) => (loop ? 1 : 1 - smooth(Math.max(0, Math.min(1, (t / D - 0.8) / 0.2))));
			drive.set(J, (t) => {
				const m = prev ? prev(t) : {};
				return { ...m, rot: qMul(qSlerp(qIdentity(), lagAt(t), fade(t)), toQuat(m.rot)) };
			});
		}
	};

	/* ------------------------------------------------- one-shot helpers */
	const smooth = (u: number) => u * u * (3 - 2 * u);
	/** 0 → 1 across [a, b] of the clip, eased. */
	const seg = (t: number, a: number, b2: number) => smooth(Math.max(0, Math.min(1, (t / period - a) / (b2 - a))));
	const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
	/**
	 * Keep the lowest point of the model on the ground while the pose changes
	 * (sitting down, tipping over): the posed mesh is sampled at a few times
	 * with the drivers set so far and the root is lifted or lowered to match.
	 */
	const groundLock = (samples = 24) => {
		const pts: { v: V3; j: number[]; w: number[] }[] = [];
		for (const m of b.meshes) {
			const step = Math.max(1, Math.floor(m.positions.length / 3 / 1500));
			for (let v = 0; v < m.positions.length / 3; v += step) {
				const js: number[] = [], ws: number[] = [];
				for (let k = 0; k < 4; k++) if (m.weights[v * 4 + k] > 0) { js.push(rig.byPrim.get(m.joints[v * 4 + k]) ?? 0); ws.push(m.weights[v * 4 + k]); }
				pts.push({ v: [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]], j: js, w: ws });
			}
		}
		const lows: number[] = [];
		for (let i = 0; i <= samples; i++) {
			const t = (i / samples) * period;
			const skin = rig.joints.map((jt, ji) => m4Mul(worldAt(ji, t), m4Invert(m4Compose(jt.rest, qIdentity()))));
			let low = Infinity;
			for (const p of pts) {
				let y = 0, sw = 0;
				p.j.forEach((ji, k) => {
					y += m4Point(skin[ji], p.v)[1] * p.w[k];
					sw += p.w[k];
				});
				low = Math.min(low, y / (sw || 1));
			}
			lows.push(low);
		}
		set(R, (t) => {
			const u = Math.max(0, Math.min(1, t / period)) * samples;
			const i = Math.min(samples - 1, Math.floor(u)), f = u - i;
			return { off: [0, -(lows[i] + (lows[i + 1] - lows[i]) * f), 0] };
		});
	};
	/**
	 * Keep feet where `target(chain, t)` says (by default where they stand at
	 * rest) while the body moves above them. Rigid legs turn to point at the
	 * target, legs with knees use two-bone IK, and flat feet stay level.
	 * `weight(t)` fades the solve out (0 = leave the leg to other drivers).
	 */
	const plant = (target: (c: LegChain, t: number) => V3 = (c) => c.ankle, weight: (t: number) => number = () => 1, heading: (c: LegChain, t: number) => number = () => 0) => {
		for (const c of legChains(b, rig)) {
			const jt = rig.joints[c.top];
			const rest = sub(c.ankle, c.hip);
			let memoT = NaN, memo = { hip: qIdentity(), knee: qIdentity(), flat: qIdentity() };
			// a planted foot lies flat with its own heading in the world, whatever turns above it (a lean, a turn);
			// as the plant fades out the foot goes back to riding on the leg
			const level = (leg: Quat, t: number, wgt: number) =>
				qMul(qSlerp(qConj(leg), qConj(qMul(rotAt(jt.parent, t), leg)), wgt), qAxisAngle(Y, heading(c, t) * DEG));
			const solve = (t: number) => {
				if (t === memoT) return memo;
				const tp = sub(m4Point(m4Invert(worldAt(jt.parent, t)), target(c, t)), jt.local);
				const wgt = weight(t);
				if (c.knee) {
					const kn = sub(c.knee, c.hip);
					const s2 = twoBoneLeg([kn[1], kn[2]], [rest[1], rest[2]], [tp[1], tp[2]]);
					const hip = qSlerp(qIdentity(), qAxisAngle(X, s2.hip), wgt), knee = qSlerp(qIdentity(), qAxisAngle(X, s2.knee), wgt);
					memo = { hip, knee, flat: level(qMul(hip, knee), t, wgt) };
				} else {
					let q = qFromTo(norm(rest), norm(tp));
					// a rigid leg cannot shorten to lift its foot: tip it outward until the foot reaches the target's height
					const Wp = worldAt(jt.parent, t);
					const goal = target(c, t);
					const need = goal[1] - m4Point(Wp, add(jt.local, qRotate(q, rest)))[1];
					// only for a lifted foot: on the ground a millimetre short is fine, and the tip grows as √need
					if (goal[1] > c.ankle[1] + b.cell * 0.5 && need > 0) {
						const phi = Math.min(30 * DEG, Math.acos(Math.max(-1, Math.min(1, 1 - need / Math.hypot(...rest)))));
						q = qMul(qAxisAngle(Z, (c.hip[0] >= cx ? 1 : -1) * phi), q);
					}
					q = qSlerp(qIdentity(), q, wgt);
					// the foot keeps its own heading in the world, not the body's
					memo = { hip: q, knee: qIdentity(), flat: level(q, t, wgt) };
				}
				memoT = t;
				return memo;
			};
			set(c.top, (t) => ({ rot: solve(t).hip }));
			if (c.lower >= 0) set(c.lower, (t) => ({ rot: solve(t).knee }));
			for (const f of c.flat) set(f, (t) => ({ rot: solve(t).flat }));
		}
	};
	/** A clip's `at`: a world point, or a part's center. */
	function pointOf(at: Clip['at']): V3 | null {
		if (!at) return null;
		if (typeof at !== 'string') return [at[0], at[1], at[2]];
		const p = prims.find((q) => q.id === at);
		return p ? add([(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2], b.offset) : null;
	}
	/** A part and everything attached below it. */
	function subtreeOf(i: number): Set<number> {
		const set = new Set([i]);
		for (const p of prims) if (p.parent >= 0 && set.has(p.parent)) set.add(p.index);
		return set;
	}
	/** The body a part hangs from (the hips a head sits on). */
	function hipsOf(p: Prim): Prim | null {
		let cur: Prim | undefined = p;
		while (cur && cur.parent >= 0) {
			const up: Prim = prims[cur.parent];
			if (up.role === 'body' && (up.parent < 0 || prims[up.parent].role !== 'body')) return up;
			cur = up;
		}
		return null;
	}
	/** The point of a set of parts farthest from `from` (grounded): a fingertip. */
	function tipOf(set: Set<number>, from: V3): V3 {
		let best = from, d = -1;
		for (const m of b.meshes)
			for (let v = 0; v < m.positions.length / 3; v++) {
				if (!set.has(m.prim >= 0 ? m.prim : m.vertPrim[v])) continue;
				const q: V3 = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]];
				const l = (q[0] - from[0]) ** 2 + (q[1] - from[1]) ** 2 + (q[2] - from[2]) ** 2;
				if (l > d) (d = l), (best = q);
			}
		return best;
	}
	/**
	 * Put a hand on a point: a one-piece arm turns to aim its tip at it, an
	 * arm in two parts (an `arm` under an `arm`) bends at the elbow to touch
	 * it. `straight` keeps the elbow straight (pointing). Solved against the
	 * pose of everything above the arm, so a lean or a walk is taken into account.
	 */
	function reachArm(arm: Prim, goal: (t: number) => V3, weight: (t: number) => number, straight = false) {
		const top = j(arm), jt = rig.joints[top];
		const shoulder = jt.rest;
		const fore = prims.find((p) => p.parent === arm.index && p.role === 'arm');
		const tip = tipOf(subtreeOf(arm.index), shoulder);
		const s = sideOf(arm, cx);
		let memoT = NaN, memo = { up: qIdentity(), low: qIdentity() };
		const solve = (t: number) => {
			if (t === memoT) return memo;
			const wgt = weight(t);
			const tp = sub(m4Point(m4Invert(worldAt(jt.parent, t)), goal(t)), jt.local);
			if (fore && !straight) {
				const elbow = add(fore.pivot, b.offset);
				const r = twoBoneArm(sub(elbow, shoulder), sub(tip, elbow), tp, [s * 0.4, -0.5, -1]);
				memo = { up: qSlerp(qIdentity(), r.shoulder, wgt), low: qSlerp(qIdentity(), r.elbow, wgt) };
			} else memo = { up: qSlerp(qIdentity(), qFromTo(sub(tip, shoulder), tp), wgt), low: qIdentity() };
			memoT = t;
			return memo;
		};
		set(top, (t) => ({ rot: solve(t).up }));
		if (fore) set(j(fore), (t) => ({ rot: solve(t).low }));
	}
	/**
	 * Turn the head (and eyes) toward a point, on top of what they already do.
	 * The head turns up to 75° to the side and 40° up or down; eyes take up to
	 * 20° more.
	 */
	function look(goal: (t: number) => V3, weight: (t: number) => number) {
		for (const head of heads) {
			const J = j(head), jt = rig.joints[J];
			const center = add([(head.min[0] + head.max[0]) / 2, (head.min[1] + head.max[1]) / 2, (head.min[2] + head.max[2]) / 2], b.offset);
			const prev = drive.get(J);
			const aim = (t: number, from: V3, jl: V3, parent: number, maxYaw: number, maxPitch: number) => {
				const tp = sub(m4Point(m4Invert(worldAt(parent, t)), goal(t)), add(jl, sub(from, rig.joints[J].rest)));
				const yaw = Math.max(-maxYaw, Math.min(maxYaw, Math.atan2(tp[0], tp[2])));
				const pitch = Math.max(-maxPitch, Math.min(maxPitch, Math.atan2(-tp[1], Math.hypot(tp[0], tp[2]))));
				return { yaw, pitch };
			};
			drive.set(J, (t) => {
				const m = prev ? prev(t) : {};
				const a = aim(t, center, jt.local, jt.parent, 75 * DEG, 40 * DEG);
				const q = qSlerp(qIdentity(), qMul(qAxisAngle(Y, a.yaw), qAxisAngle(X, a.pitch)), weight(t));
				return { ...m, rot: qMul(q, toQuat(m.rot)) };
			});
			for (const eye of prims.filter((p) => p.role === 'eye' && !p.hidden && subtreeOf(head.index).has(p.index))) {
				const E = j(eye), ej = rig.joints[E];
				const ec = add([(eye.min[0] + eye.max[0]) / 2, (eye.min[1] + eye.max[1]) / 2, (eye.min[2] + eye.max[2]) / 2], b.offset);
				const eprev = drive.get(E);
				drive.set(E, (t) => {
					const m = eprev ? eprev(t) : {};
					const tp = sub(m4Point(m4Invert(worldAt(ej.parent, t)), goal(t)), add(ej.local, sub(ec, ej.rest)));
					const yaw = Math.max(-20 * DEG, Math.min(20 * DEG, Math.atan2(tp[0], tp[2])));
					const pitch = Math.max(-20 * DEG, Math.min(20 * DEG, Math.atan2(-tp[1], Math.hypot(tp[0], tp[2]))));
					const q = qSlerp(qIdentity(), qMul(qAxisAngle(Y, yaw), qAxisAngle(X, pitch)), weight(t));
					return { ...m, rot: qMul(q, toQuat(m.rot)) };
				});
			}
		}
	}
	// the model's right arm (-X) is the one that strikes, unless a target is named
	const strikeArm = clip.target ? prims.find((p) => p.id === clip.target) : topArms.slice().sort((a, c) => a.pivot[0] - c.pivot[0])[0];

	switch (clip.type) {
		case 'attack': {
			// wind up, strike fast, recover; creatures without arms lunge and snap with the head
			const wind = (t: number) => seg(t, 0, 0.35), hit = (t: number) => seg(t, 0.35, 0.5), back = (t: number) => seg(t, 0.55, 1);
			const curve = (t: number, up: number, down: number) => (up * wind(t) + (down - up) * hit(t) - down * back(t)) * amp;
			if (strikeArm) {
				// overhead: the arm goes up and slightly forward, then chops forward and down
				set(j(strikeArm), (t) => ({ rot: [curve(t, -150, -55), 0, 0] }));
				topArms.filter((p) => p !== strikeArm).forEach((p) => set(j(p), (t) => ({ rot: [curve(t, 20, -15), 0, sideOf(p, cx) * 12 * amp * (wind(t) - back(t))] })));
				set(R, (t) => ({ rot: [curve(t, -5, 9), 0, 0] }));
				heads.forEach((p) => set(j(p), (t) => ({ rot: [curve(t, -6, 10), 0, 0] })));
			} else {
				set(R, (t) => ({ rot: [curve(t, -6, 12), 0, 0] }));
				heads.forEach((p) => set(j(p), (t) => ({ rot: [curve(t, -18, 14), 0, 0] })));
			}
			// the lean pivots over planted feet
			plant();
			tails.forEach((p) => set(j(p), (t) => ({ rot: [0, curve(t, 20, -25), 0] })));
			ears.forEach((p) => set(j(p), (t) => ({ rot: [curve(t, 12, -12), 0, 0] })));
			groundLock();
			break;
		}
		case 'jump': {
			// crouch, launch, a ballistic arc, land with a squash, recover
			const crouch = (t: number) => seg(t, 0, 0.22) - seg(t, 0.22, 0.32);
			const land = (t: number) => seg(t, 0.78, 0.84) - seg(t, 0.84, 1);
			const air = (t: number) => {
				const u = (t / period - 0.3) / (0.78 - 0.3);
				return u > 0 && u < 1 ? 4 * u * (1 - u) : 0;
			};
			set(R, (t) => {
				const sq = 1 - 0.16 * amp * (crouch(t) + land(t)) + 0.08 * amp * Math.min(1, air(t) * 3) * (1 - air(t));
				return { off: [0, h * 0.4 * amp * air(t), 0], scl: [1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)] };
			});
			// on the ground the feet hold their spot through the squash; in the air they tuck
			const grounded = (t: number) => (t / period < 0.3 || t / period > 0.78 ? 1 : 0);
			plant(undefined, grounded);
			topLegs.forEach((p) => set(j(p), (t) => ({ rot: [-28 * amp * air(t), 0, 0] })));
			lowerLegs.forEach((p) => set(j(p), (t) => ({ rot: [45 * amp * air(t), 0, 0] })));
			topArms.forEach((p) => set(j(p), (t) => ({ rot: [-60 * amp * air(t) + 25 * amp * crouch(t), 0, sideOf(p, cx) * 25 * amp * air(t)] })));
			wings.forEach((p) => set(j(p), (t) => ({ rot: [0, 0, sideOf(p, cx) * 30 * amp * air(t)] })));
			tails.forEach((p) => set(j(p), (t) => ({ rot: [-15 * amp * air(t), 0, 0] })));
			ears.forEach((p) => set(j(p), (t) => ({ rot: [-15 * amp * air(t) + 10 * amp * land(t), 0, 0] })));
			break;
		}
		case 'sit': {
			// sit down and stay: two legs stretch forward on the ground, four legs fold the back pair under
			const down = (t: number) => seg(t, 0, 0.6);
			const four = topLegs.length >= 4;
			if (four) {
				const back = topLegs.filter((p) => p.pivot[2] < cz), front = topLegs.filter((p) => p.pivot[2] >= cz);
				const pitch = 28 * amp;
				set(R, (t) => ({ rot: [-pitch * down(t), 0, 0] }));
				// front legs stay upright in the world, the back legs fold forward under the body
				front.forEach((p) => set(j(p), (t) => ({ rot: [pitch * down(t), 0, 0] })));
				back.forEach((p) => set(j(p), (t) => ({ rot: [-(70 * amp - pitch) * down(t), 0, 0] })));
				tails.forEach((p) => set(j(p), (t) => ({ rot: [25 * amp * down(t), 0, 0] })));
				heads.forEach((p) => set(j(p), (t) => ({ rot: [-pitch * 0.6 * down(t), 0, 0] })));
			} else {
				set(R, (t) => ({ rot: [-6 * amp * down(t), 0, 0] }));
				topLegs.forEach((p) => set(j(p), (t) => ({ rot: [-84 * amp * down(t), 0, 0] })));
				topArms.forEach((p) => set(j(p), (t) => ({ rot: [-35 * amp * down(t), 0, sideOf(p, cx) * 8 * amp * down(t)] })));
				heads.forEach((p) => set(j(p), (t) => ({ rot: [4 * amp * down(t), 0, 0] })));
			}
			groundLock();
			break;
		}
		case 'turn': {
			// a quarter turn to the left in place, in three small steps per foot; amplitude scales the angle
			const total = 90 * amp;
			const chains = legChains(b, rig);
			const steps = 3;
			// feet step in the gait's pairs (alternating for two legs, diagonals for four)
			const stepYaw = (phase: number, t: number) => {
				const u = t / period;
				let done = 0;
				for (let k = 0; k < steps; k++) {
					const a = 0.08 + (k * 2 + (phase ? 1 : 0)) * (0.84 / (steps * 2));
					done += smooth(Math.max(0, Math.min(1, (u - a) / (0.84 / (steps * 2)))));
				}
				return (total * done) / steps;
			};
			const phases = chains.map((c) => phaseOf(prims[rig.joints[c.top].prim]));
			// the body turns with the average of its feet, so planted feet stay under it
			const bodyYaw = (t: number) => (chains.length ? phases.reduce((sum, ph) => sum + stepYaw(ph, t), 0) / chains.length : total * seg(t, 0.1, 0.9));
			set(R, (t) => ({ rot: qAxisAngle(Y, bodyYaw(t) * DEG) }));
			heads.forEach((p) => set(j(p), (t) => ({ rot: [0, 0.2 * total * (seg(t, 0, 0.3) - seg(t, 0.6, 1)), 0] })));
			const lift = b.cell * 3;
			const index = new Map(chains.map((c, i) => [c.top, i]));
			plant((c, t) => {
				const ph = phases[index.get(c.top)!];
				const yaw = stepYaw(ph, t);
				// lift during this foot's own steps: where its yaw is changing
				const moving = Math.abs(stepYaw(ph, t + 0.01) - yaw) > 1e-4 ? 1 : 0;
				const frac = (yaw / total) * steps;
				const up = moving ? Math.sin(Math.PI * (frac - Math.floor(frac))) : 0;
				return add(qRotate(qAxisAngle(Y, yaw * DEG), c.ankle), [0, lift * up, 0]);
			}, undefined, (c, t) => stepYaw(phases[index.get(c.top)!], t));
			tails.forEach((p) => set(j(p), (t) => ({ rot: [0, -0.3 * total * (seg(t, 0.1, 0.5) - seg(t, 0.5, 0.95)), 0] })));
			break;
		}
		case 'die': {
			// stagger back, tip over onto the right side with gravity, a small bounce, then lie still
			const stagger = (t: number) => seg(t, 0, 0.18) - seg(t, 0.18, 0.4);
			const fall = (t: number) => {
				const u = Math.max(0, Math.min(1, (t / period - 0.15) / 0.4));
				return u * u; // accelerating like a fall
			};
			const bounce = (t: number) => {
				const u = (t / period - 0.55) / 0.15;
				return u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0;
			};
			set(R, (t) => ({ rot: qMul(qAxisAngle(Z, (88 * fall(t) - 7 * bounce(t)) * amp * DEG), qEuler([-8 * amp * stagger(t), 0, 0])) }));
			// arms fall along the body: the upper (left) one forward over it, the lower one out on the ground
			topArms.forEach((p) => set(j(p), (t) => ({ rot: [(-25 * stagger(t) - (sideOf(p, cx) > 0 ? 35 : 15) * seg(t, 0.3, 0.8)) * amp, 0, (sideOf(p, cx) > 0 ? -8 : -25) * amp * seg(t, 0.2, 0.7)] })));
			topLegs.forEach((p) => set(j(p), (t) => ({ rot: [(sideOf(p, cx) > 0 ? -12 : 6) * amp * seg(t, 0.3, 0.8), 0, 0] })));
			heads.forEach((p) => set(j(p), (t) => ({ rot: [8 * amp * seg(t, 0.1, 0.4), 0, 8 * amp * seg(t, 0.5, 0.9)] })));
			tails.forEach((p) => set(j(p), (t) => ({ rot: [0, 0, -20 * amp * seg(t, 0.5, 0.9)] })));
			wings.forEach((p) => set(j(p), (t) => ({ rot: [0, 0, sideOf(p, cx) * 30 * amp * seg(t, 0.3, 0.8)] })));
			groundLock();
			break;
		}
		case 'walk':
		case 'run': {
			const run = clip.type === 'run';
			const legA = (run ? 42 : 26) * amp, armA = (run ? 38 : 20) * amp;
			const chains = legChains(b, rig);
			const planted = chains.length > 0 && chains.length === topLegs.length;
			topArms.forEach((p) => {
				const same = topLegs.find((l) => sideOf(l, cx) === sideOf(p, cx));
				const ph = same ? phaseOf(same) + 0.5 : sideOf(p, cx) > 0 ? 0.5 : 0;
				set(j(p), (t) => ({ rot: [armA * w(t, ph), 0, 0] }));
			});
			if (planted) speed = plantFeet(chains, run);
			else {
				topLegs.forEach((p) => set(j(p), (t) => ({ rot: [legA * w(t, phaseOf(p)), 0, 0] })));
				lowerLegs.forEach((p) => set(j(p), (t) => ({ rot: [Math.max(0, -w(t, phaseOf(p) - 0.15)) * legA * 1.2, 0, 0] })));
				const bob = h * (run ? 0.04 : 0.018) * amp;
				set(R, (t) => ({
					off: [0, bob * (0.5 - 0.5 * Math.cos(TAU * 2 * (t / period))), 0],
					rot: qEuler([run ? 7 * amp : 0, 0, 2.5 * amp * w(t)])
				}));
			}
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
		case 'reach':
		case 'point':
		case 'pickup': {
			const arm = clip.target ? prims.find((p) => p.id === clip.target) : topArms.slice().sort((a, c) => a.pivot[0] - c.pivot[0])[0];
			if (!arm) break;
			const s = sideOf(arm, cx);
			const shoulder = add(arm.pivot, b.offset);
			const len = Math.hypot(...sub(tipOf(subtreeOf(arm.index), shoulder), shoulder));
			// where to go: the named point, or in front of the shoulder (reach, point), or on the ground in front (pickup)
			const goal: V3 =
				pointOf(clip.at) ??
				(clip.type === 'pickup' ? [shoulder[0] * 0.6, b.cell, shoulder[2] + h * 0.28] : clip.type === 'point' ? [shoulder[0] + s * len * 0.4, shoulder[1] + len * 0.3, shoulder[2] + len * 3] : [shoulder[0], shoulder[1] - len * 0.1, shoulder[2] + len * 0.8]);
			// out, hold, back; pointing holds longer
			const hold = clip.type === 'point' ? [0.3, 0.75] : clip.type === 'pickup' ? [0.4, 0.55] : [0.35, 0.65];
			const weight = (t: number) => seg(t, 0, hold[0]) - seg(t, hold[1], 1);
			if (clip.type === 'pickup') {
				// bend at the hips until the hand can reach the ground: the smallest lean that brings the shoulder within reach
				const hips = hipsOf(arm);
				if (hips) {
					// the bend is at the hip joints, so the legs keep their length and the feet stay put
					const own = topLegs.filter((p) => subtreeOf(hips.index).has(p.index));
					const hp: V3 = own.length ? add([0, 0, 0].map((_, k) => own.reduce((sm, p) => sm + p.pivot[k], 0) / own.length) as V3, b.offset) : add(hips.pivot, b.offset);
					const arm0 = sub(hp, add(hips.pivot, b.offset));
					let lean = 0;
					for (let a = 0; a <= 80; a += 2) {
						lean = a;
						const q = qAxisAngle(X, a * DEG);
						const sh = add(hp, qRotate(q, sub(shoulder, hp)));
						if (Math.hypot(...sub(goal, sh)) < len * 0.97) break;
					}
					set(j(hips), (t) => {
						const q = qAxisAngle(X, lean * amp * weight(t) * DEG);
						return { rot: q, off: sub(arm0, qRotate(q, arm0)) };
					});
					plant();
					groundLock();
				}
			}
			reachArm(arm, (t) => goal, weight, clip.type === 'point');
			// the other arm hangs back a little, the head looks where the hand goes
			topArms.filter((p) => p !== arm).forEach((p) => set(j(p), (t) => ({ rot: [-6 * amp * weight(t), 0, sideOf(p, cx) * 4 * amp * weight(t)] })));
			if (!clip.lookAt) look(() => goal, weight);
			break;
		}
		case 'talk': {
			// the head bobs a little with the syllables
			heads.forEach((p) => set(j(p), (t) => ({ rot: [2.5 * amp * syllables(t / period), 0, 0] })));
			break;
		}
		case 'look': {
			const goal = pointOf(clip.at);
			if (!goal) break;
			look(() => goal, (t) => seg(t, 0, 0.3) - seg(t, 0.7, 1));
			break;
		}
		case 'keyframes':
			break;
	}
	// a clip-wide gaze on top of whatever the clip does
	const gaze = pointOf(clip.lookAt);
	if (gaze) look(() => gaze, () => 1);
	return { period, drive, speed, followThrough };
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
	if (clip.type === 'blend') return sampleBlend(b, rig, clip);
	const { period, drive, speed, followThrough } = drivers(b, rig, clip);
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
	// after the keyframe tracks, so the springs feel everything that moves
	if (clip.secondary !== false) followThrough(duration, LOOPS.has(clip.type));
	const fps = clip.fps ?? 30;
	const frames = Math.max(2, Math.round(duration * fps) + 1);
	const times = Array.from({ length: frames }, (_, i) => (i / (frames - 1)) * duration);
	const channels: Channel[] = [];
	for (const [joint, f] of drive) {
		const rot: Quat[] = [], off: V3[] = [], scl: V3[] = [];
		let hasScl = false;
		for (const t of times) {
			const m = f(t);
			let q = toQuat(m.rot);
			// q and -q are the same turn, but interpolating across a sign flip spins the long way
			const prev = rot[rot.length - 1];
			if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
			rot.push(q);
			off.push(m.off ?? [0, 0, 0]);
			scl.push(m.scl ?? [1, 1, 1]);
			if (m.scl) hasScl = true;
		}
		channels.push({ joint, rot, off, scl: hasScl ? scl : null });
	}
	const morph = faceWeights(b, clip, times, period);
	return { id: clip.id, type: clip.type, duration, fps, times, channels, speed, loop: LOOPS.has(clip.type), ...(morph ? { morph } : {}) };
}

/** Mouth opening over one talk cycle (0..1 of it): six syllables of different sizes, then a pause. */
function syllables(u: number): number {
	const AMP = [0.9, 0.45, 1, 0.3, 0.75, 0.55, 0, 0];
	const x = (((u % 1) + 1) % 1) * AMP.length;
	const i = Math.floor(x), f = x - i;
	return AMP[i] * Math.sin(Math.PI * f) ** 0.8;
}

/** Expression weights per frame for the face clips and the `face` layer, or nothing when the clip has no face. */
function faceWeights(b: Build, clip: Clip, times: number[], period: number): Record<string, number[]> | undefined {
	const exprs = b.source.expressions ?? [];
	const made = new Set(exprs.filter((e) => !expressionProblems(b).some((p) => p.startsWith(`expression "${e.id}"`))).map((e) => e.id));
	const pick = (preset: string) => clip.expression ?? exprs.find((e) => e.preset === preset)?.id ?? exprs.find((e) => e.id === preset)?.id;
	const curves: Record<string, (t: number) => number> = {};
	const smooth = (u: number) => u * u * (3 - 2 * u);
	const seg = (t: number, a: number, c: number) => smooth(Math.max(0, Math.min(1, (t / period - a) / (c - a))));
	const amp = Math.min(1, clip.amplitude ?? 1);
	if (clip.type === 'blink') {
		const id = pick('blink');
		// a quick close, a moment shut, a slower open
		if (id) curves[id] = (t) => amp * (seg(t, 0.1, 0.14) - seg(t, 0.16, 0.22));
	} else if (clip.type === 'talk') {
		const id = pick('open_mouth');
		if (id) curves[id] = (t) => amp * syllables(t / period);
	} else if (clip.type === 'expression' && clip.expression) curves[clip.expression] = (t) => amp * (seg(t, 0, 0.25) - seg(t, 0.75, 1));
	for (const [id, wgt] of Object.entries(clip.face ?? {})) {
		const prev = curves[id];
		curves[id] = prev ? (t) => Math.min(1, prev(t) + wgt) : () => wgt;
	}
	const ids = Object.keys(curves).filter((id) => made.has(id));
	const out: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, times.map((t) => Math.max(0, Math.min(1, curves[id](t))))]));
	// cloth ripples in every clip; a loop fits a whole number of waves so it has no seam
	const D = times[times.length - 1] || period;
	for (const c of clothTargets(b)) {
		const cycles = LOOPS.has(clip.type) ? Math.max(1, Math.round(c.frequency * D)) : c.frequency * D;
		const th = (t: number) => (TAU * cycles * t) / D;
		out[c.ids[0]] = times.map((t) => Math.max(0, Math.cos(th(t))));
		out[c.ids[1]] = times.map((t) => Math.max(0, Math.sin(th(t))));
		out[c.ids[2]] = times.map((t) => Math.max(0, -Math.cos(th(t))));
		out[c.ids[3]] = times.map((t) => Math.max(0, -Math.sin(th(t))));
	}
	return Object.keys(out).length ? out : undefined;
}

/**
 * A crossfade from one clip into another. The first clip keeps playing from
 * its start while its weight eases out; the second is timed so that it
 * reaches its own start exactly when the blend ends, so playing it next is
 * seamless. Walk and run share their phase convention, so they blend in step.
 */
function sampleBlend(b: Build, rig: Rig, clip: Clip): SampledClip {
	const all = b.compiled.scene.clips ?? [];
	const from = all.find((c) => c.id === clip.from), to = all.find((c) => c.id === clip.to);
	if (!from || !to || from.type === 'blend' || to.type === 'blend') throw new Error(`blend ${clip.id} needs "from" and "to" naming two ordinary clips`);
	const A = sampleClip(b, rig, from), B = sampleClip(b, rig, to);
	const duration = clip.duration ?? PERIOD.blend / (clip.speed ?? 1);
	const fps = clip.fps ?? 30;
	const frames = Math.max(2, Math.round(duration * fps) + 1);
	const times = Array.from({ length: frames }, (_, i) => (i / (frames - 1)) * duration);
	const at = (c: SampledClip, joint: number, t: number) => {
		const ch = c.channels.find((x) => x.joint === joint);
		if (!ch) return { rot: qIdentity(), off: [0, 0, 0] as V3, scl: [1, 1, 1] as V3 };
		let u = c.loop ? ((t % c.duration) + c.duration) % c.duration : Math.max(0, Math.min(c.duration, t));
		u = (u / c.duration) * (c.times.length - 1);
		const i = Math.min(c.times.length - 2, Math.floor(u)), f = u - i;
		const o0 = ch.off[i], o1 = ch.off[i + 1];
		const s0 = ch.scl?.[i] ?? [1, 1, 1], s1 = ch.scl?.[i + 1] ?? [1, 1, 1];
		return {
			rot: qSlerp(ch.rot[i], ch.rot[i + 1], f),
			off: [0, 1, 2].map((k) => o0[k] + (o1[k] - o0[k]) * f) as V3,
			scl: [0, 1, 2].map((k) => s0[k] + (s1[k] - s0[k]) * f) as V3
		};
	};
	const joints = [...new Set([...A.channels, ...B.channels].map((c) => c.joint))];
	const channels: Channel[] = joints.map((joint) => {
		const rot: Quat[] = [], off: V3[] = [], scl: V3[] = [];
		let hasScl = false;
		for (const t of times) {
			const w = t / duration, s = w * w * (3 - 2 * w);
			const a = at(A, joint, t), z = at(B, joint, t - duration);
			let q = qSlerp(a.rot, z.rot, s);
			const prev = rot[rot.length - 1];
			if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
			rot.push(q);
			off.push([0, 1, 2].map((k) => a.off[k] + (z.off[k] - a.off[k]) * s) as V3);
			const sc = [0, 1, 2].map((k) => a.scl[k] + (z.scl[k] - a.scl[k]) * s) as V3;
			if (sc.some((v) => Math.abs(v - 1) > 1e-6)) hasScl = true;
			scl.push(sc);
		}
		return { joint, rot, off, scl: hasScl ? scl : null };
	});
	// the face crossfades too; cloth keeps rippling
	const morph = faceWeights(b, clip, times, duration) ?? {};
	for (const id of new Set([...Object.keys(A.morph ?? {}), ...Object.keys(B.morph ?? {})])) {
		if (morph?.[id] && /_flutter\d$/.test(id)) continue;
		const at = (c: SampledClip, t: number) => {
			const w = c.morph?.[id];
			if (!w) return 0;
			const u = (((t % c.duration) + c.duration) % c.duration) / c.duration * (w.length - 1);
			const i = Math.min(w.length - 2, Math.floor(u)), f = u - i;
			return w[i] + (w[i + 1] - w[i]) * f;
		};
		morph[id] = times.map((t) => {
			const e = t / duration, k = e * e * (3 - 2 * e);
			return at(A, t) * (1 - k) + at(B, t - duration + B.duration) * k;
		});
	}
	return { id: clip.id, type: 'blend', duration, fps, times, channels, speed: (A.speed + B.speed) / 2, loop: false, ...(Object.keys(morph).length ? { morph } : {}) };
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
		// the face first, then the skeleton carries it
		let src = m.positions, nrm = m.normals;
		if (clip?.morph) {
			const fi = Math.min(f, clip.times.length - 1);
			const targets = meshMorphs(b, m).filter((t) => (clip.morph![t.id]?.[fi] ?? 0) > 0);
			if (targets.length) {
				src = new Float32Array(m.positions);
				nrm = new Float32Array(m.normals);
				for (const t of targets) {
					const wgt = clip.morph[t.id][fi];
					for (let i = 0; i < src.length; i++) {
						src[i] += t.dp[i] * wgt;
						nrm[i] += t.dn[i] * wgt;
					}
				}
			}
		}
		for (let v = 0; v < n; v++) {
			const x = src[v * 3], y = src[v * 3 + 1], z = src[v * 3 + 2];
			const nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
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
	/** per planted leg: the worst slide while its foot is on the ground, and the highest it floats during stance (m) */
	feet: { leg: string; slide: number; contacts: number }[];
}

/** A leg's lowest point in a posed frame, and the vertices (mesh, index) within half a cell of it: the sole touching the ground. */
function footSole(meshes: MeshData[], c: LegChain, cell: number): { y: number; sole: [number, number][] } {
	let minY = Infinity;
	meshes.forEach((m) => {
		for (let v = 0; v < m.positions.length / 3; v++)
			if (c.subtree.has(m.prim >= 0 ? m.prim : m.vertPrim[v]) && m.positions[v * 3 + 1] < minY) minY = m.positions[v * 3 + 1];
	});
	const sole: [number, number][] = [];
	meshes.forEach((m, mi) => {
		for (let v = 0; v < m.positions.length / 3; v++)
			if (c.subtree.has(m.prim >= 0 ? m.prim : m.vertPrim[v]) && m.positions[v * 3 + 1] < minY + cell * 0.5) sole.push([mi, v]);
	});
	return { y: minY, sole };
}

const meanXZ = (meshes: MeshData[], sole: [number, number][]): [number, number] => {
	let x = 0, z = 0;
	for (const [mi, v] of sole) {
		x += meshes[mi].positions[v * 3];
		z += meshes[mi].positions[v * 3 + 2];
	}
	return [x / Math.max(1, sole.length), z / Math.max(1, sole.length)];
};

export function critiqueClip(b: Build, rig: Rig, clip: SampledClip, standing: boolean): MotionReport {
	const samples = Math.min(clip.times.length, 16);
	let minY = Infinity, maxY = -Infinity, lowest = { t: 0, y: Infinity };
	const issues: string[] = [];
	const perFrameMin: number[] = [];
	// sitting down and falling over move the feet on purpose; a blend mixes two gaits
	const chains = standing && !['sit', 'die', 'blend'].includes(clip.type) ? legChains(b, rig) : [];
	// foot sliding: while a foot is down, the same sole points should move back at exactly the clip's speed
	const slip = chains.map(() => ({ worst: 0, contacts: 0, run: null as null | { t: number; sole: [number, number][]; at: [number, number] } }));
	for (let s = 0; s < samples; s++) {
		const f = Math.round((s / Math.max(1, samples - 1)) * (clip.times.length - 1));
		const meshes = poseMeshes(b, rig, clip, f);
		chains.forEach((c, i) => {
			const st = slip[i];
			const fs = footSole(meshes, c, b.cell);
			// down = within half a cell of the ground (a swinging foot skims higher than that)
			if (fs.y >= b.cell * 0.5) {
				st.run = null;
				return;
			}
			st.contacts++;
			if (!st.run) {
				st.run = { t: clip.times[f], sole: fs.sole, at: meanXZ(meshes, fs.sole) };
				return;
			}
			const [x, z] = meanXZ(meshes, st.run.sole);
			st.worst = Math.max(st.worst, Math.hypot(x - st.run.at[0], z - st.run.at[1] + clip.speed * (clip.times[f] - st.run.t)));
		});
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
	// a face or cloth that changes counts as motion
	const morphs = Object.values(clip.morph ?? {}).some((w) => Math.max(...w) - Math.min(...w) > 1e-3);
	if (!clip.channels.length && !morphs) issues.push(`${clip.id}: no parts move — give parts roles (leg, arm, tail, wing, wheel, rotor, head), add keyframe tracks, or give a sheet cloth`);

	const feet = chains.map((c, i) => ({ leg: rig.joints[c.top].name, slide: slip[i].worst, contacts: slip[i].contacts }));
	const slipTol = Math.max(b.cell * 2, 0.01);
	for (const f of feet)
		if (f.slide > slipTol)
			issues.push(`${clip.id}: ${f.leg} slides ${(f.slide * 100).toFixed(1)} cm while its foot is on the ground${clip.speed ? ` (the clip walks at ${clip.speed.toFixed(2)} m/s)` : ''} — plant the foot or lower the amplitude`);
	return { minY, maxY, lowest, issues, feet };
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
