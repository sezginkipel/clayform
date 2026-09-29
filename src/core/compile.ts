/**
 * Scene → compiled field.
 *
 * 1. Resolve every part's world pose in dependency order. Attached parts are
 *    placed by ray-casting the target's own surface (so they can never float),
 *    then sunk in by `embed`.
 * 2. Mirrored parts get a reflected twin (`id.m`); children of mirrored parts
 *    inherit the mirror unless they say `mirror: false`.
 * 3. Sculpts are resolved to world-space field modifiers.
 */

import { defaultAccent, PRESET_SCALE, samplePreset, type PresetKind, type PresetSample } from './materials.js';
import {
	add, clamp, dot, hexToRgb, len, norm, qAxisAngle, qConj, qEuler, qFromTo, qMul, qRotate, scale, sub,
	type Quat, type RGB, type V3
} from './math.js';
import type { Anchor, Part, Scene, Sculpt, Side, Target } from './schema.js';
import { cells3, fbm3, shapeBounds, shapeSdf, smax, smin, ssub, type LocalSdf } from './sdf.js';
import { meshField } from './meshload.js';

export interface Prim {
	/** Order in `prims` (and joint index). */
	index: number;
	/** `id` or `id.m` for a mirror twin. */
	id: string;
	partId: string;
	twin: boolean;
	part: Part;
	role: string;
	op: 'add' | 'carve' | 'intersect';
	k: number;
	pos: V3;
	rot: Quat;
	invRot: Quat;
	scl: V3;
	flipX: boolean;
	local: LocalSdf;
	lip: number;
	/** Local bounds (before scale). */
	lmin: V3;
	lmax: V3;
	/** World AABB. */
	min: V3;
	max: V3;
	color: RGB;
	roughness: number;
	metalness: number;
	emissive: RGB | null;
	emissiveStrength: number;
	pattern: { kind: string; color: RGB; scale: number; amount: number; axis?: string } | null;
	detail: { amount: number; scale: number } | null;
	preset: { kind: PresetKind; scale: number; accent: RGB; relief: number } | null;
	separate: boolean;
	hidden: boolean;
	/** In the fused body field? */
	inBody: boolean;
	/** Joint location (world, rest pose). */
	pivot: V3;
	/** Joint parent prim index or -1. */
	parent: number;
	/** Where it touches its attach target (world), if attached. */
	attachPoint: V3 | null;
	attachNormal: V3 | null;
	/** Mirror twin index, or -1. */
	twinIndex: number;
	/** a carve/intersect with `only`: it cuts its targets instead of the running body */
	scoped: boolean;
	/** the scoped carves/intersects that cut this part */
	cutBy: Prim[];
}

export interface SculptFn {
	id: string;
	min: V3;
	max: V3;
	global: boolean;
	lip: number;
	apply: (d: number, x: number, y: number, z: number) => number;
}

export interface Compiled {
	scene: Scene;
	prims: Prim[];
	body: Prim[];
	sculpts: SculptFn[];
	byId: Map<string, Prim>;
	/** How far sculpts may push the surface beyond part bounds. */
	grow: number;
	lip: number;
	warnings: string[];
}

const DEFAULT_COLOR = '#c9b8a6';

const SIDE_DIR: Record<Exclude<Side, 'center'>, { d: V3; u: number; v: number }> = {
	top: { d: [0, 1, 0], u: 0, v: 2 },
	bottom: { d: [0, -1, 0], u: 0, v: 2 },
	front: { d: [0, 0, 1], u: 0, v: 1 },
	back: { d: [0, 0, -1], u: 0, v: 1 },
	left: { d: [1, 0, 0], u: 2, v: 1 },
	right: { d: [-1, 0, 0], u: 2, v: 1 }
};

export function resolveColor(scene: Scene, c: string | undefined, fallback = DEFAULT_COLOR): RGB {
	if (!c) return hexToRgb(fallback);
	if (c.startsWith('#')) return hexToRgb(c);
	return hexToRgb(scene.palette?.[c] ?? fallback);
}

function scaleOf(p: Part): V3 {
	const s = p.scale;
	if (s === undefined) return [1, 1, 1];
	return typeof s === 'number' ? [s, s, s] : [s[0], s[1], s[2]];
}

/* ------------------------------------------------------ prim evaluation */

export function toLocal(pr: Prim, x: number, y: number, z: number): V3 {
	const l = qRotate(pr.invRot, [x - pr.pos[0], y - pr.pos[1], z - pr.pos[2]]);
	return [(pr.flipX ? -l[0] : l[0]) / pr.scl[0], l[1] / pr.scl[1], l[2] / pr.scl[2]];
}

export function toWorld(pr: Prim, l: V3): V3 {
	const s: V3 = [(pr.flipX ? -l[0] : l[0]) * pr.scl[0], l[1] * pr.scl[1], l[2] * pr.scl[2]];
	return add(pr.pos, qRotate(pr.rot, s));
}

