/**
 * Material presets: surfaces an agent names instead of paints. Each preset
 * is a function of the point on the part (in its own frame, so the pattern
 * moves with it) and of the surface direction, giving
 *
 *   mix     how much of the accent colour shows (0 = base colour)
 *   height  relief, 0 (in a groove) to 1 (on top), for normal maps and crevice shading
 *   rough   roughness here, or null to keep the material's
 *   metal   metalness here, or null to keep the material's
 *   shade   a darkening multiplier for variation between bricks, stones, boards (1 = none)
 *
 * Vertex colours use mix and height, so the renders an agent looks at show
 * the preset; baked textures add the relief as a normal map and the
 * roughness and metalness as a map of their own.
 */

import { fbm3, noise3 } from './sdf.js';
import type { V3 } from './math.js';

export const PRESETS = ['wood', 'planks', 'brick', 'stone', 'cobbles', 'tiles', 'metal', 'rust', 'fabric', 'leather', 'grass', 'bark', 'marble', 'sand'] as const;
export type PresetKind = (typeof PRESETS)[number];

export interface PresetSample {
	mix: number;
	height: number;
	rough: number | null;
	metal: number | null;
	shade?: number;
}

/** Feature size in meters when none is given. */
export const PRESET_SCALE: Record<PresetKind, number> = {
	wood: 0.05, planks: 0.18, brick: 0.25, stone: 0.3, cobbles: 0.15, tiles: 0.2, metal: 0.05, rust: 0.2,
	fabric: 0.02, leather: 0.02, grass: 0.12, bark: 0.06, marble: 0.4, sand: 0.3
};

/** The accent a preset uses when none is given, derived from the base colour. */
export function defaultAccent(kind: PresetKind, base: [number, number, number]): [number, number, number] {
	const k = (f: number) => base.map((c) => Math.max(0, Math.min(1, c * f))) as [number, number, number];
	switch (kind) {
		case 'brick':
		case 'tiles':
		case 'stone':
		case 'cobbles':
			return [0.78, 0.76, 0.72]; // mortar and grout
		case 'rust':
			return [0.55, 0.29, 0.16];
		case 'grass':
			return [0.72, 0.68, 0.36]; // dry patches
		case 'marble':
			return k(0.55);
		default:
			return k(0.62);
	}
}

