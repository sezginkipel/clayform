/**
 * Convex hulls for collision: incremental hull over a thinned point set.
 * Each part's hull together makes a compound collider that follows the
 * model's own structure, which is what engines want for physics.
 */

type P = [number, number, number];

interface Face {
	a: number;
	b: number;
	c: number;
	n: P;
	d: number;
	alive: boolean;
}

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P, b: P): P => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Keep at most one point per grid cell (the hull only needs the outside, and fewer points is faster). */
export function thin(points: P[], cells = 24): P[] {
	if (points.length <= 64) return points;
	const min: P = [Infinity, Infinity, Infinity], max: P = [-Infinity, -Infinity, -Infinity];
	for (const p of points) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
	const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-9) / cells;
	const keep = new Map<string, P>();
	const c: P = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
	for (const p of points) {
		const k = `${Math.floor((p[0] - min[0]) / size)},${Math.floor((p[1] - min[1]) / size)},${Math.floor((p[2] - min[2]) / size)}`;
		const q = keep.get(k);
		// in each cell keep the point farthest from the center: it is the one that can be on the hull
		if (!q || dot(sub(p, c), sub(p, c)) > dot(sub(q, c), sub(q, c))) keep.set(k, p);
	}
	return [...keep.values()];
}

export interface Hull {
	positions: Float32Array;
	indices: Uint32Array;
}

export function convexHull(input: P[], cells = 14): Hull | null {
	// Engines cap convex colliders at a few hundred vertices, so the hull is built from a thinned
	// set: it may sit up to one thinning cell inside the surface, which is fine for physics.
	const thinned = thin(input, cells);
	const pts = thinned;
	if (pts.length < 4) return null;
	const scale = Math.max(...pts.flatMap((p) => p.map(Math.abs)), 1e-9);
	const eps = scale * 1e-7;
	// initial tetrahedron from extreme points
	let i0 = 0, i1 = 0;
	for (let i = 1; i < thinned.length; i++) {
		if (pts[i][0] < pts[i0][0]) i0 = i;
		if (pts[i][0] > pts[i1][0]) i1 = i;
	}
	if (i0 === i1) return null;
	const line = sub(pts[i1], pts[i0]);
	let i2 = -1, best = -1;
	for (let i = 0; i < pts.length; i++) {
		const d = dot(cross(line, sub(pts[i], pts[i0])), cross(line, sub(pts[i], pts[i0])));
		if (d > best) { best = d; i2 = i; }
	}
	const plane = cross(line, sub(pts[i2], pts[i0]));
	let i3 = -1;
	best = -1;
	for (let i = 0; i < pts.length; i++) {
		const d = Math.abs(dot(plane, sub(pts[i], pts[i0])));
		if (d > best) { best = d; i3 = i; }
	}
	if (best <= eps * Math.hypot(...plane)) return null; // flat
	let faces: Face[] = [];
	const centroid: P = [0, 1, 2].map((a) => (pts[i0][a] + pts[i1][a] + pts[i2][a] + pts[i3][a]) / 4) as P;
	const make = (a: number, b: number, c: number) => {
		let n = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]));
		const l = Math.hypot(...n) || 1;
		n = [n[0] / l, n[1] / l, n[2] / l];
		let f: Face = { a, b, c, n, d: dot(n, pts[a]), alive: true };
		if (dot(n, centroid) - f.d > 0) f = { a, b: c, c: b, n: [-n[0], -n[1], -n[2]], d: -f.d, alive: true };
		faces.push(f);
	};
	make(i0, i1, i2); make(i0, i1, i3); make(i0, i2, i3); make(i1, i2, i3);
	const used = new Set([i0, i1, i2, i3]);
	let dead = 0;
	for (let p = 0; p < pts.length; p++) {
		if (used.has(p)) continue;
		const visible = faces.filter((f) => f.alive && dot(f.n, pts[p]) - f.d > eps);
		if (!visible.length) continue;
		dead += visible.length;
		const edges = new Map<string, [number, number]>();
		for (const f of visible) {
			f.alive = false;
			for (const [u, v] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]] as [number, number][]) {
				const back = `${v},${u}`;
				if (edges.has(back)) edges.delete(back);
				else edges.set(`${u},${v}`, [u, v]);
			}
		}
		for (const [u, v] of edges.values()) {
			let n = cross(sub(pts[v], pts[u]), sub(pts[p], pts[u]));
			const l = Math.hypot(...n) || 1;
			n = [n[0] / l, n[1] / l, n[2] / l];
			faces.push({ a: u, b: v, c: p, n, d: dot(n, pts[u]), alive: true });
		}
		if (dead > 256) {
			faces = faces.filter((f) => f.alive);
			dead = 0;
		}
	}
	const live = faces.filter((f) => f.alive);
	const remap = new Map<number, number>();
	const pos: number[] = [], idx: number[] = [];
	const at = (i: number) => {
		if (!remap.has(i)) {
			remap.set(i, pos.length / 3);
			pos.push(...pts[i]);
		}
		return remap.get(i)!;
	};
	for (const f of live) idx.push(at(f.a), at(f.b), at(f.c));
	return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
