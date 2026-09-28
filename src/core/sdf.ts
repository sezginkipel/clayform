/**
 * Signed distance primitives (local space) and blending operators.
 * Most formulas follow Inigo Quilez's well-known SDF reference.
 */

import type { Shape } from './schema.js';
import type { V3 } from './math.js';
import { meshField } from './meshload.js';

export type LocalSdf = (x: number, y: number, z: number) => number;

/* ------------------------------------------------------------- operators */

/** Polynomial smooth minimum. k = blend radius; k=0 is an exact min. */
export function smin(a: number, b: number, k: number): number {
	if (k <= 1e-7) return a < b ? a : b;
	const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
	return b * (1 - h) + a * h - k * h * (1 - h);
}

/** Smooth subtraction: carve `c` out of `d`. */
export function ssub(c: number, d: number, k: number): number {
	if (k <= 1e-7) return Math.max(d, -c);
	const h = Math.max(0, Math.min(1, 0.5 - (0.5 * (d + c)) / k));
	return d * (1 - h) - c * h + k * h * (1 - h);
}

/** Smooth intersection. */
export function smax(a: number, b: number, k: number): number {
	return -smin(-a, -b, k);
}

/* ----------------------------------------------------------- primitives */

function sdEllipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
	const k0 = Math.hypot(x / rx, y / ry, z / rz);
	const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
	return k1 < 1e-12 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function sdRoundBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, r: number): number {
	const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r, qz = Math.abs(z) - hz + r;
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** Capped cone around Y from y=-h (radius r1) to y=+h (radius r2). */
function sdCappedCone(qx: number, qy: number, h: number, r1: number, r2: number): number {
	const k2x = r2 - r1, k2y = 2 * h;
	const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
	const k1x = r2, k1y = h;
	const t = Math.max(0, Math.min(1, ((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y)));
	const cbx = qx - k1x + k2x * t, cby = qy - k1y + k2y * t;
	const s = cbx < 0 && cay < 0 ? -1 : 1;
	return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
}

/** Round cone between points a and b with radii r1, r2 (exact). */
function sdRoundCone(px: number, py: number, pz: number, a: V3, b: V3, r1: number, r2: number): number {
	const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
	const l2 = bax * bax + bay * bay + baz * baz;
	if (l2 < 1e-12) return Math.hypot(px - a[0], py - a[1], pz - a[2]) - Math.max(r1, r2);
	const rr = r1 - r2;
	const a2 = l2 - rr * rr;
	const il2 = 1 / l2;
	const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
	const y = pax * bax + pay * bay + paz * baz;
	const z = y - l2;
	const xx = (pax * l2 - bax * y) ** 2 + (pay * l2 - bay * y) ** 2 + (paz * l2 - baz * y) ** 2;
	const y2 = y * y * l2;
	const z2 = z * z * l2;
	const k = Math.sign(rr) * rr * rr * xx;
	if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(xx + z2) * il2 - r2;
	if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(xx + y2) * il2 - r1;
	return (Math.sqrt(xx * a2 * il2) + y * rr) * il2 - r1;
}

/** Isosceles triangle (base w, height h, centered) in XY, extruded ±hz along Z. */
function sdPrism(x: number, y: number, z: number, w: number, h: number, hz: number): number {
	// 2D distance to triangle with vertices A(-w/2,-h/2) B(w/2,-h/2) C(0,h/2)
	const ax = -w / 2, ay = -h / 2, bx = w / 2, by = -h / 2, cx = 0, cy = h / 2;
	const e0x = bx - ax, e0y = by - ay, e1x = cx - bx, e1y = cy - by, e2x = ax - cx, e2y = ay - cy;
	const v0x = x - ax, v0y = y - ay, v1x = x - bx, v1y = y - by, v2x = x - cx, v2y = y - cy;
	const c0 = Math.max(0, Math.min(1, (v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y)));
	const c1 = Math.max(0, Math.min(1, (v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y)));
	const c2 = Math.max(0, Math.min(1, (v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y)));
	const p0x = v0x - e0x * c0, p0y = v0y - e0y * c0;
	const p1x = v1x - e1x * c1, p1y = v1y - e1y * c1;
	const p2x = v2x - e2x * c2, p2y = v2y - e2y * c2;
	const s = Math.sign(e0x * e2y - e0y * e2x);
	const d0 = p0x * p0x + p0y * p0y, d1 = p1x * p1x + p1y * p1y, d2 = p2x * p2x + p2y * p2y;
	const s0 = s * (v0x * e0y - v0y * e0x), s1 = s * (v1x * e1y - v1y * e1x), s2 = s * (v2x * e2y - v2y * e2x);
	const dmin = Math.min(d0, d1, d2);
	const smin2 = Math.min(s0, s1, s2);
	const d2d = -Math.sqrt(dmin) * Math.sign(smin2);
	const wx = d2d, wy = Math.abs(z) - hz;
	return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0));
}

