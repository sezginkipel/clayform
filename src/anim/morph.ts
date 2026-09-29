/**
 * Expressions as morph targets.
 *
 * An expression is the scene as it looks with a face made: parts moved,
 * rescaled or reshaped, and sculpts added. It never changes the mesh
 * topology. Instead every vertex of the model as built (after its triangle
 * budget) is carried onto the expression's surface: a vertex of a separate
 * part rides with that part's new placement, then every vertex is pulled
 * onto the new distance field along its gradient. The target is the
 * difference between that and the same pull onto the unchanged field, so the
 * small error of the mesh itself cancels and vertices the expression does not
 * touch do not move at all.
 */

import type { Build, MeshData } from '../core/build.js';
import { bodyField, compile, partDist, toLocal, toWorld, type Compiled, type Prim } from '../core/compile.js';
import type { V3 } from '../core/math.js';
import { applyStyle } from '../core/style.js';
import type { Expression, Part, Scene, Sculpt } from '../core/schema.js';

export interface MorphTarget {
	id: string;
	/** position deltas, 3 per vertex */
	dp: Float32Array;
	/** normal deltas, 3 per vertex */
	dn: Float32Array;
	/** vertices that move more than a tenth of a millimeter */
	moved: number;
	/** largest displacement in meters */
	max: number;
}

const scaleOf = (p: Part): V3 => (p.scale === undefined ? [1, 1, 1] : typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : [p.scale[0], p.scale[1], p.scale[2]]);
const mul = (a: V3, b: V3): V3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

/** The mouth: a part with role or id "mouth". */
export function mouthOf(scene: Scene): Part | undefined {
	return scene.parts.find((p) => p.role === 'mouth') ?? scene.parts.find((p) => p.id === 'mouth');
}

/** What a blink closes: the eyes' own inner parts (whites, pupils) when they have them, otherwise the eyes. */
function lidded(scene: Scene): Part[] {
	const eyes = scene.parts.filter((p) => p.role === 'eye');
	const out: Part[] = [];
	for (const e of eyes) {
		const inner = scene.parts.filter((p) => p !== e && under(scene, p, e.id));
		out.push(...(inner.length ? inner : [e]));
	}
	return out;
}

function under(scene: Scene, p: Part, id: string): boolean {
	const seen = new Set<string>();
	for (let cur: Part | undefined = p; cur && !seen.has(cur.id); ) {
		seen.add(cur.id);
		const up: string | undefined = cur.attach?.to ?? cur.parent;
		if (up === id) return true;
		cur = up ? scene.parts.find((q) => q.id === up) : undefined;
	}
	return false;
}

/** Half the width of a part along its X, in meters, from its shape (a guess for shapes without an obvious width). */
function halfWidth(p: Part): number {
	const s = p.shape;
	const w =
		s.type === 'ellipsoid' ? s.radii[0]
		: s.type === 'sphere' ? s.radius
		: s.type === 'box' || s.type === 'prism' ? s.size[0] / 2
		: s.type === 'capsule' || s.type === 'cylinder' ? s.radius
		: 0.03;
	return w * scaleOf(p)[0];
}

/** The part changes and sculpts an expression makes, preset first, then its own. */
export function expressionChanges(scene: Scene, e: Expression): { parts: Record<string, Record<string, unknown>>; sculpts: Sculpt[]; problem?: string } {
	const parts: Record<string, Record<string, unknown>> = {};
	const sculpts: Sculpt[] = [];
	const mouth = mouthOf(scene);
	const need = (what: string) => ({ parts, sculpts, problem: `expression "${e.id}": preset ${e.preset} needs ${what}` });
	switch (e.preset) {
		case 'blink': {
			const lids = lidded(scene);
			if (!lids.length) return need('eye parts (role "eye")');
			for (const p of lids) parts[p.id] = { scale: mul(scaleOf(p), [1, 0.1, 1]) };
			break;
		}
		case 'open_mouth':
		case 'surprise': {
			if (!mouth) return need('a mouth part (role or id "mouth")');
			parts[mouth.id] = { scale: mul(scaleOf(mouth), e.preset === 'surprise' ? [0.65, 3.2, 1.3] : [1.05, 3, 1.3]) };
			if (e.preset === 'surprise') for (const p of lidded(scene)) parts[p.id] = { scale: mul(scaleOf(p), [1.15, 1.25, 1.15]) };
			break;
		}
		case 'smile':
		case 'frown': {
			if (!mouth) return need('a mouth part (role or id "mouth")');
			// the corners go up (or down) by a third of the mouth's width
			const half = halfWidth(mouth);
			parts[mouth.id] = { curve: (e.preset === 'smile' ? 0.35 : -0.3) * half, scale: mul(scaleOf(mouth), [1.08, 1, 1]) };
			break;
		}
	}
	for (const [id, patch] of Object.entries(e.parts ?? {})) parts[id] = { ...(parts[id] ?? {}), ...patch };
	sculpts.push(...(e.sculpts ?? []));
	return { parts, sculpts };
}

