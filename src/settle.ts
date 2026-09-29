/**
 * Settling a layout: every item falls straight down until it rests on the
 * ground or on something below it.
 *
 * Each item is reduced to columns on a grid over the ground: in every
 * column it covers, the lowest and highest point of its surface (from its
 * triangles, not its bounding box, so a mug can stand on a table's top and a
 * lamp does not rest on a hat's brim it misses). Items fall in the order of
 * how low they start, so a stack resolves from the bottom. One that starts
 * inside another is lifted out on top of it. Nothing rotates: an item that
 * lands with its center of mass outside what holds it up is reported as
 * tipping, not tipped over.
 */

import type { Build } from './core/build.js';
import { m4Compose, qEuler, type M4, type V3 } from './core/math.js';

export interface Settled {
	id: string;
	/** starting and resting height of the item's origin */
	from: number;
	to: number;
	/** what it rests on: "ground" or another item's id */
	on: string;
	/** its center of mass is not over what holds it up */
	tips: boolean;
}

interface Item {
	id: string;
	scene: string;
	position: V3;
	rotation: number;
	scale: number;
	fixed?: boolean;
}

/** per grid cell: lowest and highest surface point, and the cell's center */
type Columns = Map<number, [number, number, number, number]>;

/** The columns an item covers at height 0: per grid cell, its lowest and highest surface point. */
function columnsOf(b: Build, M: M4, cell: number): { cols: Columns; com: [number, number] } {
	const cols: Columns = new Map();
	let sx = 0, sz = 0, n = 0;
	const key = (x: number, z: number) => Math.floor(x / cell) * 1_000_003 + Math.floor(z / cell);
	const put = (x: number, y: number, z: number) => {
		const k = key(x, z);
		const c = cols.get(k);
		if (!c) cols.set(k, [y, y, (Math.floor(x / cell) + 0.5) * cell, (Math.floor(z / cell) + 0.5) * cell]);
		else {
			if (y < c[0]) c[0] = y;
			if (y > c[1]) c[1] = y;
		}
	};
	const w = (p: Float32Array, v: number): V3 => {
		const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
		return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
	};
	for (const m of b.meshes) {
		const P = m.positions;
		for (let v = 0; v < P.length / 3; v++) {
			const q = w(P, v);
			sx += q[0]; sz += q[2]; n++;
		}
		// sample each triangle finely enough that no column it crosses is missed
		for (let t = 0; t < m.indices.length; t += 3) {
			const a = w(P, m.indices[t]), c = w(P, m.indices[t + 1]), d = w(P, m.indices[t + 2]);
			const span = Math.max(Math.hypot(a[0] - c[0], a[2] - c[2]), Math.hypot(c[0] - d[0], c[2] - d[2]), Math.hypot(d[0] - a[0], d[2] - a[2]));
			const k = Math.min(64, Math.ceil(span / (cell * 0.5)) + 1);
			for (let i = 0; i <= k; i++)
				for (let j = 0; i + j <= k; j++) {
					const u = i / k, s = j / k, r = 1 - u - s;
					put(a[0] * r + c[0] * u + d[0] * s, a[1] * r + c[1] * u + d[1] * s, a[2] * r + c[2] * u + d[2] * s);
				}
		}
	}
	return { cols, com: n ? [sx / n, sz / n] : [0, 0] };
}

/** Is a point inside the convex hull of some points, allowing `pad`? */
function supported(p: [number, number], pts: [number, number][], pad: number): boolean {
	if (!pts.length) return false;
	const s = pts.slice().sort((a, c) => a[0] - c[0] || a[1] - c[1]);
	const cross = (o: [number, number], a: [number, number], c: [number, number]) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
	const lower: [number, number][] = [], upper: [number, number][] = [];
	for (const q of s) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
		lower.push(q);
	}
	for (const q of s.reverse()) {
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
		upper.push(q);
	}
	const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
	// distance from p to the hull (0 inside)
	const segDist = (a: [number, number], c: [number, number]) => {
		const dx = c[0] - a[0], dz = c[1] - a[1], l2 = dx * dx + dz * dz;
		const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
		return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
	};
	if (hull.length < 3) return (hull.length === 1 ? Math.hypot(p[0] - hull[0][0], p[1] - hull[0][1]) : segDist(hull[0], hull[1])) <= pad;
	let inside = true;
	for (let i = 0; i < hull.length; i++) if (cross(hull[i], hull[(i + 1) % hull.length], p) < 0) inside = false;
	if (inside) return true;
	return Math.min(...hull.map((a, i) => segDist(a, hull[(i + 1) % hull.length]))) <= pad;
}

