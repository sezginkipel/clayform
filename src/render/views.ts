/**
 * Named views, auto-framing and labelled contact sheets.
 */

import type { Build } from '../core/build.js';
import { norm, type RGB, type V3 } from '../core/math.js';
import { drawText, GLYPH_H, textWidth } from './font.js';
import { encodePng } from './png.js';
import { rasterize, type Camera, type Drawable, type Image, type RenderMode, type Shade } from './raster.js';

export const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'three_quarter', 'three_quarter_back'] as const;
export type View = (typeof VIEWS)[number] | { yaw: number; pitch: number };

export const DEFAULT_VIEWS: View[] = ['front', 'left', 'top', 'three_quarter'];

export function viewName(v: View): string {
	return typeof v === 'string' ? v : `yaw ${Math.round(v.yaw)} pitch ${Math.round(v.pitch)}`;
}

export interface Bounds {
	min: V3;
	max: V3;
}

export function cameraFor(view: View, b: Bounds, aspect = 1): Camera {
	const c: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
	const ex = b.max[0] - b.min[0], ey = b.max[1] - b.min[1], ez = b.max[2] - b.min[2];
	const R = Math.max(1e-3, Math.hypot(ex, ey, ez) / 2);
	const ortho = (dir: V3, w: number, h: number, up: V3 = [0, 1, 0]): Camera => ({
		eye: [c[0] + dir[0] * R * 4, c[1] + dir[1] * R * 4, c[2] + dir[2] * R * 4],
		target: c,
		up,
		ortho: true,
		fov: 30,
		halfHeight: Math.max(h / 2, w / 2 / aspect) * 1.2 + 1e-3
	});
	const persp = (dir: V3): Camera => {
		const d = norm(dir);
		const fov = 30;
		const dist = (R / Math.sin((fov * Math.PI) / 360)) * 1.02;
		return { eye: [c[0] + d[0] * dist, c[1] + d[1] * dist, c[2] + d[2] * dist], target: c, up: [0, 1, 0], ortho: false, fov, halfHeight: 1 };
	};
	if (typeof view !== 'string') {
		const yaw = (view.yaw * Math.PI) / 180, pitch = (view.pitch * Math.PI) / 180;
		return persp([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]);
	}
	switch (view) {
		case 'front': return ortho([0, 0, 1], ex, ey);
		case 'back': return ortho([0, 0, -1], ex, ey);
		case 'left': return ortho([1, 0, 0], ez, ey);
		case 'right': return ortho([-1, 0, 0], ez, ey);
		case 'top': return ortho([0, 1, 0], ex, ez, [0, 0, -1]);
		case 'bottom': return ortho([0, -1, 0], ex, ez, [0, 0, 1]);
		case 'three_quarter': return persp([0.8, 0.55, 1]);
		case 'three_quarter_back': return persp([-0.8, 0.5, -1]);
	}
}

/** Distinct, readable colors for the parts view. */
export function partColor(i: number): RGB {
	const h = (i * 0.618034 + 0.11) % 1;
	const s = 0.62, l = i % 2 ? 0.58 : 0.46;
	const f = (n: number) => {
		const k = (n + h * 12) % 12;
		return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
	};
	return [f(0), f(8), f(4)];
}

function niceStep(size: number): number {
	const raw = size / 5;
	const p = Math.pow(10, Math.floor(Math.log10(raw)));
	const m = raw / p;
	return (m < 1.5 ? 1 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p;
}

export interface SheetOptions {
	views?: View[];
	mode?: RenderMode;
	/** tile size in px */
	size?: number;
	ground?: boolean;
	labels?: boolean;
	/** override geometry (posed frames) */
	draws?: Drawable[];
	/** override the framing bounds (e.g. whole animation) */
	bounds?: Bounds;
	title?: string;
	/** return per-pixel part ids with each tile */
	ids?: boolean;
}

export interface Sheet {
	png: Uint8Array;
	width: number;
	height: number;
	legend: { index: number; id: string; color: string }[];
	views: string[];
}

export function shadesOf(b: Build): Shade[] {
	return b.compiled.prims.map((p) => ({ roughness: p.roughness, metalness: p.metalness, emissive: p.emissive, emissiveStrength: p.emissiveStrength }));
}

export function renderTiles(b: Build, o: SheetOptions = {}): { tiles: Image[]; names: string[] } {
	const views = o.views?.length ? o.views : DEFAULT_VIEWS;
	const size = o.size ?? 384;
	const draws = o.draws ?? b.meshes;
	const bounds = o.bounds ?? { min: b.min, max: b.max };
	const shades = shadesOf(b);
	const ex = bounds.max[0] - bounds.min[0], ez = bounds.max[2] - bounds.min[2], ey = bounds.max[1] - bounds.min[1];
	const foot = Math.max(ex, ez, ey * 0.6, 1e-3);
	const tiles = views.map((v) =>
		rasterize(draws, shades, cameraFor(v, bounds), {
			width: size,
			height: size,
			mode: o.mode ?? 'shaded',
			ground: o.ground ?? true,
			groundY: b.offset[1] !== 0 || b.compiled.scene.settings?.ground !== 'none' ? 0 : bounds.min[1],
			gridStep: niceStep(Math.max(ex, ey, ez)),
			groundRadius: foot * 1.6,
			groundCenter: [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[2] + bounds.max[2]) / 2],
			shadow: true,
			ssaa: 2,
			partColors: (i) => partColor(i),
			ids: o.ids
		})
	);
	return { tiles, names: views.map(viewName) };
}

