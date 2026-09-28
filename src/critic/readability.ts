/**
 * Readability critics: does the model read at the size and angle a player
 * actually sees it?
 *
 * - neighbouring parts whose colors are meant to differ but blend together
 * - details too small for the game camera (settings.screenHeight)
 * - silhouettes that look the same from the front and the side
 */

import type { Build } from '../core/build.js';
import { rgbToHex, srgbToLinear, type RGB } from '../core/math.js';
import { modelMask, normalize, register } from '../reference.js';
import { renderTiles, type View } from '../render/views.js';
import type { Issue } from './critics.js';

/* ------------------------------------------------------------ color math */

function toLab(c: RGB): [number, number, number] {
	const [r, g, b] = c.map(srgbToLinear);
	const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
	const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
	return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function fromLab([L, a, b]: [number, number, number]): RGB {
	const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
	const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (108 / 841) * (t - 4 / 29));
	const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
	const lin = [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
	return lin.map((v) => {
		const c = Math.max(0, Math.min(1, v));
		return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
	}) as RGB;
}

const luminance = (c: RGB) => {
	const [r, g, b] = c.map(srgbToLinear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (a: RGB, b: RGB) => {
	const la = luminance(a), lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

export const deltaE = (a: RGB, b: RGB) => {
	const p = toLab(a), q = toLab(b);
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/* ---------------------------------------------------- blending colors */

export function colorBlend(b: Build): Issue[] {
	const c = b.compiled;
	const body = b.meshes.find((m) => m.prim < 0);
	if (!body) return [];
	// average color per part from the vertices it owns (patterns included)
	const sum = new Map<number, [number, number, number, number]>();
	for (let v = 0; v < body.vertPrim.length; v++) {
		const s = sum.get(body.vertPrim[v]) ?? [0, 0, 0, 0];
		s[0] += body.colors[v * 3];
		s[1] += body.colors[v * 3 + 1];
		s[2] += body.colors[v * 3 + 2];
		s[3]++;
		sum.set(body.vertPrim[v], s);
	}
	const avg = (p: number): RGB => {
		const s = sum.get(p)!;
		return [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
	};
	// parts that share an edge on the surface, weighted by how long it is
	const border = new Map<string, number>();
	const I = body.indices;
	for (let t = 0; t < I.length; t += 3)
		for (let e = 0; e < 3; e++) {
			const a = body.vertPrim[I[t + e]], z = body.vertPrim[I[t + ((e + 1) % 3)]];
			if (a === z) continue;
			const key = a < z ? `${a}|${z}` : `${z}|${a}`;
			border.set(key, (border.get(key) ?? 0) + 1);
		}
	const out: Issue[] = [];
	const sameBase = (a: number, z: number) => {
		const p = c.prims[a].color, q = c.prims[z].color;
		return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < 1e-3;
	};
	for (const [key, n] of [...border.entries()].sort((x, y) => y[1] - x[1])) {
		if (n < 12) continue;
		const [a, z] = key.split('|').map(Number);
		// same color on purpose (a nose in skin on a head in skin) is one surface by design
		if (sameBase(a, z)) continue;
		const ca = avg(a), cz = avg(z);
		const dE = deltaE(ca, cz), cr = contrastRatio(ca, cz);
		if (dE >= 10 || cr >= 1.35) continue;
		// suggest a lighter or darker version of the smaller part
		const small = (sum.get(a)?.[3] ?? 0) < (sum.get(z)?.[3] ?? 0) ? a : z;
		const other = small === a ? cz : ca;
		const lab = toLab(small === a ? ca : cz);
		const dir = lab[0] >= toLab(other)[0] ? 1 : -1;
		const suggestion = rgbToHex(fromLab([Math.max(5, Math.min(95, lab[0] + dir * 22)), lab[1], lab[2]]));
		out.push({
			severity: 'warn',
			code: 'colors-blend',
			message: `${c.prims[a].id} and ${c.prims[z].id} touch and their colors are too close to tell apart (ΔE ${dE.toFixed(1)}, contrast ${cr.toFixed(2)}:1) — they will read as one blob; try ${suggestion} for ${c.prims[small].id}, or give them the same color on purpose`,
			parts: [c.prims[a].id, c.prims[z].id]
		});
		if (out.length >= 4) break;
	}
	return out;
}

/* ------------------------------------------------ game-camera detail */

export function tinyDetail(b: Build, screenHeight: number): Issue[] {
	const c = b.compiled;
	const views: View[] = ['front', 'left', 'three_quarter'];
	// the tile frames the model at about 1/1.2 of its height
	const size = Math.max(16, Math.round(screenHeight * 1.2));
	const full = renderTiles(b, { views, size: 256, ids: true, ground: false, ssaa: 1 }).tiles;
	const game = renderTiles(b, { views, size, ids: true, ground: false, ssaa: 1 }).tiles;
	const count = (tiles: typeof game) => {
		const best = new Map<number, number>();
		for (const t of tiles) {
			const m = new Map<number, number>();
			for (const id of t.ids!) if (id >= 0) m.set(id, (m.get(id) ?? 0) + 1);
			for (const [id, n] of m) best.set(id, Math.max(best.get(id) ?? 0, n));
		}
		return best;
	};
	const seenFull = count(full), seenGame = count(game);
	const out: Issue[] = [];
	for (const [id, n] of seenFull) {
		const pr = c.prims[id];
		if (!pr || n < 30) continue;
		const g = seenGame.get(id) ?? 0;
		if (g >= 4) continue;
		out.push({
			severity: 'warn',
			code: 'tiny-detail',
			message: g
				? `${pr.id} covers at most ${g} px when the model is ${screenHeight} px tall — a player will not see it; make it bigger or bolder, or drop it and save the triangles`
				: `${pr.id} disappears entirely when the model is ${screenHeight} px tall — make it bigger or bolder, or drop it`,
			parts: [pr.id]
		});
	}
	return out.slice(0, 6);
}

/* ------------------------------------------ same silhouette everywhere */

export function sameSilhouette(b: Build): Issue[] {
	const iou = (p: View, q: View) => {
		const a = normalize(modelMask(b, p, 128, 1), 100, 2250);
		const r = register(a, normalize(modelMask(b, q, 128, 1), 100, 2250));
		let i = 0, u = 0;
		for (let k = 0; k < a.on.length; k++) {
			if (a.on[k] && r.on[k]) i++;
			if (a.on[k] || r.on[k]) u++;
		}
		return u ? i / u : 0;
	};
	const fs = iou('front', 'left');
	if (fs < 0.93) return [];
	// things that walk, swim or fly turn in front of the player; round props are fine
	const creature = b.compiled.prims.some((p) => ['leg', 'tail', 'wing'].includes(p.role));
	return [{
		severity: creature ? 'warn' : 'info',
		code: 'same-silhouette',
		message: `the front and side silhouettes are nearly the same (overlap ${fs.toFixed(2)}) — the model will read the same as it turns${creature ? '; give it depth from the side: a snout or nose, a tail, a backpack, feet that point forward' : ' (fine for round props)'}`
	}];
}