/** The scene with an expression made. */
export function expressionScene(scene: Scene, e: Expression): { scene: Scene; problem?: string } {
	const ch = expressionChanges(scene, e);
	if (ch.problem) return { scene, problem: ch.problem };
	const merge = (base: Record<string, unknown>, patch: Record<string, unknown>) => {
		const out: Record<string, unknown> = { ...base };
		for (const [k, v] of Object.entries(patch))
			out[k] = v && typeof v === 'object' && !Array.isArray(v) && k !== 'shape' && base[k] && typeof base[k] === 'object' ? { ...(base[k] as object), ...v } : v;
		return out;
	};
	return {
		scene: {
			...scene,
			parts: scene.parts.map((p) => (ch.parts[p.id] ? (merge(p as unknown as Record<string, unknown>, ch.parts[p.id]) as unknown as Part) : p)),
			sculpts: [...(scene.sculpts ?? []), ...ch.sculpts.map((s, i) => ({ ...s, id: `${e.id}_${s.id ?? i}` }))]
		}
	};
}

/** Compile every expression of a build once. */
const cache = new WeakMap<Build, { compiled: Map<string, Compiled>; meshes: WeakMap<MeshData, MorphTarget[]>; problems: string[]; notes: string[] }>();

function expressionsOf(b: Build) {
	let hit = cache.get(b);
	if (hit) return hit;
	const compiled = new Map<string, Compiled>();
	const problems: string[] = [];
	for (const e of b.source.expressions ?? []) {
		const r = expressionScene(b.source, e);
		if (r.problem) problems.push(r.problem);
		else compiled.set(e.id, compile(applyStyle(r.scene)));
	}
	// vertex colors ride with their vertices: an eye fused into the face leaves its color behind as it closes
	const notes: string[] = [];
	for (const e of b.source.expressions ?? []) {
		if (e.preset !== 'blink') continue;
		const fused = lidded(b.source).filter((p) => !p.separate);
		if (fused.length) notes.push(`expression "${e.id}": ${fused.map((p) => p.id).join(', ')} ${fused.length > 1 ? 'are' : 'is'} blended into the body, so ${fused.length > 1 ? 'their' : 'its'} color stays as a streak when the eye closes; set "separate": true on ${fused.length > 1 ? 'them' : 'it'} for a clean blink`);
	}
	hit = { compiled, meshes: new WeakMap(), problems, notes };
	cache.set(b, hit);
	return hit;
}

/** A part that flutters: its four morph targets (a travelling wave as cos⁺, sin⁺, cos⁻, sin⁻ of its phase) and how often a wave passes. */
export interface ClothTargets {
	prim: number;
	ids: [string, string, string, string];
	/** waves per second */
	frequency: number;
	amplitude: number;
	wavelength: number;
	pin: 'left' | 'right' | 'top' | 'bottom';
}

const clothCache = new WeakMap<Build, ClothTargets[]>();

/** The fluttering parts of a build (separate, visible, with wind). */
export function clothTargets(b: Build): ClothTargets[] {
	const hit = clothCache.get(b);
	if (hit) return hit;
	const out: ClothTargets[] = [];
	for (const pr of b.compiled.prims) {
		const cl = pr.part.cloth;
		if (!cl || pr.hidden || !pr.separate) continue;
		const wind = cl.wind ?? 4;
		if (wind <= 0) continue;
		const pin = cl.pin ?? (pr.role === 'flag' ? 'left' : 'top');
		const across = pin === 'left' || pin === 'right' ? 0 : 1;
		const length = (pr.lmax[across] - pr.lmin[across]) * pr.scl[across];
		const amplitude = cl.amplitude ?? length * 0.1 * Math.min(2, wind / 4);
		const wavelength = cl.wavelength ?? length * 0.7;
		// waves run downwind at about a third of the wind
		const frequency = (wind * 0.35) / wavelength;
		const base = pr.id.replace(/\.m$/, '_mirror');
		out.push({ prim: pr.index, ids: [0, 1, 2, 3].map((i) => `${base}_flutter${i}`) as ClothTargets['ids'], frequency, amplitude, wavelength, pin });
	}
	clothCache.set(b, out);
	return out;
}

/** Every morph target id a build exports: expressions it could make, then fluttering parts. */
export function morphIds(b: Build): string[] {
	const bad = expressionProblems(b);
	return [...(b.source.expressions ?? []).map((e) => e.id).filter((id) => !bad.some((p) => p.startsWith(`expression "${id}"`))), ...clothTargets(b).flatMap((c) => c.ids)];
}

