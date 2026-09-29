/**
 * Shapes an agent describes with a few numbers instead of modeling by hand:
 * a profile spun around an axis, an outline extruded, a line of text, a
 * patch of terrain. All are exact (or safely under-estimating) distance
 * fields, so they blend, carve, attach and get checked like any other part.
 */

import { glyph } from '../render/font.js';
import { fbm3 } from './sdf.js';

export type Pt = [number, number];

/**
 * Centripetal Catmull-Rom through the points, `steps` segments per span;
 * closed curves wrap around. Centripetal spacing never overshoots or loops
 * back, even when the points are unevenly spaced (a short foot, then a long
 * shaft), so a smoothed profile never folds over itself.
 */
export function smoothPath(pts: Pt[], closed: boolean, steps = 8): Pt[] {
	const n = pts.length;
	if (n < 3) return pts;
	const at = (i: number): Pt => {
		if (closed) return pts[((i % n) + n) % n];
		if (i < 0) return [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]];
		if (i >= n) return [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]];
		return pts[i];
	};
	const knot = (a: Pt, b: Pt) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
	const out: Pt[] = [];
	const spans = closed ? n : n - 1;
	for (let i = 0; i < spans; i++) {
		const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
		const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
		for (let k = 0; k < steps; k++) {
			const t = t1 + ((t2 - t1) * k) / steps;
			const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
				const w = (t - ta) / (tb - ta);
				return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
			};
			const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
			const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
			out.push(lerp(b1, b2, t1, t2));
		}
	}
	if (!closed) out.push(pts[n - 1]);
	return out;
}

/** Signed distance to a closed polygon in 2D (negative inside). */
export function sdPolygon(px: number, py: number, pts: Pt[]): number {
	const n = pts.length;
	let d = (px - pts[0][0]) ** 2 + (py - pts[0][1]) ** 2;
	let s = 1;
	for (let i = 0, j = n - 1; i < n; j = i, i++) {
		const [vx, vy] = pts[i], [ux, uy] = pts[j];
		const ex = ux - vx, ey = uy - vy;
		const wx = px - vx, wy = py - vy;
		const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
		const bx = wx - ex * t, by = wy - ey * t;
		d = Math.min(d, bx * bx + by * by);
		const c1 = py >= vy, c2 = py < uy, c3 = ex * wy > ey * wx;
		if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
	}
	return s * Math.sqrt(d);
}

/** Distance to an open polyline in 2D. */
export function sdPolyline(px: number, py: number, pts: Pt[]): number {
	let d = Infinity;
	for (let i = 0; i < pts.length - 1; i++) {
		const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
		const ex = bx - ax, ey = by - ay, wx = px - ax, wy = py - ay;
		const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
		d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
	}
	return d;
}

/** A lathe wall: the profile with a closed bottom (to the axis) and an open top. */
export function latheWall(profile: Pt[]): Pt[] {
	const pts = profile.map(([r, y]) => [Math.max(0, r), y] as Pt);
	return pts[0][0] > 1e-9 ? [[0, pts[0][1]], ...pts] : pts;
}

/**
 * The closed cross-section a lathe profile sweeps: the profile and its mirror
 * across the axis. The axis is then inside the polygon, not on its edge, so
 * points on the axis get their true (negative) distance.
 */
export function latheOutline(profile: Pt[]): Pt[] {
	const pts = profile.map(([r, y]) => [Math.max(0, r), y] as Pt);
	return [...pts, ...pts.slice().reverse().map(([r, y]) => [-r, y] as Pt)];
}