export function primDist(pr: Prim, x: number, y: number, z: number): number {
	// inlined inverse transform (hot path: no allocation)
	const vx = x - pr.pos[0], vy = y - pr.pos[1], vz = z - pr.pos[2];
	const q = pr.invRot;
	const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
	const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
	let lx = vx + qw * tx + (qy * tz - qz * ty);
	const ly = (vy + qw * ty + (qz * tx - qx * tz)) / pr.scl[1];
	const lz = (vz + qw * tz + (qx * ty - qy * tx)) / pr.scl[2];
	lx = (pr.flipX ? -lx : lx) / pr.scl[0];
	let d = pr.local(lx, ly, lz) * pr.lip;
	if (pr.detail) {
		const s = 1 / pr.detail.scale;
		d += pr.detail.amount * (fbm3(lx * s, ly * s, lz * s) * 2 - 1);
	}
	return d;
}

function primGrad(pr: Prim, p: V3, h: number): V3 {
	const dx = primDist(pr, p[0] + h, p[1], p[2]) - primDist(pr, p[0] - h, p[1], p[2]);
	const dy = primDist(pr, p[0], p[1] + h, p[2]) - primDist(pr, p[0], p[1] - h, p[2]);
	const dz = primDist(pr, p[0], p[1], p[2] + h) - primDist(pr, p[0], p[1], p[2] - h);
	return norm([dx, dy, dz]);
}

function computeAabb(pr: Prim) {
	const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < 8; i++) {
		const l: V3 = [i & 1 ? pr.lmax[0] : pr.lmin[0], i & 2 ? pr.lmax[1] : pr.lmin[1], i & 4 ? pr.lmax[2] : pr.lmin[2]];
		const w = toWorld(pr, l);
		for (let a = 0; a < 3; a++) {
			min[a] = Math.min(min[a], w[a]);
			max[a] = Math.max(max[a], w[a]);
		}
	}
	const pad = pr.detail ? pr.detail.amount : 0;
	pr.min = [min[0] - pad, min[1] - pad, min[2] - pad];
	pr.max = [max[0] + pad, max[1] + pad, max[2] + pad];
}

/** Sphere-trace along a ray against one prim. Falls back to projecting the closest approach. */
export function traceOnto(pr: Prim, origin: V3, dir: V3, maxT: number): { p: V3; n: V3; hit: boolean } {
	let t = 0;
	let best = Infinity, bestT = 0;
	const eps = 1e-4 * Math.max(1e-3, maxT);
	for (let i = 0; i < 400 && t < maxT; i++) {
		const q = add(origin, scale(dir, t));
		const d = primDist(pr, q[0], q[1], q[2]);
		if (d < best) {
			best = d;
			bestT = t;
		}
		if (d < eps) return { p: q, n: primGrad(pr, q, eps * 4 + 1e-4), hit: true };
		t += Math.max(d * 0.9, eps);
	}
	// Missed (offset past the silhouette): project the closest point onto the surface.
	let q = add(origin, scale(dir, bestT));
	for (let i = 0; i < 24; i++) {
		const d = primDist(pr, q[0], q[1], q[2]);
		if (Math.abs(d) < eps) break;
		q = sub(q, scale(primGrad(pr, q, 1e-3), d));
	}
	return { p: q, n: primGrad(pr, q, 1e-3), hit: false };
}

/**
 * Surface point + normal on a target for an anchor side/offset.
 * Sides are WORLD directions: "top" is the point you see looking down at the
 * target, whatever its rotation. Offsets slide across the target's world
 * bounding box.
 */
export function anchorSurface(target: Prim, a: Pick<Anchor, 'side' | 'offset'>): { p: V3; n: V3; hit: boolean } {
	const c: V3 = [(target.min[0] + target.max[0]) / 2, (target.min[1] + target.max[1]) / 2, (target.min[2] + target.max[2]) / 2];
	if (a.side === 'center') return { p: c, n: [0, 1, 0], hit: true };
	const sd = SIDE_DIR[a.side];
	const half: V3 = [(target.max[0] - target.min[0]) / 2, (target.max[1] - target.min[1]) / 2, (target.max[2] - target.min[2]) / 2];
	const o: V3 = [...c];
	if (a.offset) {
		o[sd.u] += a.offset[0] * half[sd.u];
		o[sd.v] += a.offset[1] * half[sd.v];
	}
	const reach = Math.max(half[0], half[1], half[2]) * 2.5 + 0.05;
	const back = scale(sd.d, -1);
	if (a.offset && (a.offset[0] !== 0 || a.offset[1] !== 0)) return traceOnto(target, add(o, scale(sd.d, reach)), back, reach * 1.5);
	// No offset: the extreme surface point in that direction (the tip of a tilted
	// arm, not the side a centered ray happens to hit). Among near-equal
	// candidates (a flat face) keep the one closest to the center.
	let best: { p: V3; n: V3; hit: boolean } | null = null;
	let bestH = -Infinity, bestT = Infinity;
	const tol = Math.max(1e-4, Math.max(half[0], half[1], half[2]) * 0.004);
	const G = 7;
	for (let i = 0; i < G; i++)
		for (let j = 0; j < G; j++) {
			const q: V3 = [...c];
			const du = ((i / (G - 1)) * 2 - 1) * 0.92, dv = ((j / (G - 1)) * 2 - 1) * 0.92;
			q[sd.u] += du * half[sd.u];
			q[sd.v] += dv * half[sd.v];
			const r = traceOnto(target, add(q, scale(sd.d, reach)), back, reach * 1.5);
			if (!r.hit) continue;
			const h = dot(r.p, sd.d);
			const t = Math.hypot(du, dv);
			if (h > bestH + tol || (Math.abs(h - bestH) <= tol && t < bestT)) {
				if (h > bestH + tol) bestT = Infinity;
				best = r;
				bestH = Math.max(h, bestH);
				bestT = t;
			}
		}
	return best ?? traceOnto(target, add(o, scale(sd.d, reach)), back, reach * 1.5);
}

