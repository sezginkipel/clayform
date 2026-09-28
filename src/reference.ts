/**
 * Fit a model to a reference image.
 *
 * Both silhouettes are cropped to their bounds, scaled to the same height and
 * centered, so a sketch at any size or position compares with the model's
 * orthographic view. The result is an IoU score, an overlay (what only the
 * reference has, what only the model has) and sentences that say where the
 * widths differ and which part sits there.
 */

import { readFileSync } from 'node:fs';
import type { Build } from './core/build.js';
import { drawText } from './render/font.js';
import { encodePng } from './render/png.js';
import { decodePng, type Rgba } from './render/pngdecode.js';
import { renderTiles, type View } from './render/views.js';

export interface Mask {
	w: number;
	h: number;
	on: Uint8Array;
	/** prim index per pixel (model masks only) */
	ids?: Int32Array;
}

/** Foreground of a reference: alpha if it has transparency, else "not the border color". */
export function referenceMask(img: Rgba): Mask {
	const { width: w, height: h, data } = img;
	const on = new Uint8Array(w * h);
	let transparent = 0;
	for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] < 128) transparent++;
	if (transparent > w * h * 0.02) {
		for (let i = 0; i < w * h; i++) on[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
		return { w, h, on };
	}
	// background = median color of the border
	const border: number[][] = [];
	for (let x = 0; x < w; x++) border.push([...data.subarray(x * 4, x * 4 + 3)], [...data.subarray(((h - 1) * w + x) * 4, ((h - 1) * w + x) * 4 + 3)]);
	for (let y = 0; y < h; y++) border.push([...data.subarray(y * w * 4, y * w * 4 + 3)], [...data.subarray((y * w + w - 1) * 4, (y * w + w - 1) * 4 + 3)]);
	const med = [0, 1, 2].map((c) => border.map((p) => p[c]).sort((a, b) => a - b)[border.length >> 1]);
	// Background is what is close to that color AND connected to the border, so light areas
	// inside the object (a white belly, a highlight) stay part of it.
	const near = (i: number) => Math.hypot(data[i * 4] - med[0], data[i * 4 + 1] - med[1], data[i * 4 + 2] - med[2]) <= 40;
	const bg = new Uint8Array(w * h);
	const stack: number[] = [];
	const seed = (i: number) => {
		if (!bg[i] && near(i)) {
			bg[i] = 1;
			stack.push(i);
		}
	};
	for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
	for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
	while (stack.length) {
		const i = stack.pop()!;
		const x = i % w, y = (i / w) | 0;
		if (x > 0) seed(i - 1);
		if (x < w - 1) seed(i + 1);
		if (y > 0) seed(i - w);
		if (y < h - 1) seed(i + w);
	}
	for (let i = 0; i < w * h; i++) on[i] = bg[i] ? 0 : 1;
	return { w, h, on };
}

export function modelMask(b: Build, view: View, size = 384, ssaa = 2): Mask {
	const { tiles } = renderTiles(b, { views: [view], size, ids: true, ground: false, ssaa });
	const ids = tiles[0].ids!;
	const on = new Uint8Array(ids.length);
	for (let i = 0; i < ids.length; i++) on[i] = ids[i] >= 0 ? 1 : 0;
	return { w: size, h: size, on, ids };
}

/**
 * Resample so the silhouette covers a fixed area, centered on its centroid,
 * on an S×S canvas. Normalizing by area (not height) keeps a change to one
 * part from shifting every other band: a bigger head does not shrink the legs.
 */
export function normalize(m: Mask, S = 200, area = 9000): Mask {
	let n = 0, sx = 0, sy = 0;
	for (let y = 0; y < m.h; y++)
		for (let x = 0; x < m.w; x++)
			if (m.on[y * m.w + x]) {
				n++;
				sx += x;
				sy += y;
			}
	if (!n) throw new Error('the silhouette is empty — for a reference, use a PNG with a transparent or plain background');
	const k = Math.sqrt(area / n);
	const cx = sx / n, cy = sy / n;
	const on = new Uint8Array(S * S);
	const ids = m.ids ? new Int32Array(S * S).fill(-1) : undefined;
	for (let y = 0; y < S; y++)
		for (let x = 0; x < S; x++) {
			const px = Math.floor(cx + (x + 0.5 - S / 2) / k), py = Math.floor(cy + (y + 0.5 - S / 2) / k);
			if (px < 0 || py < 0 || px >= m.w || py >= m.h) continue;
			on[y * S + x] = m.on[py * m.w + px];
			if (ids) ids[y * S + x] = m.ids![py * m.w + px];
		}
	return { w: S, h: S, on, ids };
}

