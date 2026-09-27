/**
 * Effects: declarative particle emitters baked to flipbooks.
 *
 * Particles follow a closed-form path (linear drag + gravity), so any frame
 * can be evaluated directly and a looping effect is exactly periodic: each
 * particle is emitted at a fixed phase of the loop and its age is taken
 * modulo the loop length. The result is a sprite sheet + JSON any engine
 * can play, and a labelled preview strip the agent can look at.
 */

import { clamp, hexToRgb, rng, type RGB, type V3 } from '../core/math.js';
import type { Effect, Scene } from '../core/schema.js';
import { resolveColor } from '../core/compile.js';
import { encodePng } from '../render/png.js';
import { drawText } from '../render/font.js';

export interface ResolvedEffect {
	id: string;
	count: number;
	lifetime: [number, number];
	speed: [number, number];
	direction: V3;
	spread: number;
	gravity: number;
	drag: number;
	size: [number, number];
	colors: RGB[];
	alpha: [number, number];
	emitter: { shape: 'point' | 'sphere' | 'disc' | 'box'; size: number };
	blend: 'additive' | 'alpha';
	burst: boolean;
	duration: number;
	frames: number;
	tile: number;
	seed: number;
	stretch: number;
	loop: boolean;
}

type Preset = Omit<ResolvedEffect, 'id' | 'colors' | 'frames' | 'tile' | 'seed' | 'loop'> & { colors: string[] };

export const PRESETS: Record<string, Preset> = {
	fire: { count: 110, lifetime: [0.45, 0.95], speed: [0.35, 0.8], direction: [0, 1, 0], spread: 16, gravity: -1.4, drag: 0.9, size: [0.14, 0.03], colors: ['#ffe7a0', '#ffb43a', '#ff5f1c', '#7a200e'], alpha: [0.45, 0], emitter: { shape: 'disc', size: 0.12 }, blend: 'additive', burst: false, duration: 1, stretch: 0 },
	smoke: { count: 55, lifetime: [1.6, 2.6], speed: [0.2, 0.4], direction: [0, 1, 0], spread: 18, gravity: -0.35, drag: 0.5, size: [0.14, 0.6], colors: ['#5f5f62', '#8e8e90', '#c4c4c4'], alpha: [0.5, 0], emitter: { shape: 'disc', size: 0.1 }, blend: 'alpha', burst: false, duration: 2, stretch: 0 },
	sparks: { count: 110, lifetime: [0.3, 0.8], speed: [1.6, 3.4], direction: [0, 1, 0], spread: 55, gravity: 6, drag: 0.3, size: [0.028, 0.01], colors: ['#fffbe2', '#ffd35a', '#ff7b1c'], alpha: [1, 0], emitter: { shape: 'point', size: 0 }, blend: 'additive', burst: false, duration: 1, stretch: 0.045 },
	magic: { count: 140, lifetime: [0.8, 1.6], speed: [0.15, 0.55], direction: [0, 1, 0], spread: 180, gravity: -0.6, drag: 1.2, size: [0.07, 0], colors: ['#f1ecff', '#a887ff', '#56d5ff'], alpha: [1, 0], emitter: { shape: 'sphere', size: 0.25 }, blend: 'additive', burst: false, duration: 1.5, stretch: 0 },
	explosion: { count: 260, lifetime: [0.4, 1.1], speed: [1.4, 4], direction: [0, 1, 0], spread: 180, gravity: 1.4, drag: 2.6, size: [0.24, 0.55], colors: ['#fffbe8', '#ffc542', '#ff6a1f', '#5c2c1b', '#3b3b3b'], alpha: [1, 0], emitter: { shape: 'sphere', size: 0.1 }, blend: 'additive', burst: true, duration: 1.2, stretch: 0 },
	dust: { count: 50, lifetime: [0.8, 1.4], speed: [0.3, 0.8], direction: [0, 1, 0], spread: 75, gravity: 0.8, drag: 2, size: [0.08, 0.3], colors: ['#b39c7c', '#d6c5aa'], alpha: [0.6, 0], emitter: { shape: 'disc', size: 0.2 }, blend: 'alpha', burst: false, duration: 1.2, stretch: 0 },
	snow: { count: 200, lifetime: [2.8, 3.6], speed: [0.1, 0.3], direction: [0, -1, 0], spread: 25, gravity: 0.25, drag: 1.5, size: [0.03, 0.03], colors: ['#ffffff', '#e8f2ff'], alpha: [1, 0.7], emitter: { shape: 'box', size: 2 }, blend: 'alpha', burst: false, duration: 3, stretch: 0 },
	rain: { count: 300, lifetime: [0.55, 0.75], speed: [5, 6], direction: [0, -1, 0], spread: 3, gravity: 9.8, drag: 0, size: [0.012, 0.012], colors: ['#cfe3ff'], alpha: [0.6, 0.6], emitter: { shape: 'box', size: 2 }, blend: 'alpha', burst: false, duration: 1, stretch: 0.03 },
	bubbles: { count: 60, lifetime: [1.5, 2.5], speed: [0.2, 0.4], direction: [0, 1, 0], spread: 15, gravity: -0.4, drag: 0.5, size: [0.03, 0.08], colors: ['#dcf7ff', '#a8e6ff'], alpha: [0.75, 0], emitter: { shape: 'disc', size: 0.15 }, blend: 'alpha', burst: false, duration: 2, stretch: 0 },
	heal: { count: 90, lifetime: [1, 1.6], speed: [0.2, 0.5], direction: [0, 1, 0], spread: 10, gravity: -0.8, drag: 0.8, size: [0.07, 0.02], colors: ['#ecffec', '#6ee37a', '#2fb85a'], alpha: [1, 0], emitter: { shape: 'disc', size: 0.35 }, blend: 'additive', burst: false, duration: 1.5, stretch: 0 }
};

