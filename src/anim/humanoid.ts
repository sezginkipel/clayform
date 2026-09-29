/**
 * Standard bone names for exported skeletons.
 *
 * The rig has one joint per part, named after the part. Retargeting tools
 * (Unity Humanoid, Mixamo, Unreal's IK retargeter) look for a fixed set of
 * bones instead: hips, a spine, upper and lower arm, hand, upper and lower
 * leg, foot. This finds those bones among the parts by role and side, and
 * adds the ones a part-based character does not have (a spine between the
 * hips and the shoulders, a forearm on a one-piece arm, a shin on a
 * one-piece leg) as extra joints that no vertex is bound to. They sit on the
 * chain between the parts, so the motion of the model does not change;
 * rigid limbs stay rigid, the extra bones only give the retargeter somewhere
 * to put a bend.
 */

import type { Build } from '../core/build.js';
import { add, sub, type V3 } from '../core/math.js';
import { legChains, type Rig } from './rig.js';

export type SkeletonNaming = 'parts' | 'humanoid' | 'mixamo' | 'unreal';

export type Bone =
	| 'Hips' | 'Spine' | 'Neck' | 'Head' | 'LeftEye' | 'RightEye'
	| 'LeftUpperArm' | 'LeftLowerArm' | 'LeftHand' | 'RightUpperArm' | 'RightLowerArm' | 'RightHand'
	| 'LeftUpperLeg' | 'LeftLowerLeg' | 'LeftFoot' | 'RightUpperLeg' | 'RightLowerLeg' | 'RightFoot';

/** The bones every humanoid retargeter needs. */
export const REQUIRED_BONES: Bone[] = [
	'Hips', 'Spine', 'Head',
	'LeftUpperArm', 'LeftLowerArm', 'LeftHand', 'RightUpperArm', 'RightLowerArm', 'RightHand',
	'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot'
];

const MIXAMO: Record<Bone, string> = {
	Hips: 'Hips', Spine: 'Spine', Neck: 'Neck', Head: 'Head', LeftEye: 'LeftEye', RightEye: 'RightEye',
	LeftUpperArm: 'LeftArm', LeftLowerArm: 'LeftForeArm', LeftHand: 'LeftHand',
	RightUpperArm: 'RightArm', RightLowerArm: 'RightForeArm', RightHand: 'RightHand',
	LeftUpperLeg: 'LeftUpLeg', LeftLowerLeg: 'LeftLeg', LeftFoot: 'LeftFoot',
	RightUpperLeg: 'RightUpLeg', RightLowerLeg: 'RightLeg', RightFoot: 'RightFoot'
};

const UNREAL: Record<Bone, string> = {
	Hips: 'pelvis', Spine: 'spine_01', Neck: 'neck_01', Head: 'head', LeftEye: 'FACIAL_L_Eye', RightEye: 'FACIAL_R_Eye',
	LeftUpperArm: 'upperarm_l', LeftLowerArm: 'lowerarm_l', LeftHand: 'hand_l',
	RightUpperArm: 'upperarm_r', RightLowerArm: 'lowerarm_r', RightHand: 'hand_r',
	LeftUpperLeg: 'thigh_l', LeftLowerLeg: 'calf_l', LeftFoot: 'foot_l',
	RightUpperLeg: 'thigh_r', RightLowerLeg: 'calf_r', RightFoot: 'foot_r'
};

export function boneName(bone: Bone, naming: SkeletonNaming): string {
	return naming === 'mixamo' ? `mixamorig:${MIXAMO[bone]}` : naming === 'unreal' ? UNREAL[bone] : bone;
}

export interface ExportJoint {
	/** the rig joint it is, or -1 for an added bone */
	joint: number;
	/** standard bone it plays, if any */
	bone?: Bone;
	/** name for an added bone that plays no standard role */
	name?: string;
	parent: number;
	rest: V3;
}

/**
 * The skeleton as exported: the rig's joints first, in rig order (so skin
 * indices do not move), then the added bones. Parents may change: the arms
 * and head hang from the added spine, a hand from the added forearm.
 */
