/**
 * Leg solvers in the sagittal plane.
 *
 * Legs swing about X (the model faces +Z), so a leg pose is two angles in the
 * (y, z) plane of its parent: the hip angle and, for a two-segment leg, the
 * knee angle. Angles are measured with `ang(y, z) = atan2(z, y)`, and a
 * rotation of `a` about +X adds `a` to that angle.
 */

export type YZ = [number, number];

export const ang = (v: YZ) => Math.atan2(v[1], v[0]);
/** Into (-π, π]: a leg pointing down sits right at atan2's seam, and a 2π jump flips the quaternion's sign between frames. */
export const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const len2 = (v: YZ) => Math.hypot(v[0], v[1]);

/** Hip rotation that points a rigid leg (hip → foot `rest`) at `target`. */
export function rigidLeg(rest: YZ, target: YZ): number {
	return wrap(ang(target) - ang(rest));
}

/**
 * Two-bone IK. `knee` and `foot` are rest positions relative to the hip,
 * `target` is where the foot should go. Returns the hip rotation and the knee
 * rotation relative to the thigh. The knee bends the way it bends at rest
 * (forward when the leg is straight), and an out-of-reach target is clamped
 * to the leg's length.
 */
export function twoBoneLeg(knee: YZ, foot: YZ, target: YZ): { hip: number; knee: number; reach: number } {
	const l1 = len2(knee);
	const shin: YZ = [foot[0] - knee[0], foot[1] - knee[1]];
	const l2 = len2(shin);
	const d0 = len2(target) || 1e-6;
	const d = Math.min(Math.max(d0, Math.abs(l1 - l2) + 1e-5), (l1 + l2) * 0.9999);
	const t: YZ = [(target[0] / d0) * d, (target[1] / d0) * d];
	const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
	// which way the knee bends at rest: the sign of thigh × shin
	const restBend = knee[0] * shin[1] - knee[1] * shin[0];
	const candidates = [ang(t) + a, ang(t) - a].map((th) => {
		const k: YZ = [Math.cos(th) * l1, Math.sin(th) * l1];
		const bend = k[0] * (t[1] - k[1]) - k[1] * (t[0] - k[0]);
		return { th, k, bend };
	});
	let pick = candidates[0];
	if (Math.abs(restBend) > 1e-6 * l1 * l2) pick = candidates.find((c) => Math.sign(c.bend) === Math.sign(restBend)) ?? pick;
	else pick = candidates[0].k[1] >= candidates[1].k[1] ? candidates[0] : candidates[1];
	const hip = wrap(pick.th - ang(knee));
	const shinWorld = ang([t[0] - pick.k[0], t[1] - pick.k[1]]) - ang(shin);
	return { hip, knee: wrap(shinWorld - hip), reach: d0 / (l1 + l2) };
}

/** Where a foot is during one gait cycle: stance slides it back on the ground, swing lifts it forward. */
export function footPath(phase: number, duty: number, reach: number, lift: number): { dy: number; dz: number; stance: boolean } {
	const p = ((phase % 1) + 1) % 1;
	if (p < duty) return { dy: 0, dz: reach / 2 - (reach * p) / duty, stance: true };
	const u = (p - duty) / (1 - duty);
	const e = u * u * (3 - 2 * u);
	return { dy: lift * Math.sin(Math.PI * u), dz: -reach / 2 + reach * e, stance: false };
}

/* ------------------------------------------------------------------ arms */

type P3 = [number, number, number];
type Q4 = [number, number, number, number];
const dot3 = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale3 = (a: P3, s: number): P3 => [a[0] * s, a[1] * s, a[2] * s];
const len3 = (a: P3) => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a: P3): P3 => scale3(a, 1 / (len3(a) || 1));

/** Shortest rotation taking direction a to direction b (unit quaternion [x, y, z, w]). */
export function fromTo(a: P3, b: P3): Q4 {
	const u = unit3(a), v = unit3(b);
	const d = dot3(u, v);
	if (d < -0.999999) {
		// opposite: any axis perpendicular to a
		const ax = unit3(Math.abs(u[0]) < 0.9 ? cross3(u, [1, 0, 0]) : cross3(u, [0, 1, 0]));
		return [ax[0], ax[1], ax[2], 0];
	}
	const c = cross3(u, v);
	const w = 1 + d;
	const l = Math.hypot(c[0], c[1], c[2], w);
	return [c[0] / l, c[1] / l, c[2] / l, w / l];
}