/**
 * Align the reference to the model by the scale and shift that maximize
 * their overlap. The unchanged majority of the shape then sits on top of
 * itself, and the difference stays where the change is (a bigger head
 * shows up at the head, not as every band shifting).
 */
export function register(model: Mask, ref: Mask): Mask {
	const S = model.w;
	const c = S / 2;
	const sample = (m: Mask, s: number, dx: number, dy: number, x: number, y: number, f = 1) => {
		const px = Math.floor(((x * f + f / 2 - c - dx) / s + c)), py = Math.floor(((y * f + f / 2 - c - dy) / s + c));
		return px >= 0 && py >= 0 && px < m.w && py < m.h ? m.on[py * m.w + px] : 0;
	};
	const score = (s: number, dx: number, dy: number, f: number) => {
		let i = 0, u = 0;
		const n = Math.floor(S / f);
		for (let y = 0; y < n; y++)
			for (let x = 0; x < n; x++) {
				const a = model.on[Math.min(S - 1, y * f + (f >> 1)) * S + Math.min(S - 1, x * f + (f >> 1))];
				const b = sample(ref, s, dx, dy, x, y, f);
				if (a && b) i++;
				if (a || b) u++;
			}
		return u ? i / u : 0;
	};
	let best = { s: 1, dx: 0, dy: 0, v: score(1, 0, 0, 4) };
	for (let s = 0.8; s <= 1.26; s += 0.05)
		for (let dy = -48; dy <= 48; dy += 4)
			for (let dx = -32; dx <= 32; dx += 4) {
				const v = score(s, dx, dy, 4);
				if (v > best.v) best = { s, dx, dy, v };
			}
	const coarse = best;
	best = { ...coarse, v: score(coarse.s, coarse.dx, coarse.dy, 1) };
	for (let s = coarse.s - 0.04; s <= coarse.s + 0.041; s += 0.01)
		for (let dy = coarse.dy - 4; dy <= coarse.dy + 4; dy++)
			for (let dx = coarse.dx - 4; dx <= coarse.dx + 4; dx++) {
				const v = score(s, dx, dy, 1);
				if (v > best.v) best = { s, dx, dy, v };
			}
	const on = new Uint8Array(S * S);
	for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) on[y * S + x] = sample(ref, best.s, best.dx, best.dy, x, y);
	return { w: S, h: S, on };
}

export interface Fit {
	iou: number;
	/** model width/height over reference width/height */
	aspect: number;
	advice: string[];
	overlay: Uint8Array;
}