export function resolveEffect(scene: Scene, e: Effect): ResolvedEffect {
	const p = PRESETS[e.preset ?? 'magic'];
	const burst = e.burst ?? p.burst;
	return {
		id: e.id,
		count: e.count ?? p.count,
		lifetime: (e.lifetime as [number, number]) ?? p.lifetime,
		speed: (e.speed as [number, number]) ?? p.speed,
		direction: (e.direction as V3) ?? p.direction,
		spread: e.spread ?? p.spread,
		gravity: e.gravity ?? p.gravity,
		drag: e.drag ?? p.drag,
		size: (e.size as [number, number]) ?? p.size,
		colors: (e.colors ?? p.colors).map((c) => (c.startsWith('#') ? hexToRgb(c) : resolveColor(scene, c))),
		alpha: (e.alpha as [number, number]) ?? p.alpha,
		emitter: { shape: e.emitter?.shape ?? p.emitter.shape, size: e.emitter?.size ?? p.emitter.size },
		blend: e.blend ?? p.blend,
		burst,
		duration: e.duration ?? p.duration,
		frames: e.frames ?? 16,
		tile: e.tile ?? 128,
		seed: e.seed ?? 7,
		stretch: p.stretch,
		loop: !burst
	};
}

interface Particle {
	emit: number;
	life: number;
	p0: V3;
	v0: V3;
	size0: number;
	size1: number;
	hue: number;
}

