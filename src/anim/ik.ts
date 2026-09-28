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