export function compareSilhouettes(model: Mask, ref: Mask, partName: (prim: number) => string, bands = 16): Fit {
	const H = model.h;
	const W = Math.max(model.w, ref.w);
	const at = (m: Mask, x: number, y: number) => {
		const ox = Math.floor((W - m.w) / 2);
		const sx = x - ox;
		return sx >= 0 && sx < m.w ? m.on[y * m.w + sx] : 0;
	};
	let inter = 0, union = 0;
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const a = at(model, x, y), b = at(ref, x, y);
			if (a && b) inter++;
			if (a || b) union++;
		}
	const iou = union ? inter / union : 0;

	// band-by-band widths over the rows either silhouette covers
	let top = H, bottom = -1;
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++)
			if (at(model, x, y) || at(ref, x, y)) {
				if (y < top) top = y;
				bottom = y;
				break;
			}
	const span = Math.max(1, bottom - top + 1);
	const rowsPer = span / bands;
	const info: { mw: number; rw: number; part: string }[] = [];
	for (let k = 0; k < bands; k++) {
		let mw = 0, rw = 0;
		const count = new Map<number, number>();
		const ya = top + Math.floor(k * rowsPer), yb = top + Math.floor((k + 1) * rowsPer);
		for (let y = ya; y < yb; y++) {
			for (let x = 0; x < model.w; x++)
				if (model.on[y * model.w + x]) {
					mw++;
					const id = model.ids?.[y * model.w + x] ?? -1;
					if (id >= 0) count.set(id, (count.get(id) ?? 0) + 1);
				}
			for (let x = 0; x < ref.w; x++) if (ref.on[y * ref.w + x]) rw++;
		}
		const lead = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
		info.push({ mw: mw / Math.max(1, yb - ya), rw: rw / Math.max(1, yb - ya), part: lead ? partName(lead[0]) : '' });
	}
	// group consecutive bands that differ the same way by more than 12%
	const advice: string[] = [];
	const box = (m: Mask) => {
		let x0 = m.w, x1 = -1, y0 = m.h, y1 = -1;
		for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.on[y * m.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
		return (x1 - x0 + 1) / Math.max(1, y1 - y0 + 1);
	};
	const aspect = box(model) / Math.max(1e-6, box(ref));
	if (Math.abs(aspect - 1) > 0.1) advice.push(`overall the model is ${Math.round(Math.abs(aspect - 1) * 100)}% ${aspect > 1 ? 'wider' : 'narrower'} for its height than the reference`);
	let k = 0;
	const groups: { from: number; to: number; rel: number; parts: Map<string, number> }[] = [];
	while (k < bands) {
		const rel = (info[k].mw - info[k].rw) / Math.max(1, info[k].rw);
		if (Math.abs(rel) <= 0.12 && !(info[k].rw < 1 && info[k].mw >= 1)) {
			k++;
			continue;
		}
		const sign = Math.sign(rel);
		const g = { from: k, to: k, rel: 0, parts: new Map<string, number>() };
		let sum = 0, n = 0;
		while (k < bands) {
			const r = (info[k].mw - info[k].rw) / Math.max(1, info[k].rw);
			if (Math.sign(r) !== sign || (Math.abs(r) <= 0.12 && !(info[k].rw < 1 && info[k].mw >= 1))) break;
			sum += r;
			n++;
			if (info[k].part) g.parts.set(info[k].part, (g.parts.get(info[k].part) ?? 0) + 1);
			g.to = k++;
		}
		g.rel = sum / n;
		groups.push(g);
	}
	groups
		.sort((a, b) => Math.abs(b.rel) * (b.to - b.from + 1) - Math.abs(a.rel) * (a.to - a.from + 1))
		.slice(0, 4)
		.forEach((g) => {
			const from = Math.round((g.from / bands) * 100), to = Math.round(((g.to + 1) / bands) * 100);
			const parts = [...g.parts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 2);
			const where = `at ${from}–${to}% from the top${parts.length ? ` (${parts.join(', ')})` : ''}`;
			if (g.rel < -0.95) advice.push(`${where} the reference has shape the model is missing`);
			else if (!isFinite(g.rel) || g.rel > 3) advice.push(`${where} the model has shape the reference does not`);
			else advice.push(`${where} the model is ${Math.round(Math.abs(g.rel) * 100)}% ${g.rel > 0 ? 'wider' : 'narrower'} than the reference`);
		});
	if (!advice.length) advice.push('the silhouettes agree within 12% in every band');

	// overlay, scaled up for legibility
	const S = 2, OW = W * S, OH = H * S + 22;
	const buf = new Uint8Array(OW * OH * 4).fill(255);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const a = at(model, x, y), b = at(ref, x, y);
			const c = a && b ? [170, 170, 176] : b ? [232, 116, 59] : a ? [59, 110, 232] : [252, 252, 250];
			for (let dy = 0; dy < S; dy++)
				for (let dx = 0; dx < S; dx++) {
					const p = ((y * S + dy) * OW + x * S + dx) * 4;
					buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2];
				}
		}
	drawText(buf, OW, OH, 4, H * S + 6, `IOU ${iou.toFixed(2)}`, [60, 60, 66], 1);
	drawText(buf, OW, OH, 64, H * S + 6, 'REF ONLY', [232, 116, 59], 1);
	drawText(buf, OW, OH, 124, H * S + 6, 'MODEL ONLY', [59, 110, 232], 1);
	return { iou: +iou.toFixed(4), aspect: +aspect.toFixed(3), advice, overlay: encodePng(buf, OW, OH) };
}

export function fitReference(b: Build, image: Uint8Array | string, view: View = 'front'): Fit {
	const bytes = typeof image === 'string' ? new Uint8Array(readFileSync(image)) : image;
	const model = normalize(modelMask(b, view));
	const ref = register(model, normalize(referenceMask(decodePng(bytes))));
	return compareSilhouettes(model, ref, (i) => b.compiled.prims[i]?.id ?? String(i));
}

/** A black-on-white silhouette PNG of the model (useful as a reference for tests and docs). */
export function silhouettePng(b: Build, view: View = 'front', size = 384): Uint8Array {
	const m = modelMask(b, view, size);
	const buf = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		const v = m.on[i] ? 30 : 255;
		buf[i * 4] = buf[i * 4 + 1] = buf[i * 4 + 2] = v;
		buf[i * 4 + 3] = 255;
	}
	return encodePng(buf, size, size);
}