function spawn(e: ResolvedEffect): Particle[] {
	const r = rng(e.seed);
	const out: Particle[] = [];
	const d = e.direction;
	const dl = Math.hypot(d[0], d[1], d[2]) || 1;
	const dir: V3 = [d[0] / dl, d[1] / dl, d[2] / dl];
	// orthonormal basis around dir
	const up: V3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	const t1: V3 = [up[1] * dir[2] - up[2] * dir[1], up[2] * dir[0] - up[0] * dir[2], up[0] * dir[1] - up[1] * dir[0]];
	const t1l = Math.hypot(...t1);
	t1[0] /= t1l; t1[1] /= t1l; t1[2] /= t1l;
	const t2: V3 = [dir[1] * t1[2] - dir[2] * t1[1], dir[2] * t1[0] - dir[0] * t1[2], dir[0] * t1[1] - dir[1] * t1[0]];
	const maxLife = e.lifetime[1];
	// total particles over the loop so that ~count are alive at once
	const meanLife = (e.lifetime[0] + e.lifetime[1]) / 2;
	const total = e.burst ? e.count : Math.max(1, Math.round((e.count * e.duration) / Math.min(meanLife, Math.max(e.duration, meanLife))));
	for (let i = 0; i < total; i++) {
		const emit = e.burst ? r() * 0.04 : (i / total) * e.duration;
		const life = e.lifetime[0] + (e.lifetime[1] - e.lifetime[0]) * r();
		// emitter position
		let p0: V3 = [0, 0, 0];
		const s = e.emitter.size;
		if (e.emitter.shape === 'sphere') {
			const u = r() * 2 - 1, th = r() * Math.PI * 2, rr = Math.cbrt(r()) * s;
			const q = Math.sqrt(1 - u * u);
			p0 = [q * Math.cos(th) * rr, u * rr, q * Math.sin(th) * rr];
		} else if (e.emitter.shape === 'disc') {
			const th = r() * Math.PI * 2, rr = Math.sqrt(r()) * s;
			p0 = [Math.cos(th) * rr, 0, Math.sin(th) * rr];
		} else if (e.emitter.shape === 'box') {
			p0 = [(r() - 0.5) * s, dir[1] < -0.5 ? s * 0.6 : 0, (r() - 0.5) * s * 0.25];
		}
		// direction in a cone
		const ca = Math.cos((e.spread * Math.PI) / 180);
		const cz = 1 - r() * (1 - ca);
		const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
		const ph = r() * Math.PI * 2;
		const sp = e.speed[0] + (e.speed[1] - e.speed[0]) * r();
		const vd: V3 = [
			(dir[0] * cz + t1[0] * sz * Math.cos(ph) + t2[0] * sz * Math.sin(ph)) * sp,
			(dir[1] * cz + t1[1] * sz * Math.cos(ph) + t2[1] * sz * Math.sin(ph)) * sp,
			(dir[2] * cz + t1[2] * sz * Math.cos(ph) + t2[2] * sz * Math.sin(ph)) * sp
		];
		const jitter = 0.75 + r() * 0.5;
		out.push({ emit, life: Math.min(life, e.loop ? maxLife : life), p0, v0: vd, size0: e.size[0] * jitter, size1: e.size[1] * jitter, hue: r() });
	}
	return out;
}

function at(e: ResolvedEffect, p: Particle, age: number): { pos: V3; vel: V3 } {
	const k = e.drag, g = e.gravity;
	if (k < 1e-4) {
		return {
			pos: [p.p0[0] + p.v0[0] * age, p.p0[1] + p.v0[1] * age - 0.5 * g * age * age, p.p0[2] + p.v0[2] * age],
			vel: [p.v0[0], p.v0[1] - g * age, p.v0[2]]
		};
	}
	const ek = Math.exp(-k * age);
	const vt = -g / k; // terminal y velocity
	const f = (1 - ek) / k;
	return {
		pos: [p.p0[0] + p.v0[0] * f, p.p0[1] + vt * age + (p.v0[1] - vt) * f, p.p0[2] + p.v0[2] * f],
		vel: [p.v0[0] * ek, vt + (p.v0[1] - vt) * ek, p.v0[2] * ek]
	};
}

interface Sprite {
	x: number;
	y: number;
	z: number;
	r: number;
	color: RGB;
	a: number;
	vx: number;
	vy: number;
}

function gradient(cols: RGB[], t: number): RGB {
	if (cols.length === 1) return cols[0];
	const x = clamp(t, 0, 1) * (cols.length - 1);
	const i = Math.min(cols.length - 2, Math.floor(x));
	const u = x - i;
	return [cols[i][0] + (cols[i + 1][0] - cols[i][0]) * u, cols[i][1] + (cols[i + 1][1] - cols[i][1]) * u, cols[i][2] + (cols[i + 1][2] - cols[i][2]) * u];
}

