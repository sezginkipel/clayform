/**
 * Exact answers to spatial questions, so agents don't have to judge distances
 * and proportions from pictures.
 *
 * Distances are measured on the parts' own surfaces (not the fused mesh), so
 * two parts that blend into each other still report how deep they overlap.
 * Positions are in the grounded world the renders show.
 */

import type { Build } from './core/build.js';
import { primDist, traceOnto, type Prim } from './core/compile.js';
import type { V3 } from './core/math.js';
import { renderTiles, VIEWS, type View } from './render/views.js';

const r3 = (v: V3): V3 => [+v[0].toFixed(4), +v[1].toFixed(4), +v[2].toFixed(4)];

function prim(b: Build, id: string): Prim {
	const p = b.compiled.byId.get(id);
	if (!p) throw new Error(`no part "${id}" — parts: ${b.compiled.prims.map((q) => q.id).join(', ')}`);
	return p;
}

function grad(p: Prim, x: number, y: number, z: number): V3 {
	const h = 1e-3;
	const gx = primDist(p, x + h, y, z) - primDist(p, x - h, y, z);
	const gy = primDist(p, x, y + h, z) - primDist(p, x, y - h, z);
	const gz = primDist(p, x, y, z + h) - primDist(p, x, y, z - h);
	const l = Math.hypot(gx, gy, gz) || 1;
	return [gx / l, gy / l, gz / l];
}

/** Points on a part's own surface: rays from outside toward its center (Fibonacci sphere). */
function surfacePoints(p: Prim, n = 600): V3[] {
	const c: V3 = [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2];
	const reach = Math.hypot(p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]) + 0.05;
	const out: V3[] = [];
	const ga = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < n; i++) {
		const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), t = ga * i;
		const d: V3 = [Math.cos(t) * r, y, Math.sin(t) * r];
		const hit = traceOnto(p, [c[0] + d[0] * reach, c[1] + d[1] * reach, c[2] + d[2] * reach], [-d[0], -d[1], -d[2]], reach * 1.2);
		if (hit.hit) out.push(hit.p);
	}
	return out;
}

export interface Between {
	a: string;
	b: string;
	/** surface-to-surface; negative = how deep they overlap */
	distance: number;
	pointA: V3;
	pointB: V3;
}

export function measureBetween(bd: Build, aId: string, bId: string): Between {
	const A = prim(bd, aId), B = prim(bd, bId);
	let best = { d: Infinity, p: [0, 0, 0] as V3, from: A, to: B };
	for (const [from, to] of [[A, B], [B, A]] as const)
		for (const p of surfacePoints(from)) {
			const d = primDist(to, p[0], p[1], p[2]);
			if (d < best.d) best = { d, p, from, to };
		}
	// refine: stay on `from`'s surface while moving toward `to`
	let p = best.p;
	for (let i = 0; i < 12; i++) {
		const g = grad(best.to, p[0], p[1], p[2]);
		const q: V3 = [p[0] - g[0] * best.d * 0.5, p[1] - g[1] * best.d * 0.5, p[2] - g[2] * best.d * 0.5];
		const df = primDist(best.from, q[0], q[1], q[2]);
		const gf = grad(best.from, q[0], q[1], q[2]);
		const onFrom: V3 = [q[0] - gf[0] * df, q[1] - gf[1] * df, q[2] - gf[2] * df];
		const d = primDist(best.to, onFrom[0], onFrom[1], onFrom[2]);
		if (d >= best.d) break;
		best.d = d;
		p = onFrom;
	}
	const g = grad(best.to, p[0], p[1], p[2]);
	const onTo: V3 = [p[0] - g[0] * best.d, p[1] - g[1] * best.d, p[2] - g[2] * best.d];
	const up = (v: V3): V3 => r3([v[0], v[1] + bd.offset[1], v[2]]);
	const [pa, pb] = best.from === A ? [p, onTo] : [onTo, p];
	return { a: aId, b: bId, distance: +best.d.toFixed(4), pointA: up(pa), pointB: up(pb) };
}

export interface PartInfo {
	id: string;
	min: V3;
	max: V3;
	size: V3;
	center: V3;
	touchesGround: boolean;
	visible: boolean;
}

export function measurePart(bd: Build, id: string): PartInfo {
	const p = prim(bd, id);
	// visible extent from the vertices the part owns, else its own bounds
	const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
	let seen = false;
	for (const m of bd.meshes)
		for (let v = 0; v < m.vertPrim.length; v++) {
			if (m.vertPrim[v] !== p.index) continue;
			seen = true;
			for (let a = 0; a < 3; a++) {
				min[a] = Math.min(min[a], m.positions[v * 3 + a]);
				max[a] = Math.max(max[a], m.positions[v * 3 + a]);
			}
		}
	if (!seen) {
		for (let a = 0; a < 3; a++) {
			min[a] = p.min[a] + (a === 1 ? bd.offset[1] : 0);
			max[a] = p.max[a] + (a === 1 ? bd.offset[1] : 0);
		}
	}
	return {
		id,
		min: r3(min),
		max: r3(max),
		size: r3([max[0] - min[0], max[1] - min[1], max[2] - min[2]]),
		center: r3([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]),
		touchesGround: min[1] < bd.cell * 1.2,
		visible: seen
	};
}

export function measureRatio(bd: Build, a: string, b: string, axis: 'x' | 'y' | 'z' | 'max' = 'y'): { ratio: number; a: number; b: number } {
	const A = measurePart(bd, a).size, B = measurePart(bd, b).size;
	const pick = (s: V3) => (axis === 'max' ? Math.max(...s) : s['xyz'.indexOf(axis)]);
	const va = pick(A), vb = pick(B);
	return { ratio: +(va / Math.max(vb, 1e-9)).toFixed(4), a: va, b: vb };
}

/** Which part is at pixel (x, y) of a `render` tile of this view and size. */
export function partAtPixel(bd: Build, view: View, x: number, y: number, size = 384): string | null {
	if (typeof view === 'string' && !(VIEWS as readonly string[]).includes(view)) throw new Error(`unknown view "${view}"`);
	if (x < 0 || y < 0 || x >= size || y >= size) throw new Error(`pixel (${x}, ${y}) is outside a ${size}×${size} tile`);
	const { tiles } = renderTiles(bd, { views: [view], size, ids: true });
	const id = tiles[0].ids![Math.floor(y) * size + Math.floor(x)];
	return id >= 0 ? bd.compiled.prims[id].id : null;
}