/**
 * Radial coordinate whose level sets are circles (no sides) or regular
 * n-gons with circumradius = value (flat edge facing +Z).
 */
function polyRadial(sides: number | undefined): (x: number, z: number) => number {
	if (!sides) return (x, z) => Math.hypot(x, z);
	const n = sides;
	const cs: number[] = [], sn: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = (2 * Math.PI * i) / n + Math.PI / 2;
		cs.push(Math.cos(a));
		sn.push(Math.sin(a));
	}
	const inv = 1 / Math.cos(Math.PI / n);
	return (x, z) => {
		let m = -Infinity;
		for (let i = 0; i < n; i++) {
			const d = x * cs[i] + z * sn[i];
			if (d > m) m = d;
		}
		return m * inv;
	};
}

/** Build the local distance function for a shape. */
export function shapeSdf(s: Shape): LocalSdf {
	switch (s.type) {
		case 'sphere': {
			const r = s.radius;
			return (x, y, z) => Math.hypot(x, y, z) - r;
		}
		case 'ellipsoid': {
			const [rx, ry, rz] = s.radii;
			return (x, y, z) => sdEllipsoid(x, y, z, rx, ry, rz);
		}
		case 'box': {
			const hx = s.size[0] / 2, hy = s.size[1] / 2, hz = s.size[2] / 2;
			const r = Math.min(s.rounding ?? 0, hx, hy, hz);
			return (x, y, z) => sdRoundBox(x, y, z, hx, hy, hz, r);
		}
		case 'capsule': {
			const r = s.radius;
			const h = Math.max(0, s.length / 2 - r);
			return (x, y, z) => {
				const cy = Math.max(-h, Math.min(h, y));
				return Math.hypot(x, y - cy, z) - r;
			};
		}
		case 'cylinder': {
			const h = s.height / 2, r = s.radius;
			const rr = Math.min(s.rounding ?? 0, h, r);
			const radial = polyRadial(s.sides);
			const ap = s.sides ? Math.cos(Math.PI / s.sides) : 1;
			return (x, y, z) => {
				// faceted: distance to the polygon's edge lines (apothem), exact inside
				const dx = radial(x, z) * ap - (r - rr) * ap, dy = Math.abs(y) - h + rr;
				return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - rr;
			};
		}
		case 'cone': {
			const rr = Math.min(s.rounding ?? 0, s.height / 2, s.radius);
			const h = s.height / 2 - rr;
			const r1 = Math.max(1e-4, s.radius - rr), r2 = Math.max(0, (s.topRadius ?? 0) - rr);
			const radial = polyRadial(s.sides);
			const ap = s.sides ? Math.cos(Math.PI / s.sides) : 1;
			return (x, y, z) => sdCappedCone(radial(x, z), y, h, r1, r2) * ap - rr;
		}
		case 'torus': {
			const R = s.radius, t = s.tube;
			return (x, y, z) => Math.hypot(Math.hypot(x, z) - R, y) - t;
		}
		case 'prism': {
			const rr = Math.min(s.rounding ?? 0, s.size[0] / 4, s.size[1] / 4, s.size[2] / 2);
			const w = s.size[0] - rr * 3, h = s.size[1] - rr * 3, hz = s.size[2] / 2 - rr;
			return (x, y, z) => sdPrism(x, y, z, Math.max(w, 1e-4), Math.max(h, 1e-4), Math.max(hz, 1e-4)) - rr;
		}
		case 'mesh': {
			const f = meshField(s.src, s.size, s.resolution ?? 64);
			return f.sdf;
		}
		case 'tube': {
			const pts = s.points as V3[];
			const radii = Array.isArray(s.radius) ? s.radius : pts.map(() => s.radius as number);
			const k = Math.min(...radii) * 0.35;
			return (x, y, z) => {
				let d = Infinity;
				for (let i = 0; i < pts.length - 1; i++) {
					const di = sdRoundCone(x, y, z, pts[i], pts[i + 1], radii[i], radii[i + 1]);
					d = i === 0 ? di : smin(d, di, k);
				}
				return d;
			};
		}
	}
}