export interface ExportSkeleton {
	joints: ExportJoint[];
	/** the standard bones found, by name */
	bones: Partial<Record<Bone, number>>;
	/** standard bones that could not be placed (not a humanoid, or missing a limb) */
	missing: Bone[];
}

export function partsSkeleton(rig: Rig): ExportSkeleton {
	return { joints: rig.joints.map((j, i) => ({ joint: i, parent: j.parent, rest: j.rest })), bones: {}, missing: [] };
}

/** Local translation of each exported joint: its rest minus its parent's. */
export function exportLocals(s: ExportSkeleton): V3[] {
	return s.joints.map((j) => (j.parent >= 0 ? sub(j.rest, s.joints[j.parent].rest) : j.rest));
}

export function humanoidSkeleton(b: Build, rig: Rig): ExportSkeleton {
	const prims = b.compiled.prims;
	const s = partsSkeleton(rig);
	const J = s.joints;
	const role = (i: number) => (i >= 0 && i < rig.joints.length && rig.joints[i].prim >= 0 ? prims[rig.joints[i].prim].role : '');
	const visible = (i: number) => i < rig.joints.length && rig.joints[i].prim >= 0 && !prims[rig.joints[i].prim].hidden;
	const side = (i: number) => (J[i].rest[0] >= 0 ? 'Left' : 'Right');
	const children = (i: number) => J.map((j, k) => (j.parent === i ? k : -1)).filter((k) => k >= 0);
	const mark = (bone: Bone, i: number) => {
		if (s.bones[bone] === undefined) {
			s.bones[bone] = i;
			J[i].bone = bone;
		}
	};
	const addBone = (bone: Bone, parent: number, rest: V3) => {
		J.push({ joint: -1, parent, rest });
		mark(bone, J.length - 1);
		return J.length - 1;
	};
	const reparent = (i: number, parent: number) => (J[i].parent = parent);

	// hips: the body the rest hangs from (the first body part under the root)
	const hips = rig.joints.findIndex((j, i) => i > 0 && role(i) === 'body' && j.parent === 0);
	if (hips < 0) return { ...s, missing: [...REQUIRED_BONES] };
	mark('Hips', hips);
	const below = (i: number, top: number) => {
		for (let k = i; k >= 0; k = J[k].parent) if (k === top) return true;
		return false;
	};

	const head = rig.joints.findIndex((_, i) => role(i) === 'head' && below(i, hips));
	const arms = rig.joints.map((_, i) => i).filter((i) => role(i) === 'arm' && visible(i) && role(J[i].parent) !== 'arm' && below(i, hips));
	const shoulders = arms.length ? Math.min(...arms.map((i) => J[i].rest[1])) : head >= 0 ? J[head].rest[1] : J[hips].rest[1];

	// spine: halfway from the hips to the shoulders; what hangs above it (arms, head, neck) hangs from it
	const hy = J[hips].rest[1];
	const spineY = hy + Math.max(0, (Math.min(shoulders, head >= 0 ? J[head].rest[1] : Infinity) - hy) * 0.5);
	const spine = addBone('Spine', hips, [J[hips].rest[0], spineY, J[hips].rest[2]]);
	for (const k of children(hips)) if (k !== spine && role(k) !== 'leg' && J[k].rest[1] > spineY) reparent(k, spine);

	if (head >= 0) {
		mark('Head', head);
		const up = J[head].parent;
		if (up >= 0 && role(up) === 'neck') mark('Neck', up);
		for (const e of children(head).filter((k) => role(k) === 'eye')) mark(`${side(e)}Eye` as Bone, e);
		// eyes on a visor or a face plate
		for (let i = 0; i < rig.joints.length; i++) if (role(i) === 'eye' && below(i, head)) mark(`${side(i)}Eye` as Bone, i);
	}

	for (const arm of arms) {
		const S = side(arm);
		mark(`${S}UpperArm` as Bone, arm);
		const lower = children(arm).find((k) => role(k) === 'arm');
		const last = lower ?? arm;
		// the hand: the part at the end of the arm (a hand, a claw, a glove), or where the arm ends
		const hand = children(last).find((k) => visible(k)) ?? -1;
		const end = hand >= 0 ? J[hand].rest : farPoint(b, rig.joints[last].prim, J[last].rest);
		if (lower !== undefined) mark(`${S}LowerArm` as Bone, lower);
		else {
			const elbow = addBone(`${S}LowerArm` as Bone, arm, mid(J[arm].rest, end));
			for (const k of children(arm)) if (k !== elbow) reparent(k, elbow);
		}
		const fore = s.bones[`${S}LowerArm` as Bone]!;
		if (hand >= 0) mark(`${S}Hand` as Bone, hand);
		else addBone(`${S}Hand` as Bone, fore, end);
	}

	for (const leg of legChains(b, rig)) {
		if (!below(leg.top, hips)) continue;
		const S = side(leg.top);
		mark(`${S}UpperLeg` as Bone, leg.top);
		const foot = leg.flat.find((k) => visible(k)) ?? -1;
		const ankle = foot >= 0 ? J[foot].rest : leg.ankle;
		if (leg.lower >= 0) mark(`${S}LowerLeg` as Bone, leg.lower);
		else {
			const knee = addBone(`${S}LowerLeg` as Bone, leg.top, mid(J[leg.top].rest, ankle));
			for (const k of children(leg.top)) if (k !== knee) reparent(k, knee);
		}
		const shin = s.bones[`${S}LowerLeg` as Bone]!;
		if (foot >= 0) mark(`${S}Foot` as Bone, foot);
		else addBone(`${S}Foot` as Bone, shin, [leg.foot[0], Math.max(leg.foot[1], ankle[1]), leg.foot[2]]);
	}

	// a robe or a gown that reaches the ground hides its legs: give it bones where they would be, so
	// retargeted clips still drive the arms and head (nothing is bound to them, the robe does not move)
	const hidesLegs = !prims.some((p) => p.role === 'leg') && reachesGround(b, rig.joints[hips].prim);
	if (hidesLegs && head >= 0 && arms.length >= 2)
		for (const S of ['Left', 'Right'] as const) {
			const x = J[hips].rest[0] + (S === 'Left' ? 1 : -1) * rig.height * 0.07;
			const top = addBone(`${S}UpperLeg` as Bone, hips, [x, hy * 0.95, J[hips].rest[2]]);
			const knee = addBone(`${S}LowerLeg` as Bone, top, [x, hy * 0.5, J[hips].rest[2]]);
			addBone(`${S}Foot` as Bone, knee, [x, hy * 0.08, J[hips].rest[2]]);
		}

	s.missing = REQUIRED_BONES.filter((bn) => s.bones[bn] === undefined);
	return s;
}

/** A part's surface comes down to the ground. */
function reachesGround(b: Build, prim: number): boolean {
	for (const m of b.meshes)
		for (let v = 0; v < m.positions.length / 3; v++)
			if ((m.prim >= 0 ? m.prim : m.vertPrim[v]) === prim && m.positions[v * 3 + 1] < b.cell * 2) return true;
	return false;
}

const mid = (a: V3, c: V3): V3 => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];

/** The point of a part's surface farthest from `from` (grounded coordinates). */
function farPoint(b: Build, prim: number, from: V3): V3 {
	let best: V3 = from, d = -1;
	for (const m of b.meshes)
		for (let v = 0; v < m.positions.length / 3; v++) {
			if ((m.prim >= 0 ? m.prim : m.vertPrim[v]) !== prim) continue;
			const p: V3 = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]];
			const q = sub(p, from), l = q[0] * q[0] + q[1] * q[1] + q[2] * q[2];
			if (l > d) (d = l), (best = p);
		}
	// a little inside the tip, where a wrist would be
	return add(from, [(best[0] - from[0]) * 0.9, (best[1] - from[1]) * 0.9, (best[2] - from[2]) * 0.9]);
}