/** 2D distance for an outline extruded along Z, with rounding, chamfer and taper. */
export function extrudeDist(x: number, y: number, z: number, outline: Pt[], half: number, rounding: number, bevel: number, taper: number): number {
	// taper: the outline is scaled from 1 at the back (-z) to `taper` at the front (+z)
	const t = (Math.max(-half, Math.min(half, z)) + half) / (2 * half);
	const s = 1 + (taper - 1) * t;
	const d2 = sdPolygon(x / s, y / s, outline) * Math.min(1, s);
	const r = rounding;
	const wx = d2 + r, wy = Math.abs(z) - half + r;
	let d = Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - r;
	// chamfer: a 45° cut along the front and back rims
	if (bevel > 0) d = Math.max(d, (d2 + Math.abs(z) - half + bevel) * Math.SQRT1_2);
	return d;
}

/* ------------------------------------------------------------------ text */

export interface TextGrid {
	/** occupied cells, row-major, row 0 at the top */
	cells: Uint8Array;
	cols: number;
	rows: number;
	/** cell size in meters */
	cell: number;
}

/** Lay a line of text out on the 5×7 font grid (one blank column between letters). */
export function textGrid(text: string, height: number): TextGrid {
	const chars = [...text.toUpperCase()];
	const cols = Math.max(1, chars.length * 6 - 1), rows = 7;
	const cells = new Uint8Array(cols * rows);
	chars.forEach((ch, i) => {
		const g = glyph(ch);
		if (!g) return;
		for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === '1') cells[r * cols + i * 6 + c] = 1;
	});
	return { cells, cols, rows, cell: height / 7 };
}

/**
 * Distance to the union of the lit cells, centred on the origin (x right, y up).
 * Exact within a few cells of the letters, a safe under-estimate further out.
 */
export function textDist2(x: number, y: number, g: TextGrid): number {
	const c = g.cell;
	const u = x / c + g.cols / 2, v = g.rows / 2 - y / c;
	const R = 3;
	// far from the text: distance to the text's box
	const ox = Math.max(-u, u - g.cols, 0), oy = Math.max(-v, v - g.rows, 0);
	if (ox > R || oy > R) return Math.hypot(ox, oy) * c;
	const cu = Math.floor(u), cv = Math.floor(v);
	const lit = (i: number, j: number) => i >= 0 && j >= 0 && i < g.cols && j < g.rows && g.cells[j * g.cols + i] === 1;
	const inside = lit(cu, cv);
	let best = R;
	for (let j = cv - R; j <= cv + R; j++)
		for (let i = cu - R; i <= cu + R; i++) {
			if (lit(i, j) === inside) continue;
			// distance from the point to cell (i, j)
			const dx = Math.max(i - u, 0, u - (i + 1)), dy = Math.max(j - v, 0, v - (j + 1));
			const d = Math.hypot(dx, dy);
			if (d < best) best = d;
		}
	return (inside ? -best : best) * c;
}

/* --------------------------------------------------------------- terrain */

export interface TerrainSpec {
	width: number;
	depth: number;
	height: number;
	base: number;
	scale: number;
	seed: number;
	roughness: number;
}

/** Height of the terrain surface at (x, z), from 0 up to `height`. */
export function terrainHeight(x: number, z: number, t: TerrainSpec): number {
	const s = 1 / t.scale;
	const k = t.roughness;
	// broad hills plus rougher detail, weighted by roughness
	const broad = fbm3(x * s + t.seed * 17.13, t.seed * 3.7, z * s - t.seed * 11.9);
	const fine = fbm3(x * s * 4 + 40.2, t.seed * 5.1 + 9.3, z * s * 4 - 21.7);
	const h = broad * (1 - 0.35 * k) + fine * 0.35 * k;
	return Math.max(0, Math.min(1, (h - 0.25) / 0.5)) * t.height;
}

export function terrainDist(x: number, y: number, z: number, t: TerrainSpec): number {
	// a heightfield is not a true distance: scale by the steepest slope it can have
	const slope = (t.height / t.scale) * 4;
	const dh = (y - terrainHeight(x, z, t)) / Math.sqrt(1 + slope * slope);
	const dx = Math.abs(x) - t.width / 2, dz = Math.abs(z) - t.depth / 2, db = -t.base - y;
	return Math.max(dh, dx, dz, db);
}