/** The four flutter targets of a cloth part's mesh: sin(k·s − φ) along the part, for φ = 0°, 90°, 180°, 270°, growing from the pinned edge. */
function flutterTargets(b: Build, m: MeshData, c: ClothTargets): MorphTarget[] {
	const pr = b.compiled.prims[c.prim];
	const n = m.positions.length / 3;
	const along = c.pin === 'left' || c.pin === 'right' ? 0 : 1;
	const lo = pr.lmin[along], hi = pr.lmax[along];
	const span = hi - lo || 1;
	const len = span * pr.scl[along];
	const k = (Math.PI * 2) / c.wavelength;
	const rot = (v: V3): V3 => {
		const o = toWorld(pr, [0, 0, 0]), t = toWorld(pr, v);
		const d: V3 = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
		const l = Math.hypot(...d) || 1;
		return [d[0] / l, d[1] / l, d[2] / l];
	};
	const N = rot([0, 0, 1]);
	const T = rot(along === 0 ? [c.pin === 'left' ? 1 : -1, 0, 0] : [0, c.pin === 'bottom' ? 1 : -1, 0]);
	const phases = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
	return c.ids.map((id, i) => {
		const dp = new Float32Array(n * 3), dn = new Float32Array(n * 3);
		let moved = 0, max = 0;
		for (let v = 0; v < n; v++) {
			const l = toLocal(pr, m.positions[v * 3] - b.offset[0], m.positions[v * 3 + 1] - b.offset[1], m.positions[v * 3 + 2] - b.offset[2]);
			const u = Math.max(0, Math.min(1, c.pin === 'left' || c.pin === 'bottom' ? (l[along] - lo) / span : (hi - l[along]) / span));
			const s = u * len;
			// the pinned edge holds; the swing grows toward the free edge
			const A = c.amplitude * u ** 1.3;
			const dA = u > 0 ? (c.amplitude * 1.3 * u ** 0.3) / len : 0;
			const h = A * Math.sin(k * s - phases[i]);
			const slope = dA * Math.sin(k * s - phases[i]) + A * k * Math.cos(k * s - phases[i]);
			dp.set([N[0] * h, N[1] * h, N[2] * h], v * 3);
			// the surface tilts with the slope; the back face tilts the other way, the rim barely
			const side = m.normals[v * 3] * N[0] + m.normals[v * 3 + 1] * N[1] + m.normals[v * 3 + 2] * N[2];
			const g = -slope * side;
			dn.set([T[0] * g, T[1] * g, T[2] * g], v * 3);
			if (Math.abs(h) > 1e-4) moved++;
			max = Math.max(max, Math.abs(h));
		}
		return { id, dp, dn, moved, max };
	});
}

/** Why an expression could not be made (a preset without the parts it needs). */
export function expressionProblems(b: Build): string[] {
	return expressionsOf(b).problems;
}

/** Advice about expressions that work but will not look clean. */
export function expressionNotes(b: Build): string[] {
	return expressionsOf(b).notes;
}

/** Morph targets of one mesh of the build, in the scene's expression order (made ones only). */
export function meshMorphs(b: Build, m: MeshData): MorphTarget[] {
	const ex = expressionsOf(b);
	const hit = ex.meshes.get(m);
	if (hit) return hit;
	const out: MorphTarget[] = [];
	const n = m.positions.length / 3;
	const c0 = b.compiled;
	const h = b.cell * 0.5;
	for (const [id, c1] of ex.compiled) {
		const dp = new Float32Array(n * 3), dn = new Float32Array(n * 3);
		let moved = 0, max = 0;
		const old: Prim | null = m.prim >= 0 ? c0.prims[m.prim] : null;
		const now: Prim | null = old ? c1.byId.get(old.id) ?? null : null;
		const shape = old?.part.shape;
		const direct = !!shape && (shape.type === 'sheet' || (shape.type === 'mesh' && !!shape.keep));
		const f0 = old ? (x: number, y: number, z: number) => partDist(old, x, y, z) : (x: number, y: number, z: number) => bodyField(c0, x, y, z);
		const f1 = now ? (x: number, y: number, z: number) => partDist(now, x, y, z) : (x: number, y: number, z: number) => bodyField(c1, x, y, z);
		const moves = !!old && !!now && changed(old, now);
		for (let v = 0; v < n; v++) {
			// scene coordinates: the build stands on the ground
			const p: V3 = [m.positions[v * 3] - b.offset[0], m.positions[v * 3 + 1] - b.offset[1], m.positions[v * 3 + 2] - b.offset[2]];
			// a vertex rides with the part it belongs to (its color goes where the part goes), then settles on the new surface
			const po = old ?? c0.prims[m.vertPrim[v]];
			const pn = old ? now : po ? c1.byId.get(po.id) ?? null : null;
			const carried = po && pn && (old || changed(po, pn)) ? carry(po, pn, p) : p;
			if (!moves && carried === p && Math.abs(f1(p[0], p[1], p[2]) - f0(p[0], p[1], p[2])) < 1e-7) continue;
			let q0 = p, q1 = carried, n0: V3, n1: V3;
			if (direct) {
				n0 = [m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]];
				n1 = now && old ? rotateLike(now, old, n0) : n0;
			} else {
				const a = pull(f0, p, h), c = pull(f1, carried, h);
				q0 = a.p; q1 = c.p; n0 = a.n; n1 = c.n;
			}
			const d: V3 = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
			const l = Math.hypot(d[0], d[1], d[2]);
			if (l < 1e-4 && !moves) continue;
			dp.set(d, v * 3);
			dn.set([n1[0] - n0[0], n1[1] - n0[1], n1[2] - n0[2]], v * 3);
			if (l > 1e-4) moved++;
			max = Math.max(max, l);
		}
		out.push({ id, dp, dn, moved, max });
	}
	for (const c of clothTargets(b)) {
		if (m.prim === c.prim) out.push(...flutterTargets(b, m, c));
		else for (const id of c.ids) out.push({ id, dp: new Float32Array(n * 3), dn: new Float32Array(n * 3), moved: 0, max: 0 });
	}
	ex.meshes.set(m, out);
	return out;
}