/** Conservative local-space bounding box half extents and center. */
export function shapeBounds(s: Shape): { min: V3; max: V3 } {
	switch (s.type) {
		case 'sphere':
			return { min: [-s.radius, -s.radius, -s.radius], max: [s.radius, s.radius, s.radius] };
		case 'ellipsoid':
			return { min: [-s.radii[0], -s.radii[1], -s.radii[2]], max: [...s.radii] as V3 };
		case 'box':
		case 'prism':
			return { min: [-s.size[0] / 2, -s.size[1] / 2, -s.size[2] / 2], max: [s.size[0] / 2, s.size[1] / 2, s.size[2] / 2] };
		case 'capsule':
			return { min: [-s.radius, -s.length / 2, -s.radius], max: [s.radius, s.length / 2, s.radius] };
		case 'cylinder':
			return { min: [-s.radius, -s.height / 2, -s.radius], max: [s.radius, s.height / 2, s.radius] };
		case 'cone': {
			const r = Math.max(s.radius, s.topRadius ?? 0);
			return { min: [-r, -s.height / 2, -r], max: [r, s.height / 2, r] };
		}
		case 'torus': {
			const r = s.radius + s.tube;
			return { min: [-r, -s.tube, -r], max: [r, s.tube, r] };
		}
		case 'mesh': {
			const f = meshField(s.src, s.size, s.resolution ?? 64);
			return { min: [...f.min] as V3, max: [...f.max] as V3 };
		}
		case 'tube': {
			const radii = Array.isArray(s.radius) ? s.radius : s.points.map(() => s.radius as number);
			const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
			s.points.forEach((p, i) => {
				for (let a = 0; a < 3; a++) {
					min[a] = Math.min(min[a], p[a] - radii[i]);
					max[a] = Math.max(max[a], p[a] + radii[i]);
				}
			});
			return { min, max };
		}
	}
}

/* ---------------------------------------------------------------- noise */

function hash3(x: number, y: number, z: number): number {
	let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [0, 1]. (Hot path: no closures, no allocation.) */
export function noise3(x: number, y: number, z: number): number {
	const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
	const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
	const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
	const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
	const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
	const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
	const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
	const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
	const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
	return y0 + (y1 - y0) * w;
}

/** Three-octave fractal noise in [0, 1]. */
export function fbm3(x: number, y: number, z: number): number {
	return noise3(x, y, z) * 0.57 + noise3(x * 2.03 + 7.1, y * 2.03, z * 2.03) * 0.29 + noise3(x * 4.1 + 3.3, y * 4.1, z * 4.1) * 0.14;
}

/** Distance to nearest random feature point (Worley), roughly in [0, 1.5]. */
export function cells3(x: number, y: number, z: number): number {
	const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
	let best = 9;
	for (let dz = -1; dz <= 1; dz++)
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				const cx = xi + dx + hash3(xi + dx, yi + dy, zi + dz);
				const cy = yi + dy + hash3(yi + dy + 11, zi + dz, xi + dx);
				const cz = zi + dz + hash3(zi + dz + 23, xi + dx, yi + dy);
				const d = Math.hypot(x - cx, y - cy, z - cz);
				if (d < best) best = d;
			}
	return best;
}