function spritesAt(e: ResolvedEffect, parts: Particle[], t: number): Sprite[] {
	const out: Sprite[] = [];
	for (const p of parts) {
		const ages: number[] = [];
		if (e.loop) {
			let age = (((t - p.emit) % e.duration) + e.duration) % e.duration;
			while (age < p.life) {
				ages.push(age);
				age += e.duration;
			}
		} else {
			const age = t - p.emit;
			if (age >= 0 && age < p.life) ages.push(age);
		}
		for (const age of ages) {
			const u = age / p.life;
			const { pos, vel } = at(e, p, age);
			// fade in quickly to avoid popping
			const fadeIn = clamp(age / Math.min(0.08, p.life * 0.2), 0, 1);
			out.push({
				x: pos[0], y: pos[1], z: pos[2],
				r: Math.max(0.002, p.size0 + (p.size1 - p.size0) * u) / 2,
				color: gradient(e.colors, u * 0.85 + p.hue * 0.15),
				a: clamp(e.alpha[0] + (e.alpha[1] - e.alpha[0]) * u, 0, 1) * fadeIn,
				vx: vel[0], vy: vel[1]
			});
		}
	}
	return out;
}

export interface Flipbook {
	sheet: Uint8Array;
	preview: Uint8Array;
	meta: {
		effect: string;
		frames: number;
		columns: number;
		rows: number;
		tile: number;
		fps: number;
		duration: number;
		loop: boolean;
		blend: 'additive' | 'alpha';
		metersPerTile: number;
		pivot: [number, number];
	};
	stats: { particles: number; peakAlive: number };
}

export function bakeEffect(e: ResolvedEffect): Flipbook {
	const parts = spawn(e);
	const frames = e.frames;
	const times = Array.from({ length: frames }, (_, i) => (e.loop ? (i / frames) * e.duration : (i / Math.max(1, frames - 1)) * e.duration));
	const all = times.map((t) => spritesAt(e, parts, t));
	// frame bounds (front view: x right, y up)
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, peak = 0;
	for (const f of all) {
		peak = Math.max(peak, f.length);
		for (const s of f) {
			minX = Math.min(minX, s.x - s.r); maxX = Math.max(maxX, s.x + s.r);
			minY = Math.min(minY, s.y - s.r); maxY = Math.max(maxY, s.y + s.r);
		}
	}
	if (!isFinite(minX)) { minX = -0.5; maxX = 0.5; minY = 0; maxY = 1; }
	const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
	const span = Math.max(maxX - minX, maxY - minY) * 1.08 + 1e-3;
	const T = e.tile;
	const cols = Math.ceil(Math.sqrt(frames)), rows = Math.ceil(frames / cols);
	const sheet = new Float32Array(cols * T * rows * T * 4);
	const W = cols * T;
	all.forEach((sprites, fi) => {
		const ox = (fi % cols) * T, oy = Math.floor(fi / cols) * T;
		const tile = drawSprites(sprites, e, T, cx, cy, span);
		for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
			const s = (y * T + x) * 4, d = ((oy + y) * W + ox + x) * 4;
			sheet[d] = tile[s]; sheet[d + 1] = tile[s + 1]; sheet[d + 2] = tile[s + 2]; sheet[d + 3] = tile[s + 3];
		}
	});
	const sheetBytes = new Uint8Array(sheet.length);
	// PNG alpha is straight: un-premultiply alpha-blended effects; additive ones keep rgb as-is
	for (let i = 0; i < sheet.length; i += 4) {
		const a = sheet[i + 3];
		const k = e.blend === 'alpha' && a > 1e-4 ? 1 / a : 1;
		for (let c = 0; c < 3; c++) sheetBytes[i + c] = Math.round(clamp(sheet[i + c] * k, 0, 1) * 255);
		sheetBytes[i + 3] = Math.round(clamp(a, 0, 1) * 255);
	}

	// preview: up to 8 frames on a backdrop that suits the blend mode
	const pv = Math.min(8, frames);
	const PT = 160;
	const PW = pv * PT + (pv - 1) * 4;
	const prev = new Uint8Array(PW * PT * 4);
	const bg: RGB = e.blend === 'additive' ? [0.12, 0.12, 0.14] : [0.86, 0.87, 0.88];
	for (let k = 0; k < pv; k++) {
		const fi = Math.round((k / Math.max(1, pv - 1)) * (frames - 1));
		const tile = drawSprites(all[fi], e, PT, cx, cy, span);
		const ox = k * (PT + 4);
		for (let y = 0; y < PT; y++) for (let x = 0; x < PT; x++) {
			const s = (y * PT + x) * 4, d = (y * PW + ox + x) * 4;
			const a = tile[s + 3];
			for (let c = 0; c < 3; c++) {
				const v = e.blend === 'additive' ? bg[c] + tile[s + c] : bg[c] * (1 - a) + tile[s + c];
				prev[d + c] = Math.round(clamp(v, 0, 1) * 255);
			}
			prev[d + 3] = 255;
		}
		drawText(prev, PW, PT, ox + 6, 6, `${times[fi].toFixed(2)}S`, e.blend === 'additive' ? [200, 200, 205] : [60, 60, 66], 1);
	}
	return {
		sheet: encodePng(sheetBytes, W, rows * T),
		preview: encodePng(prev, PW, PT),
		meta: {
			effect: e.id,
			frames,
			columns: cols,
			rows,
			tile: T,
			fps: Math.round(frames / e.duration),
			duration: e.duration,
			loop: e.loop,
			blend: e.blend,
			metersPerTile: +span.toFixed(4),
			pivot: [+((0 - (cx - span / 2)) / span).toFixed(4), +(1 - (0 - (cy - span / 2)) / span).toFixed(4)]
		},
		stats: { particles: parts.length, peakAlive: peak }
	};
}