const frac = (x: number) => x - Math.floor(x);
const smooth = (a: number, b: number, x: number) => {
	const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
function hash(i: number, j: number, k = 0): number {
	let h = (i * 374761393 + j * 668265263 + k * 1274126177) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Worley noise in 2D: distance to the nearest and second-nearest feature point, and the nearest cell's id. */
function worley(x: number, y: number): { f1: number; f2: number; id: number } {
	const xi = Math.floor(x), yi = Math.floor(y);
	let f1 = 9, f2 = 9, id = 0;
	for (let j = -1; j <= 1; j++)
		for (let i = -1; i <= 1; i++) {
			const cx = xi + i, cy = yi + j;
			const px = cx + hash(cx, cy, 1), py = cy + hash(cx, cy, 2);
			const d = Math.hypot(px - x, py - y);
			if (d < f1) {
				f2 = f1;
				f1 = d;
				id = hash(cx, cy, 3);
			} else if (d < f2) f2 = d;
		}
	return { f1, f2, id };
}

/**
 * Two surface coordinates for patterns that lie on faces (bricks, tiles,
 * planks): the plane across the surface's dominant direction, with the
 * vertical kept as the second axis on walls.
 */
function faceUV(l: V3, n: V3): [number, number] {
	const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
	if (ay >= ax && ay >= az) return [l[0], l[2]]; // floors and roofs
	return ax > az ? [l[2], l[1]] : [l[0], l[1]]; // walls: along the wall, then up
}

export function samplePreset(kind: PresetKind, l: V3, n: V3, scale: number): PresetSample {
	const s = 1 / scale;
	const [x, y, z] = [l[0] * s, l[1] * s, l[2] * s];
	switch (kind) {
		case 'wood': {
			// growth rings around the part's own Y axis, wobbled by noise
			const r = Math.hypot(x, z) + fbm3(x * 0.6, y * 0.15, z * 0.6) * 1.2;
			const ring = frac(r);
			const grain = smooth(0.55, 0.95, ring);
			return { mix: grain * 0.8 + noise3(x * 4, y * 0.3, z * 4) * 0.15, height: 1 - grain * 0.4, rough: null, metal: null };
		}
		case 'planks': {
			const [u, v] = faceUV(l, n);
			const row = Math.floor(v * s);
			const along = u * s * 0.25 + hash(row, 7) * 3; // boards four widths long, staggered
			const gapV = Math.min(frac(v * s), 1 - frac(v * s));
			const gapU = Math.min(frac(along), 1 - frac(along));
			const gap = Math.min(smooth(0, 0.05, gapV), smooth(0, 0.02, gapU));
			const tone = hash(row, Math.floor(along));
			const grain = noise3(u * s * 12, v * s * 1.5 + row * 3.1, 0.5) * 0.3;
			return { mix: Math.max(1 - gap, grain), height: gap, rough: null, metal: null, shade: 0.85 + tone * 0.25 };
		}
		case 'brick': {
			const [u, v] = faceUV(l, n);
			const bh = 0.4; // brick height relative to length
			const row = Math.floor(v * s / bh);
			const off = row % 2 ? 0.5 : 0;
			const fu = frac(u * s + off), fv = frac((v * s) / bh);
			const mortar = 1 - Math.min(smooth(0, 0.06, Math.min(fu, 1 - fu)), smooth(0, 0.12, Math.min(fv, 1 - fv)));
			// base = brick, accent = mortar; each brick a little darker or lighter than the next
			const tone = hash(row, Math.floor(u * s + off));
			return { mix: mortar, height: 1 - mortar, rough: null, metal: null, shade: 0.82 + tone * 0.3 };
		}
		case 'stone':
		case 'cobbles': {
			const [u, v] = faceUV(l, n);
			const w = worley(u * s, v * s);
			const edge = w.f2 - w.f1;
			const joint = 1 - smooth(0.02, kind === 'cobbles' ? 0.18 : 0.1, edge);
			const dome = kind === 'cobbles' ? Math.max(0, 1 - w.f1 * 1.4) : 0.8 + noise3(u * s * 3, v * s * 3, w.id * 10) * 0.2;
			return { mix: joint, height: (1 - joint) * dome, rough: null, metal: null, shade: 0.8 + w.id * 0.35 };
		}
		case 'tiles': {
			const [u, v] = faceUV(l, n);
			const fu = frac(u * s), fv = frac(v * s);
			const grout = 1 - Math.min(smooth(0, 0.05, Math.min(fu, 1 - fu)), smooth(0, 0.05, Math.min(fv, 1 - fv)));
			return { mix: grout, height: 1 - grout, rough: grout > 0.5 ? 0.9 : 0.2, metal: null };
		}
		case 'metal': {
			// brushed along the part's X
			const streak = noise3(x * 0.3, y * 30, z * 30);
			return { mix: streak * 0.25, height: 0.5 + streak * 0.1, rough: 0.28 + streak * 0.15, metal: 1 };
		}
		case 'rust': {
			const blotch = smooth(0.45, 0.6, fbm3(x, y, z));
			return { mix: blotch, height: 0.5 + blotch * 0.3 * noise3(x * 8, y * 8, z * 8), rough: 0.35 + blotch * 0.55, metal: 1 - blotch * 0.9 };
		}
		case 'fabric': {
			const [u, v] = faceUV(l, n);
			const warp = Math.sin(u * s * Math.PI * 2), weft = Math.sin(v * s * Math.PI * 2);
			const weave = (warp * weft + 1) / 2;
			return { mix: weave * 0.3, height: weave, rough: 0.95, metal: 0 };
		}
		case 'leather': {
			const w = worley(x + z * 0.7, y + z * 0.3);
			const crease = 1 - smooth(0.02, 0.12, w.f2 - w.f1);
			return { mix: crease * 0.5 + w.id * 0.1, height: 1 - crease * 0.6, rough: 0.6, metal: 0 };
		}
		case 'grass': {
			const patch = smooth(0.55, 0.75, fbm3(x * 0.5, y * 0.5, z * 0.5));
			const blades = noise3(x * 10, y * 3, z * 10);
			return { mix: patch * 0.8, height: blades, rough: 0.95, metal: 0 };
		}
		case 'bark': {
			// ridges running up the part's Y
			const a = Math.atan2(z, x) * 3 + fbm3(x, y * 0.25, z) * 3;
			const ridge = (Math.sin(a * 2) + 1) / 2;
			const cracks = 1 - smooth(0.1, 0.3, ridge);
			return { mix: cracks, height: ridge, rough: 0.95, metal: 0 };
		}
		case 'marble': {
			const vein = Math.abs(Math.sin((x + y * 0.5 + fbm3(x, y, z) * 4) * Math.PI));
			const line = 1 - smooth(0.0, 0.12, vein);
			return { mix: line, height: 0.5, rough: 0.12, metal: 0 };
		}
		case 'sand': {
			const ripple = (Math.sin((x + fbm3(x * 0.3, 0, z * 0.3) * 2) * Math.PI * 2) + 1) / 2;
			const grain = noise3(x * 40, y * 40, z * 40);
			return { mix: ripple * 0.3 + grain * 0.15, height: ripple * 0.7 + grain * 0.3, rough: 1, metal: 0 };
		}
	}
}