/** Drop the items (in place: their y changes) and say where each came to rest. */
export function settleItems(items: Item[], builds: Map<string, Build>, gap = 0.001): Settled[] {
	// a grid fine enough for the smallest item
	const sizes = items.map((it) => {
		const b = builds.get(it.scene)!;
		return Math.min(b.max[0] - b.min[0], b.max[2] - b.min[2]) * it.scale;
	});
	const cell = Math.max(0.004, Math.min(0.05, Math.min(...sizes) / 12));
	const shapes = items.map((it) => {
		const M = m4Compose([it.position[0], 0, it.position[2]], qEuler([0, it.rotation, 0]), [it.scale, it.scale, it.scale]);
		return columnsOf(builds.get(it.scene)!, M, cell);
	});
	const lowest = (i: number) => items[i].position[1] + Math.min(...[...shapes[i].cols.values()].map((c) => c[0]));
	const order = items.map((_, i) => i).sort((a, c) => Number(!!items[c].fixed) - Number(!!items[a].fixed) || lowest(a) - lowest(c));
	// what has come to rest so far, per column: [bottom, top, item]
	const rested = new Map<number, [number, number, number][]>();
	const out: Settled[] = new Array(items.length);
	for (const i of order) {
		const it = items[i], cols = shapes[i].cols;
		const y0 = it.position[1];
		let best = -Infinity, on = 'ground';
		if (it.fixed) best = y0;
		else {
			best = -Math.min(...[...cols.values()].map((c) => c[0]));
			for (const [k, [lo, hi]] of cols)
				for (const [s0, s1, j] of rested.get(k) ?? []) {
					// below the item as it starts: it lands on it; overlapping it at the start: lifted out on top
					const below = s1 <= y0 + lo + cell * 0.5;
					const overlaps = !below && s0 < y0 + hi;
					if (!below && !overlaps) continue;
					const y = s1 - lo;
					if (y > best + 1e-9) {
						best = y;
						on = items[j].id;
					}
				}
			// a lift can carry it into something that rested above where it started: keep lifting until clear
			for (let pass = 0; pass < 64; pass++) {
				let lifted = false;
				for (const [k, [lo, hi]] of cols)
					for (const [s0, s1, j] of rested.get(k) ?? [])
						if (s0 < best + hi - 1e-6 && s1 > best + lo + 1e-6) {
							best = s1 - lo;
							on = items[j].id;
							lifted = true;
						}
				if (!lifted) break;
			}
			best += gap;
		}
		// what holds it up: the columns within a cell of touching
		const contacts: [number, number][] = [];
		for (const [k, [lo, , cx, cz]] of cols) {
			const bottom = best + lo;
			const touching = bottom < cell * 0.75 + gap || (rested.get(k) ?? []).some(([, s1]) => Math.abs(s1 - bottom) < cell * 0.75 + gap);
			if (touching) contacts.push([cx, cz]);
		}
		const tips = !it.fixed && !supported(shapes[i].com, contacts, cell);
		out[i] = { id: it.id, from: y0, to: best, on: it.fixed ? 'fixed' : on, tips };
		it.position = [it.position[0], best, it.position[2]];
		for (const [k, [lo, hi]] of cols) {
			const list = rested.get(k) ?? [];
			list.push([best + lo, best + hi, i]);
			rested.set(k, list);
		}
	}
	return out;
}