/** Premultiplied RGBA float tile. Additive: rgb sums, alpha = max channel. */
function drawSprites(sprites: Sprite[], e: ResolvedEffect, T: number, cx: number, cy: number, span: number): Float32Array {
	const buf = new Float32Array(T * T * 4);
	const px = (x: number) => ((x - cx) / span + 0.5) * T;
	const py = (y: number) => (0.5 - (y - cy) / span) * T;
	const list = e.blend === 'alpha' ? sprites.slice().sort((a, b) => a.z - b.z) : sprites;
	for (const s of list) {
		const X = px(s.x), Y = py(s.y);
		const R = Math.max(0.6, (s.r / span) * T);
		// streak along velocity (sparks, rain)
		let sx = 0, sy = 0;
		if (e.stretch > 0) {
			sx = (s.vx * e.stretch / span) * T;
			sy = (-s.vy * e.stretch / span) * T;
		}
		const x0 = Math.max(0, Math.floor(Math.min(X, X - sx) - R - 1)), x1 = Math.min(T - 1, Math.ceil(Math.max(X, X - sx) + R + 1));
		const y0 = Math.max(0, Math.floor(Math.min(Y, Y - sy) - R - 1)), y1 = Math.min(T - 1, Math.ceil(Math.max(Y, Y - sy) + R + 1));
		const l2 = sx * sx + sy * sy;
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				let dx = x + 0.5 - X, dy = y + 0.5 - Y;
				if (l2 > 0) {
					const h = clamp((dx * -sx + dy * -sy) / l2, 0, 1);
					dx += sx * h;
					dy += sy * h;
				}
				const d2 = (dx * dx + dy * dy) / (R * R);
				if (d2 >= 1) continue;
				const f = (1 - d2) * (1 - d2);
				const a = s.a * f;
				const o = (y * T + x) * 4;
				if (e.blend === 'additive') {
					buf[o] += s.color[0] * a;
					buf[o + 1] += s.color[1] * a;
					buf[o + 2] += s.color[2] * a;
					buf[o + 3] = Math.min(1, Math.max(buf[o + 3], buf[o], buf[o + 1], buf[o + 2]));
				} else {
					buf[o] = s.color[0] * a + buf[o] * (1 - a);
					buf[o + 1] = s.color[1] * a + buf[o + 1] * (1 - a);
					buf[o + 2] = s.color[2] * a + buf[o + 2] * (1 - a);
					buf[o + 3] = a + buf[o + 3] * (1 - a);
				}
			}
	}
	return buf;
}