/* --------------------------------------------------------------- compile */

export function compile(scene: Scene): Compiled {
	const warnings: string[] = [];
	const parts = scene.parts;
	const partById = new Map(parts.map((p) => [p.id, p]));
	const prims: Prim[] = [];
	const byId = new Map<string, Prim>();
	const mirrored = new Map<string, boolean>();

	const makePrim = (p: Part): Prim => {
		if (p.shape.type === 'mesh') {
			const mf = meshField(p.shape.src, p.shape.size, p.shape.resolution ?? 64);
			if (!mf.closed) warnings.push(`${p.id}: ${p.shape.src} is not a closed mesh, so it is kept as a thin shell — fill its holes before importing for solid results`);
		}
		const b = shapeBounds(p.shape);
		const scl = scaleOf(p);
		const direct = p.shape.type === 'sheet' || (p.shape.type === 'mesh' && !!p.shape.keep);
		const m = p.material ?? {};
		return {
			index: -1,
			id: p.id,
			partId: p.id,
			twin: false,
			part: p,
			role: p.role ?? '',
			op: p.op ?? 'add',
			k: p.blend ?? 0,
			pos: [0, 0, 0],
			rot: [0, 0, 0, 1],
			invRot: [0, 0, 0, 1],
			scl,
			flipX: false,
			local: shapeSdf(p.shape),
			lip: Math.min(scl[0], scl[1], scl[2]),
			lmin: b.min,
			lmax: b.max,
			min: [0, 0, 0],
			max: [0, 0, 0],
			color: resolveColor(scene, m.color),
			roughness: m.roughness ?? 0.75,
			metalness: m.metalness ?? 0,
			emissive: m.emissive ? resolveColor(scene, m.emissive) : null,
			emissiveStrength: m.emissiveStrength ?? 1,
			pattern: p.pattern
				? { kind: p.pattern.kind, color: resolveColor(scene, p.pattern.color), scale: p.pattern.scale ?? 0.08, amount: p.pattern.amount ?? 1, axis: p.pattern.axis }
				: null,
			detail: p.detail ? { amount: p.detail.amount, scale: p.detail.scale } : null,
			preset: m.preset
				? (() => {
						const base = resolveColor(scene, m.color);
						return {
							kind: m.preset.kind,
							scale: m.preset.scale ?? PRESET_SCALE[m.preset.kind],
							accent: m.preset.accent ? resolveColor(scene, m.preset.accent) : defaultAccent(m.preset.kind, base),
							relief: m.preset.relief ?? 0.6
						};
					})()
				: null,
			// sheets and kept meshes are meshed directly, never through the body's grid
			separate: !!p.separate || direct,
			hidden: !!p.hidden,
			inBody: !p.separate && !direct && !p.hidden,
			pivot: [0, 0, 0],
			parent: -1,
			attachPoint: null,
			attachNormal: null,
			twinIndex: -1,
			scoped: false,
			cutBy: []
		};
	};

	const setRot = (pr: Prim, q: Quat) => {
		pr.rot = q;
		pr.invRot = qConj(q);
	};

	// joint on the part's own surface, seen from a world side, pulled slightly inside
	const sidePoint = (pr: Prim, side: Exclude<Side, 'center'>): V3 => {
		const hit = anchorSurface(pr, { side });
		const c: V3 = [(pr.min[0] + pr.max[0]) / 2, (pr.min[1] + pr.max[1]) / 2, (pr.min[2] + pr.max[2]) / 2];
		return [hit.p[0] + (c[0] - hit.p[0]) * 0.15, hit.p[1] + (c[1] - hit.p[1]) * 0.15, hit.p[2] + (c[2] - hit.p[2]) * 0.15];
	};

	// dependency order
	const order: Part[] = [];
	const state = new Map<string, 0 | 1 | 2>();
	const visit = (p: Part) => {
		const s = state.get(p.id) ?? 0;
		if (s === 2) return;
		if (s === 1) return; // cycle — integrity() reports it
		state.set(p.id, 1);
		const dep = p.attach?.to ?? p.parent;
		const dp = dep ? partById.get(dep) : undefined;
		if (dp) visit(dp);
		state.set(p.id, 2);
		order.push(p);
	};
	parts.forEach(visit);

	const resolved = new Map<string, Prim>();
	for (const p of order) {
		const pr = makePrim(p);
		const local = qEuler((p.rotation ?? [0, 0, 0]) as V3);
		const offset = (p.position ?? [0, 0, 0]) as V3;
		const target = p.attach ? resolved.get(p.attach.to) : undefined;
		const parent = !p.attach && p.parent ? resolved.get(p.parent) : undefined;

		if (p.attach && target) {
			const hit = anchorSurface(target, p.attach);
			if (!hit.hit && p.attach.offset) warnings.push(`${p.id}: attach offset lands outside ${target.id}'s outline, snapped to its nearest surface`);
			const n = hit.n;
			// attach places, parent carries: an attached part keeps its own world rotation
			const q = p.attach.align ? qMul(qFromTo([0, 1, 0], n), local) : local;
			setRot(pr, q);
			pr.pos = [0, 0, 0];
			// extent of this part from its center toward the surface (-n)
			const u = scale(n, -1);
			const reach = Math.max(...pr.lmax.map((v, i) => Math.max(Math.abs(v), Math.abs(pr.lmin[i])) * pr.scl[i])) * 2 + 0.05;
			const probe = traceOnto(pr, scale(u, reach), scale(u, -1), reach * 2);
			// distance from the part's origin to its own surface on the side facing the target
			const extent = probe.hit ? Math.max(0, dot(probe.p, u)) : 0;
			const embed = p.attach.embed ?? 0.35;
			const c = add(hit.p, scale(n, extent * (1 - embed)));
			pr.pos = add(c, offset);
			pr.attachPoint = hit.p;
			pr.attachNormal = n;
			pr.parent = target.index;
		} else if (parent) {
			setRot(pr, qMul(parent.rot, local));
			pr.pos = add(parent.pos, qRotate(parent.rot, offset));
			pr.parent = parent.index;
		} else {
			setRot(pr, local);
			pr.pos = offset;
		}
		computeAabb(pr);

		// pivot
		const pv = p.pivot;
		const role = pr.role;
		if (Array.isArray(pv)) pr.pivot = toWorld(pr, pv as V3);
		else if (pv === 'center') pr.pivot = toWorld(pr, [(pr.lmin[0] + pr.lmax[0]) / 2, (pr.lmin[1] + pr.lmax[1]) / 2, (pr.lmin[2] + pr.lmax[2]) / 2]);
		else if (pv && pv !== 'attach') pr.pivot = sidePoint(pr, pv);
		else if (pr.attachPoint && (pv === 'attach' || !['wheel', 'rotor', 'eye'].includes(role))) pr.pivot = pr.attachPoint;
		else if (role === 'leg' || role === 'arm') pr.pivot = sidePoint(pr, 'top');
		else if (role === 'head' || role === 'neck') pr.pivot = sidePoint(pr, 'bottom');
		else pr.pivot = toWorld(pr, [(pr.lmin[0] + pr.lmax[0]) / 2, (pr.lmin[1] + pr.lmax[1]) / 2, (pr.lmin[2] + pr.lmax[2]) / 2]);

		pr.index = prims.length;
		prims.push(pr);
		byId.set(pr.id, pr);
		resolved.set(p.id, pr);

		const dep = p.attach?.to ?? p.parent;
		const wantMirror = p.mirror ?? (dep ? mirrored.get(dep) ?? false : false);
		mirrored.set(p.id, wantMirror);
		if (wantMirror) {
			if (Math.abs(pr.pos[0]) < 1e-4 && !pr.attachPoint) warnings.push(`${p.id}: mirror twin sits on x=0 and overlaps the original — move it off-center`);
			const tw: Prim = {
				...pr,
				id: `${p.id}.m`,
				twin: true,
				pos: [-pr.pos[0], pr.pos[1], pr.pos[2]],
				flipX: !pr.flipX,
				pivot: [-pr.pivot[0], pr.pivot[1], pr.pivot[2]],
				attachPoint: pr.attachPoint ? [-pr.attachPoint[0], pr.attachPoint[1], pr.attachPoint[2]] : null,
				attachNormal: pr.attachNormal ? [-pr.attachNormal[0], pr.attachNormal[1], pr.attachNormal[2]] : null,
				index: prims.length,
				twinIndex: pr.index,
				cutBy: []
			};
			setRot(tw, [pr.rot[0], -pr.rot[1], -pr.rot[2], pr.rot[3]]);
			if (pr.parent >= 0) {
				const par = prims[pr.parent];
				tw.parent = par.twinIndex >= 0 && !par.twin ? par.twinIndex : pr.parent;
			}
			computeAabb(tw);
			pr.twinIndex = tw.index;
			prims.push(tw);
			byId.set(tw.id, tw);
		}
	}

	expandCopies(parts, prims, byId, warnings, computeAabb);

	// Body order follows the document order (blend semantics), twins right after originals.
	const docIndex = new Map(parts.map((p, i) => [p.id, i]));
	const body = prims
		.filter((p) => p.inBody)
		.sort((a, b) => (docIndex.get(a.partId)! - docIndex.get(b.partId)!) || (a.twin ? 1 : 0) - (b.twin ? 1 : 0));
	// scoped cuts: each target carries the carves/intersects that name it (both twins of each)
	for (const op of prims) {
		const only = op.part.only;
		if (!only || op.op === 'add') continue;
		op.scoped = true;
		const ids = new Set(Array.isArray(only) ? only : [only]);
		for (const t of prims) if (t !== op && ids.has(t.partId) && t.op === 'add') t.cutBy.push(op);
	}
	if (body.length && body[0].op !== 'add') warnings.push(`first body part "${body[0].id}" is a ${body[0].op} — there is nothing before it to ${body[0].op}`);

	const compiled: Compiled = { scene, prims, body, sculpts: [], byId, grow: 0, lip: 1, warnings };
	compiled.sculpts = compileSculpts(scene.sculpts ?? [], compiled, warnings);
	let grow = 0, lip = 1;
	for (const s of compiled.sculpts) lip = Math.max(lip, s.lip);
	for (const s of scene.sculpts ?? []) if (s.kind === 'inflate' || s.kind === 'noise') grow = Math.max(grow, s.amount);
	compiled.grow = grow;
	compiled.lip = lip;
	return compiled;
}