const hex = (c: RGB) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');

/** Compose tiles into one labelled PNG. */
export function renderSheet(b: Build, o: SheetOptions = {}): Sheet {
	const { tiles, names } = renderTiles(b, o);
	const size = tiles[0]?.width ?? 384;
	const n = tiles.length;
	const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
	const rows = Math.ceil(n / cols);
	const gap = 4;
	const legend = o.mode === 'parts' ? legendFor(b) : [];
	const lineH = GLYPH_H * 2 + 6;
	const legendW = legend.length ? Math.max(...legend.map((l) => textWidth(l.id, 2))) + 44 : 0;
	const legendCols = legend.length ? Math.max(1, Math.ceil((legend.length * lineH) / (rows * size + (rows - 1) * gap - 12))) : 0;
	const W = cols * size + (cols - 1) * gap + legendCols * legendW;
	const H = rows * size + (rows - 1) * gap;
	const buf = new Uint8Array(W * H * 4);
	for (let i = 0; i < W * H; i++) {
		buf[i * 4] = 250; buf[i * 4 + 1] = 250; buf[i * 4 + 2] = 248; buf[i * 4 + 3] = 255;
	}
	tiles.forEach((t, i) => {
		const ox = (i % cols) * (size + gap), oy = Math.floor(i / cols) * (size + gap);
		for (let y = 0; y < t.height; y++) buf.set(t.data.subarray(y * t.width * 4, (y + 1) * t.width * 4), ((oy + y) * W + ox) * 4);
		if (o.labels !== false) drawText(buf, W, H, ox + 8, oy + 8, names[i], [70, 70, 76], 2);
	});
	if (o.title) drawText(buf, W, H, 8, H - GLYPH_H * 2 - 8, o.title, [70, 70, 76], 2);
	if (legend.length) {
		const x0 = cols * size + (cols - 1) * gap + 10;
		const perCol = Math.max(1, Math.floor((H - 12) / lineH));
		legend.forEach((l, i) => {
			const cx = x0 + Math.floor(i / perCol) * legendW, cy = 8 + (i % perCol) * lineH;
			const rgb = l.rgb.map((x) => Math.round(x * 255)) as [number, number, number];
			for (let y = 0; y < 14; y++) for (let x = 0; x < 20; x++) {
				const q = ((cy + y) * W + cx + x) * 4;
				if (cy + y >= H) continue;
				buf[q] = rgb[0]; buf[q + 1] = rgb[1]; buf[q + 2] = rgb[2];
			}
			drawText(buf, W, H, cx + 26, cy, l.id, [40, 40, 44], 2);
		});
	}
	return {
		png: encodePng(buf, W, H),
		width: W,
		height: H,
		legend: legend.map((l) => ({ index: l.index, id: l.id, color: hex(l.rgb) })),
		views: names
	};
}

function legendFor(b: Build) {
	const seen = new Set<number>();
	for (const m of b.meshes) for (const p of m.triPrim) seen.add(p);
	return [...seen].sort((a, c) => a - c).map((i) => ({ index: i, id: b.compiled.prims[i]?.id ?? String(i), rgb: partColor(i) }));
}

export function tileToPng(t: Image): Uint8Array {
	return encodePng(t.data, t.width, t.height);
}