const qmul = (a: Q4, b: Q4): Q4 => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const qconj = (q: Q4): Q4 => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q: Q4, v: P3): P3 => {
	const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q));
	return [p[0], p[1], p[2]];
};

/**
 * Two-bone IK in 3D, for an arm. `upper` is shoulder → elbow and `lower`
 * elbow → hand at rest, `target` where the hand should be, all relative to
 * the shoulder in its parent's frame. The elbow bends toward `pole` (the way
 * it bends at rest when the arm is not straight). Returns the shoulder's
 * rotation and the elbow's rotation in the upper arm's frame, and how far
 * the target was within reach (above 1 = stretched as far as it goes).
 */
export function twoBoneArm(upper: P3, lower: P3, target: P3, pole: P3): { shoulder: Q4; elbow: Q4; reach: number } {
	const l1 = len3(upper), l2 = len3(lower);
	const d0 = len3(target) || 1e-6;
	const d = Math.min(Math.max(d0, Math.abs(l1 - l2) + 1e-5), (l1 + l2) * 0.9999);
	const t = scale3(target, 1 / d0);
	// the bend direction: the rest bend if the arm is bent, otherwise the pole
	const restHand: P3 = [upper[0] + lower[0], upper[1] + lower[1], upper[2] + lower[2]];
	const along = unit3(restHand);
	const bentAt = [upper[0] - along[0] * dot3(upper, along), upper[1] - along[1] * dot3(upper, along), upper[2] - along[2] * dot3(upper, along)] as P3;
	const hint = len3(bentAt) > 0.05 * l1 ? bentAt : pole;
	let side: P3 = [hint[0] - t[0] * dot3(hint, t), hint[1] - t[1] * dot3(hint, t), hint[2] - t[2] * dot3(hint, t)];
	if (len3(side) < 1e-6) side = Math.abs(t[1]) < 0.9 ? cross3(t, [0, 1, 0]) : cross3(t, [1, 0, 0]);
	side = unit3(side);
	const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
	const elbowAt: P3 = [
		(t[0] * Math.cos(a) + side[0] * Math.sin(a)) * l1,
		(t[1] * Math.cos(a) + side[1] * Math.sin(a)) * l1,
		(t[2] * Math.cos(a) + side[2] * Math.sin(a)) * l1
	];
	// swing the upper arm onto the elbow, then twist it about itself so the bend lies in the chosen plane
	let shoulder = fromTo(upper, elbowAt);
	const bendNow = cross3(qrot(shoulder, upper), qrot(shoulder, lower));
	const bendWant = cross3(elbowAt, [t[0] * d - elbowAt[0], t[1] * d - elbowAt[1], t[2] * d - elbowAt[2]]);
	if (len3(bendNow) > 1e-9 && len3(bendWant) > 1e-9) {
		const ax = unit3(elbowAt);
		const pn = (v: P3): P3 => unit3([v[0] - ax[0] * dot3(v, ax), v[1] - ax[1] * dot3(v, ax), v[2] - ax[2] * dot3(v, ax)]);
		const u = pn(bendNow), v = pn(bendWant);
		const ang = Math.atan2(dot3(cross3(u, v), ax), dot3(u, v));
		const s = Math.sin(ang / 2);
		shoulder = qmul([ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)], shoulder);
	}
	const lowerNow = qrot(shoulder, lower);
	const want: P3 = [t[0] * d - elbowAt[0], t[1] * d - elbowAt[1], t[2] * d - elbowAt[2]];
	const turn = fromTo(lowerNow, want);
	// the elbow's rotation lives in the upper arm's frame
	const elbow = qmul(qmul(qconj(shoulder), turn), shoulder);
	return { shoulder, elbow, reach: d0 / (l1 + l2) };
}