/* ---------------------------------------------------------------- copies */

/** A rigid move: rotate by q, then add t. */
interface Rigid {
	q: Quat;
	t: V3;
}
const applyRigid = (g: Rigid, p: V3): V3 => add(qRotate(g.q, p), g.t);
/** The same move seen in the mirror across X (for twins). */
const mirrorRigid = (g: Rigid): Rigid => ({ q: [g.q[0], -g.q[1], -g.q[2], g.q[3]], t: [-g.t[0], g.t[1], g.t[2]] });

function seeded(seed: number): () => number {
	let s = (seed * 2654435761) >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) / 4294967296;
	};
}

/**
 * repeat and scatter: every copy is a rigid move of the part and of
 * everything attached to it (and of their mirror twins, mirrored). Parts
 * deepest in the attach tree go first, so a repeated window on a repeated
 * floor makes a grid.
 */
function expandCopies(parts: Part[], prims: Prim[], byId: Map<string, Prim>, warnings: string[], aabb: (pr: Prim) => void) {
	const depth = (p: Prim) => {
		let d = 0;
		for (let c = p; c.parent >= 0; c = prims[c.parent]) d++;
		return d;
	};
	const sources = parts.filter((p) => p.repeat || p.scatter);
	const roots = sources.map((p) => byId.get(p.id)!).filter(Boolean).sort((a, z) => depth(z) - depth(a));
	for (const root of roots) {
		const part = root.part;
		// the subtree: this part, its twin, and everything whose parent chain reaches them
		const inSub = new Set<number>([root.index, ...(root.twinIndex >= 0 ? [root.twinIndex] : [])]);
		for (const p of prims) {
			for (let c = p; c.parent >= 0; c = prims[c.parent]) if (inSub.has(c.parent)) { inSub.add(p.index); break; }
		}
		const sub = prims.filter((p) => inSub.has(p.index));
		const moves: { g: Rigid; scale: number; label: number }[] = [];
		if (part.repeat) {
			const r = part.repeat;
			const around = r.around ? byId.get(r.around) : root.parent >= 0 ? prims[root.parent] : undefined;
			const centre: V3 = around ? [(around.min[0] + around.max[0]) / 2, (around.min[1] + around.max[1]) / 2, (around.min[2] + around.max[2]) / 2] : [0, 0, 0];
			const axis: V3 = r.axis === 'x' ? [1, 0, 0] : r.axis === 'z' ? [0, 0, 1] : [0, 1, 0];
			const rows = r.rows ? r.rows.count : 1;
			let label = 2;
			for (let j = 0; j < rows; j++)
				for (let k = 0; k < r.count; k++) {
					if (j === 0 && k === 0) continue;
					const q = qAxisAngle(axis, ((r.turn ?? 0) * k * Math.PI) / 180);
					// turn around the centre, then step
					const step = add(scale((r.step ?? [0, 0, 0]) as V3, k), r.rows ? scale(r.rows.step as V3, j) : [0, 0, 0]);
					const t = add(sub3(centre, qRotate(q, centre)), step);
					moves.push({ g: { q, t }, scale: 1, label: label++ });
				}
		} else if (part.scatter) {
			const s = part.scatter;
			const on = byId.get(s.on);
			if (!on) continue;
			const rnd = seeded(s.seed ?? 1);
			const c: V3 = [(on.min[0] + on.max[0]) / 2, (on.min[1] + on.max[1]) / 2, (on.min[2] + on.max[2]) / 2];
			const R = Math.hypot(on.max[0] - on.min[0], on.max[1] - on.min[1], on.max[2] - on.min[2]);
			const spots: { p: V3; n: V3 }[] = [];
			const gap = s.minGap ?? 0;
			const up = (s.where ?? 'up') === 'up';
			for (let tries = 0; spots.length < s.count && tries < s.count * 60; tries++) {
				// a random ray from outside toward the part; for "up", rays come down from above
				let dx: number, dy: number, dz: number;
				if (up) {
					const x = on.min[0] + rnd() * (on.max[0] - on.min[0]), z = on.min[2] + rnd() * (on.max[2] - on.min[2]);
					const hit = traceOnto(on, [x, on.max[1] + R * 0.1 + 0.01, z], [0, -1, 0], (on.max[1] - on.min[1]) + R * 0.2 + 0.02);
					if (!hit.hit || hit.n[1] < 0.3) continue;
					if (gap > 0 && spots.some((o) => Math.hypot(o.p[0] - hit.p[0], o.p[1] - hit.p[1], o.p[2] - hit.p[2]) < gap)) continue;
					spots.push({ p: hit.p, n: hit.n });
					continue;
				}
				const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, w = Math.sqrt(1 - u * u);
				dx = w * Math.cos(a); dy = u; dz = w * Math.sin(a);
				const hit = traceOnto(on, add(c, [dx * R, dy * R, dz * R]), [-dx, -dy, -dz], R * 2);
				if (!hit.hit) continue;
				if (gap > 0 && spots.some((o) => Math.hypot(o.p[0] - hit.p[0], o.p[1] - hit.p[1], o.p[2] - hit.p[2]) < gap)) continue;
				spots.push({ p: hit.p, n: hit.n });
			}
			if (spots.length < s.count) warnings.push(`${part.id}: scattered ${spots.length} of ${s.count} on ${s.on} — lower minGap or the count, or use where: "all"`);
			const local = qEuler((part.rotation ?? [0, 0, 0]) as V3);
			const [smin, smax] = s.scale ?? [1, 1];
			const embed = s.embed ?? 0.35;
			spots.forEach((sp, k) => {
				const yaw = s.spin === false ? [0, 0, 0, 1] as Quat : qAxisAngle([0, 1, 0], rnd() * Math.PI * 2);
				const k2 = smin + (smax - smin) * rnd();
				const lean = s.align === false ? ([0, 0, 0, 1] as Quat) : qFromTo([0, 1, 0], sp.n);
				const rot = qMul(lean, qMul(yaw, local));
				// sink the copy's bottom into the surface, like attach does
				const below = Math.max(0, -root.lmin[1] * root.scl[1]) * k2;
				const pos = add(sp.p, scale(sp.n, below * (1 - embed)));
				const q = qMul(rot, root.invRot);
				moves.push({ g: { q, t: sub3(pos, qRotate(q, root.pos)) }, scale: k2, label: k + 1 });
			});
		}
		if (!moves.length) continue;
		// every move starts from where the parts stood before any of them (the first scatter spot moves the originals)
		const home = new Map(sub.map((p) => [p.index, { pos: p.pos, rot: p.rot, pivot: p.pivot, attachPoint: p.attachPoint, attachNormal: p.attachNormal, scl: p.scl }]));
		for (const mv of moves) {
			// the first scatter spot moves the part itself; every other move makes a copy
			const inPlace = !!part.scatter && mv.label === 1;
			const clone = new Map<number, Prim>();
			for (const cur of sub) {
				const src = { ...cur, ...home.get(cur.index)! };
				const g = cur.twin ? mirrorRigid(mv.g) : mv.g;
				const pr: Prim = inPlace
					? cur
					: { ...src, id: `${cur.id}.${mv.label}`, index: prims.length, twinIndex: -1, cutBy: [], scoped: cur.scoped };
				pr.pos = applyRigid(g, src.pos);
				pr.rot = qMul(g.q, src.rot);
				pr.invRot = qConj(pr.rot);
				pr.pivot = applyRigid(g, src.pivot);
				pr.attachPoint = src.attachPoint ? applyRigid(g, src.attachPoint) : null;
				pr.attachNormal = src.attachNormal ? qRotate(g.q, src.attachNormal) : null;
				if (mv.scale !== 1 && (cur.index === root.index || cur.index === root.twinIndex)) {
					pr.scl = scale(src.scl, mv.scale) as V3;
					pr.lip = Math.min(pr.scl[0], pr.scl[1], pr.scl[2]);
				}
				aabb(pr);
				if (!inPlace) {
					clone.set(cur.index, pr);
					prims.push(pr);
					byId.set(pr.id, pr);
				}
			}
			// copies hang from the copied parent, or from the original's parent outside the subtree
			if (!inPlace) for (const pr of clone.values()) if (pr.parent >= 0 && clone.has(pr.parent)) pr.parent = clone.get(pr.parent)!.index;
		}
	}
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/* ---------------------------------------------------------------- field */

/** A part's own distance after the scoped carves and intersects that name it. */
export function partDist(pr: Prim, x: number, y: number, z: number): number {
	let d = primDist(pr, x, y, z);
	for (const op of pr.cutBy) {
		const dop = primDist(op, x, y, z);
		d = op.op === 'carve' ? ssub(dop, d, op.k) : smax(d, dop, op.k);
	}
	return d;
}

/** Combined body distance using only `list` prims (indices into compiled.body), before sculpts. */
export function bodyBase(c: Compiled, x: number, y: number, z: number, list?: ArrayLike<number>): number {
	const body = c.body;
	let d = 1e9;
	const n = list ? list.length : body.length;
	let started = false;
	for (let j = 0; j < n; j++) {
		const pr = body[list ? list[j] : j];
		if (pr.scoped) continue;
		const di = pr.cutBy.length ? partDist(pr, x, y, z) : primDist(pr, x, y, z);
		if (pr.op === 'add') {
			d = started ? smin(d, di, pr.k) : di;
			started = true;
		} else if (pr.op === 'carve') d = ssub(di, d, pr.k);
		else d = smax(d, di, pr.k);
	}
	return d;
}

export function bodyField(c: Compiled, x: number, y: number, z: number, list?: ArrayLike<number>, sculpts?: ArrayLike<number>): number {
	let d = bodyBase(c, x, y, z, list);
	const sc = c.sculpts;
	const n = sculpts ? sculpts.length : sc.length;
	for (let j = 0; j < n; j++) d = sc[sculpts ? sculpts[j] : j].apply(d, x, y, z);
	return d;
}

/* -------------------------------------------------------------- sculpts */

function falloff(t: number) {
	if (t >= 1) return 0;
	const u = 1 - t * t;
	return u * u;
}

function compileSculpts(list: Sculpt[], c: Compiled, warnings: string[]): SculptFn[] {
	const out: SculptFn[] = [];
	const fieldGrad = (p: V3): V3 => {
		const h = 1e-3;
		return norm([
			bodyBase(c, p[0] + h, p[1], p[2]) - bodyBase(c, p[0] - h, p[1], p[2]),
			bodyBase(c, p[0], p[1] + h, p[2]) - bodyBase(c, p[0], p[1] - h, p[2]),
			bodyBase(c, p[0], p[1], p[2] + h) - bodyBase(c, p[0], p[1], p[2] - h)
		]);
	};
	const resolve = (t: Target | undefined, s: Sculpt): { p: V3; n: V3 } | null => {
		if (!t) return null;
		if ('point' in t) return { p: t.point as V3, n: fieldGrad(t.point as V3) };
		const target = c.byId.get(t.to);
		if (!target) return null;
		const r = anchorSurface(target, t);
		if (!r.hit && t.offset) warnings.push(`sculpt ${s.id}: offset lands outside ${t.to}, snapped to nearest surface`);
		return { p: r.p, n: r.n };
	};

	for (const s of list) {
		const a = resolve(s.at, s);
		const b = resolve(s.to, s);
		const variants: { a: typeof a; b: typeof b; id: string }[] = [{ a, b, id: s.id }];
		if (s.mirror && a) {
			const m = (v: { p: V3; n: V3 } | null) => (v ? { p: [-v.p[0], v.p[1], v.p[2]] as V3, n: [-v.n[0], v.n[1], v.n[2]] as V3 } : null);
			variants.push({ a: m(a), b: m(b), id: `${s.id}.m` });
		}
		for (const v of variants) {
			const fn = sculptFn(s, v.a, v.b, v.id);
			if (fn) out.push(fn);
		}
	}
	return out;
}

function sculptFn(s: Sculpt, a: { p: V3; n: V3 } | null, b: { p: V3; n: V3 } | null, id: string): SculptFn | null {
	const r = s.radius;
	const amt = s.amount;
	const box = (c: V3, e: number) => ({ min: [c[0] - e, c[1] - e, c[2] - e] as V3, max: [c[0] + e, c[1] + e, c[2] + e] as V3 });
	switch (s.kind) {
		case 'inflate':
		case 'dent': {
			if (!a) return null;
			const [cx, cy, cz] = a.p;
			const sign = s.kind === 'inflate' ? -1 : 1;
			return {
				id, ...box(a.p, r + amt), global: false,
				lip: 1 + (1.6 * amt) / r,
				apply: (d, x, y, z) => {
					const t = Math.hypot(x - cx, y - cy, z - cz) / r;
					return t >= 1 ? d : d + sign * amt * falloff(t);
				}
			};
		}
		case 'flatten': {
			if (!a) return null;
			const n = s.normal ? norm(s.normal as V3) : a.n;
			const c = sub(a.p, scale(n, amt));
			return {
				id, ...box(a.p, r), global: false, lip: 1 + 1.6 * Math.min(1, (amt + r * 0.25) / r),
				apply: (d, x, y, z) => {
					const t = Math.hypot(x - a.p[0], y - a.p[1], z - a.p[2]) / r;
					if (t >= 1) return d;
					const pd = (x - c[0]) * n[0] + (y - c[1]) * n[1] + (z - c[2]) * n[2];
					const w = falloff(t);
					return d + (Math.max(d, pd) - d) * w;
				}
			};
		}
		case 'crease': {
			if (!a || !b) return null;
			const w = r;
			const off = Math.max(0, w - amt);
			const p0 = add(a.p, scale(a.n, off));
			const p1 = add(b.p, scale(b.n, off));
			const seg = sub(p1, p0);
			const l2 = Math.max(dot(seg, seg), 1e-12);
			const k = w * 0.35;
			const min: V3 = [Math.min(p0[0], p1[0]) - w - k, Math.min(p0[1], p1[1]) - w - k, Math.min(p0[2], p1[2]) - w - k];
			const max: V3 = [Math.max(p0[0], p1[0]) + w + k, Math.max(p0[1], p1[1]) + w + k, Math.max(p0[2], p1[2]) + w + k];
			return {
				id, min, max, global: false, lip: 1,
				apply: (d, x, y, z) => {
					const px = x - p0[0], py = y - p0[1], pz = z - p0[2];
					const h = clamp((px * seg[0] + py * seg[1] + pz * seg[2]) / l2, 0, 1);
					const cd = Math.hypot(px - seg[0] * h, py - seg[1] * h, pz - seg[2] * h) - w;
					return ssub(cd, d, k);
				}
			};
		}
		case 'noise': {
			const sc = 1 / (s.scale ?? 0.1);
			if (!a) {
				return {
					id, min: [-1e9, -1e9, -1e9], max: [1e9, 1e9, 1e9], global: true, lip: 1 + 3 * amt * sc,
					apply: (d, x, y, z) => d + amt * (fbm3(x * sc, y * sc, z * sc) * 2 - 1)
				};
			}
			const [cx, cy, cz] = a.p;
			return {
				id, ...box(a.p, r + amt), global: false, lip: 1 + 3 * amt * sc,
				apply: (d, x, y, z) => {
					const t = Math.hypot(x - cx, y - cy, z - cz) / r;
					return t >= 1 ? d : d + amt * (fbm3(x * sc, y * sc, z * sc) * 2 - 1) * falloff(t);
				}
			};
		}
	}
}

/* -------------------------------------------------------------- shading */

function axisCoord(pr: Prim, l: V3, axis: string | undefined): number {
	if (axis === 'x') return l[0];
	if (axis === 'z') return l[2];
	if (axis === 'around') {
		const r = ((pr.lmax[0] - pr.lmin[0]) + (pr.lmax[2] - pr.lmin[2])) / 4;
		return Math.atan2(l[2], l[0]) * r;
	}
	return l[1];
}

/** The preset at a world point on a part (normal in world space), or null. */
export function presetAt(pr: Prim, p: V3, n: V3 | undefined): PresetSample | null {
	if (!pr.preset) return null;
	const l = toLocal(pr, p[0], p[1], p[2]);
	const nl = n ? qRotate(pr.invRot, n) : ([0, 1, 0] as V3);
	if (pr.flipX) nl[0] = -nl[0];
	// the preset's scale is in meters on the part as it is, not before `scale` stretched it
	return samplePreset(pr.preset.kind, [l[0] * pr.scl[0], l[1] * pr.scl[1], l[2] * pr.scl[2]], nl, pr.preset.scale);
}

/** Base color of a prim at a world point (preset and pattern applied). `n` is the surface normal, for presets that lie on faces. */
export function primColor(pr: Prim, p: V3, n?: V3): RGB {
	let base = pr.color;
	if (pr.preset) {
		const s = presetAt(pr, p, n)!;
		const a = pr.preset.accent, m = Math.max(0, Math.min(1, s.mix));
		// crevices a little darker, so grooves read even without a normal map
		const k = (s.shade ?? 1) * (1 - pr.preset.relief * 0.35 * (1 - Math.max(0, Math.min(1, s.height))));
		base = [(base[0] + (a[0] - base[0]) * m) * k, (base[1] + (a[1] - base[1]) * m) * k, (base[2] + (a[2] - base[2]) * m) * k];
	}
	if (!pr.pattern) return base;
	const pt = pr.pattern;
	const l = toLocal(pr, p[0], p[1], p[2]);
	const s = 1 / pt.scale;
	let w = 0;
	switch (pt.kind) {
		case 'spots': {
			const c = cells3(l[0] * s, l[1] * s, l[2] * s);
			w = c < 0.32 ? 1 : c < 0.4 ? (0.4 - c) / 0.08 : 0;
			break;
		}
		case 'stripes': {
			const u = axisCoord(pr, l, pt.axis);
			const v = Math.sin((u * s + fbm3(l[0] * s, l[1] * s, l[2] * s) * (pt.axis === 'around' ? 0.35 : 1.2)) * Math.PI);
			w = v > 0.25 ? 1 : v > 0 ? v / 0.25 : 0;
			break;
		}
		case 'noise':
			w = clamp((fbm3(l[0] * s * 2, l[1] * s * 2, l[2] * s * 2) - 0.35) * 3, 0, 1);
			break;
		case 'gradient': {
			const a = pt.axis === 'x' ? 0 : pt.axis === 'z' ? 2 : 1;
			const t = clamp((l[a] - pr.lmin[a]) / Math.max(pt.scale, 1e-3), 0, 1);
			w = t;
			break;
		}
	}
	w *= pt.amount;
	return [base[0] + (pt.color[0] - base[0]) * w, base[1] + (pt.color[1] - base[1]) * w, base[2] + (pt.color[2] - base[2]) * w];
}

export function worldAabb(prims: Prim[]): { min: V3; max: V3 } | null {
	if (!prims.length) return null;
	const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
	for (const p of prims)
		for (let a = 0; a < 3; a++) {
			min[a] = Math.min(min[a], p.min[a]);
			max[a] = Math.max(max[a], p.max[a]);
		}
	return { min, max };
}