/** A part moved, turned, rescaled or bent. */
function changed(a: Prim, c: Prim): boolean {
	const eq = (x: ArrayLike<number>, y: ArrayLike<number>) => Array.from(x).every((v, i) => Math.abs(v - y[i]) < 1e-9);
	return !(eq(a.pos, c.pos) && eq(a.rot, c.rot) && eq(a.scl, c.scl) && Math.abs(a.curveK - c.curveK) < 1e-12);
}

/** Where a point on part `a` goes when the part becomes `c`: the same place in the part's own frame, bent as it is bent. */
function carry(a: Prim, c: Prim, p: V3): V3 {
	const l = toLocal(a, p[0], p[1], p[2]);
	l[1] += (c.curveK - a.curveK) * l[0] * l[0];
	return toWorld(c, l);
}

/** A normal of `old`'s frame turned into `now`'s. */
function rotateLike(now: Prim, old: Prim, n: V3): V3 {
	const o = toWorld(now, toLocal(old, 0, 0, 0));
	const t = toWorld(now, toLocal(old, n[0], n[1], n[2]));
	const d: V3 = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
	const l = Math.hypot(...d) || 1;
	return [d[0] / l, d[1] / l, d[2] / l];
}

/** Pull a point onto a distance field's zero surface along its gradient (a few Newton steps). */
function pull(f: (x: number, y: number, z: number) => number, p: V3, h: number): { p: V3; n: V3 } {
	let q: V3 = [p[0], p[1], p[2]];
	let g: V3 = [0, 1, 0];
	for (let it = 0; it < 6; it++) {
		const d = f(q[0], q[1], q[2]);
		g = [
			(f(q[0] + h, q[1], q[2]) - f(q[0] - h, q[1], q[2])) / (2 * h),
			(f(q[0], q[1] + h, q[2]) - f(q[0], q[1] - h, q[2])) / (2 * h),
			(f(q[0], q[1], q[2] + h) - f(q[0], q[1], q[2] - h)) / (2 * h)
		];
		const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
		if (g2 < 1e-12) break;
		// never jump more than a few cells in one step: a far surface is not this vertex's surface
		const step = Math.max(-h * 6, Math.min(h * 6, d / g2 * Math.sqrt(g2))) / Math.sqrt(g2);
		q = [q[0] - g[0] * step, q[1] - g[1] * step, q[2] - g[2] * step];
		if (Math.abs(d) < h * 1e-3) break;
	}
	const gl = Math.hypot(...g) || 1;
	return { p: q, n: [g[0] / gl, g[1] / gl, g[2] / gl] };
}

/** One line about the expressions an export carries, the ones it could not make, and advice; empty when there are none. */
export function expressionReport(b: Build, made: { id: string; vertices: number; max: number }[] | undefined): string {
	const parts: string[] = [];
	if (made?.length)
		parts.push(
			`expressions as morph targets: ${made
				.map((e) => (e.vertices ? `${e.id} (${e.vertices.toLocaleString('en')} vertices, up to ${(e.max * 100).toFixed(1)} cm)` : `${e.id} (moves nothing: the change is hidden or the triangle budget left no vertices there)`))
				.join(', ')}`
		);
	for (const p of expressionProblems(b)) parts.push(`not made: ${p}`);
	for (const n of expressionNotes(b)) parts.push(n);
	return parts.length ? ` · ${parts.join(' · ')}` : '';
}
