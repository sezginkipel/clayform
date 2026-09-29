/**
 * Presentation renders: the same software rasterizer with a lighting preset,
 * a shadow map (the model shades itself and casts a soft, exact shadow), a
 * clean floor or a transparent background, and turntables as animated PNG.
 * For a README, a store page or a showcase entry, not for judging shape
 * (use `render` for that: it keeps the grid and the part colors).
 */

import { buildRig, poseMeshes, sampleClip, type SampledClip } from '../anim/rig.js';
import type { Build, MeshData } from '../core/build.js';
import { norm, type RGB, type V3 } from '../core/math.js';
import { encodeApng, encodePng } from './png.js';
import { rasterize, STUDIO, type Camera, type Lighting } from './raster.js';
import { shadesOf } from './views.js';

export const LIGHTS = ['studio', 'sunset', 'overcast', 'night'] as const;
export type LightPreset = (typeof LIGHTS)[number];

export const LIGHTING: Record<LightPreset, Lighting> = {
	studio: { ...STUDIO, softness: 3 },
	// a low warm sun from the side, a cool sky filling the shadows
	sunset: {
		key: norm([0.85, 0.35, 0.4]),
		keyColor: [1.35, 0.92, 0.62],
		fill: norm([-0.6, 0.5, 0.2]),
		fillColor: [0.45, 0.55, 0.85],
		rim: norm([-0.4, 0.3, -0.9]),
		sky: [0.55, 0.52, 0.66],
		groundBounce: [0.38, 0.26, 0.2],
		exposure: 1.3,
		softness: 3,
		bgTop: [0.98, 0.86, 0.72],
		bgBottom: [0.86, 0.66, 0.58]
	},
	// light from everywhere: soft, low contrast, a faint shadow straight down
	overcast: {
		key: norm([0.15, 1, 0.2]),
		keyColor: [0.62, 0.64, 0.66],
		fill: norm([-0.5, 0.6, 0.6]),
		fillColor: [0.7, 0.72, 0.76],
		rim: norm([0, 0.5, -1]),
		sky: [0.86, 0.88, 0.9],
		groundBounce: [0.42, 0.41, 0.4],
		exposure: 1.3,
		softness: 9,
		bgTop: [0.93, 0.94, 0.95],
		bgBottom: [0.82, 0.83, 0.85]
	},
	// moonlight: cool and dim, so glowing parts carry the picture
	night: {
		key: norm([-0.4, 0.8, 0.5]),
		keyColor: [0.45, 0.55, 0.8],
		fill: norm([0.7, 0.3, 0.4]),
		fillColor: [0.2, 0.22, 0.35],
		rim: norm([0.2, 0.4, -0.9]),
		sky: [0.2, 0.24, 0.36],
		groundBounce: [0.08, 0.08, 0.1],
		exposure: 1.2,
		softness: 2.5,
		bgTop: [0.11, 0.13, 0.2],
		bgBottom: [0.05, 0.06, 0.09]
	}
};

export interface BeautyOptions {
	/** pixels (square; default 768) */
	size?: number;
	/** where the camera sits around the model (degrees; default yaw 35, pitch 18) */
	yaw?: number;
	pitch?: number;
	light?: LightPreset;
	/** preset (default, the light's own gradient), transparent, or a color "#rrggbb" */
	background?: 'preset' | 'transparent' | string;
	/** supersampling (default 3) */
	ssaa?: number;
	/** pose the model at a moment of this clip (default: at rest) */
	clip?: string;
	/** seconds into the clip */
	time?: number;
}

export interface TurntableOptions extends BeautyOptions {
	/** frames in one turn (default 36) */
	frames?: number;
	/** seconds per turn (default 4) */
	seconds?: number;
}

function hexColor(s: string): RGB {
	const h = s.replace('#', '');
	const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
	return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as RGB;
}

function boundsOf(sets: MeshData[][]): { min: V3; max: V3 } {
	const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
	for (const ms of sets)
		for (const m of ms)
			for (let i = 0; i < m.positions.length; i += 3)
				for (let a = 0; a < 3; a++) {
					min[a] = Math.min(min[a], m.positions[i + a]);
					max[a] = Math.max(max[a], m.positions[i + a]);
				}
	min[1] = Math.min(min[1], 0);
	return { min, max };
}

/**
 * A perspective camera at (yaw, pitch) that fits a box: its corners fill `fill` of the frame, and
 * the frame is centered on them rather than on the box's middle (a tall model is not left small).
 */
export function fitCamera(bounds: { min: V3; max: V3 }, yaw: number, pitch: number, fill = 0.92, fov = 30): Camera {
	const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
	const dir = norm([Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)]);
	const c: V3 = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
	const corners: V3[] = [];
	for (let i = 0; i < 8; i++) corners.push([i & 1 ? bounds.max[0] : bounds.min[0], i & 2 ? bounds.max[1] : bounds.min[1], i & 4 ? bounds.max[2] : bounds.min[2]]);
	const f: V3 = [-dir[0], -dir[1], -dir[2]];
	const r = norm([f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0]);
	const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
	const tanH = Math.tan((fov * Math.PI) / 360);
	let target = c;
	let dist = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) / (2 * tanH);
	for (let it = 0; it < 4; it++) {
		const eye: V3 = [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist];
		let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity], need = 0;
		for (const k of corners) {
			const d: V3 = [k[0] - eye[0], k[1] - eye[1], k[2] - eye[2]];
			const vz = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
			const sx = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / (vz * tanH), sy = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (vz * tanH);
			lo = [Math.min(lo[0], sx), Math.min(lo[1], sy)];
			hi = [Math.max(hi[0], sx), Math.max(hi[1], sy)];
		}
		// recenter on the corners' projection, then move in or out until they span `fill` of the frame
		const mx = (lo[0] + hi[0]) / 2, my = (lo[1] + hi[1]) / 2;
		const shift = dist * tanH;
		target = [target[0] + (r[0] * mx + u[0] * my) * shift, target[1] + (r[1] * mx + u[1] * my) * shift, target[2] + (r[2] * mx + u[2] * my) * shift];
		need = Math.max(hi[0] - lo[0], hi[1] - lo[1]) / 2;
		dist *= need / fill;
	}
	return { eye: [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist], target, up: [0, 1, 0], ortho: false, fov, halfHeight: 1 };
}

function frame(b: Build, draws: MeshData[], bounds: { min: V3; max: V3 }, yaw: number, o: BeautyOptions, fixed?: Camera): Uint8Array {
	const size = o.size ?? 768;
	const L = LIGHTING[o.light ?? 'studio'];
	const bg = o.background && o.background !== 'preset' ? (o.background === 'transparent' ? 'transparent' : hexColor(o.background)) : 'gradient';
	// a little room around the model, and the floor well past its shadow
	const ex = bounds.max[0] - bounds.min[0], ez = bounds.max[2] - bounds.min[2], ey = bounds.max[1] - bounds.min[1];
	const pad = Math.max(ex, ey, ez) * 0.06;
	const framed = { min: [bounds.min[0] - pad, bounds.min[1], bounds.min[2] - pad] as V3, max: [bounds.max[0] + pad, bounds.max[1] + pad, bounds.max[2] + pad] as V3 };
	const cam = fixed ?? fitCamera(framed, yaw, o.pitch ?? 18);
	const img = rasterize(draws, shadesOf(b), cam, {
		width: size,
		height: size,
		mode: 'shaded',
		ground: true,
		groundY: b.offset[1] !== 0 || b.compiled.scene.settings?.ground !== 'none' ? 0 : bounds.min[1],
		gridStep: 1,
		grid: false,
		groundRadius: Math.max(ex, ez, ey) * 3,
		groundCenter: [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[2] + bounds.max[2]) / 2],
		shadow: true,
		softShadows: true,
		ssaa: o.ssaa ?? 3,
		light: L,
		background: bg
	});
	return img.data;
}

function posedAt(b: Build, clipId: string | undefined, time: number | undefined): { draws: MeshData[]; clip: SampledClip | null } {
	if (!clipId) return { draws: b.meshes, clip: null };
	const def = b.compiled.scene.clips?.find((c) => c.id === clipId);
	if (!def) throw new Error(`no clip "${clipId}"${b.compiled.scene.clips?.length ? ` — clips: ${b.compiled.scene.clips.map((c) => c.id).join(', ')}` : ''}`);
	const rig = buildRig(b);
	const clip = sampleClip(b, rig, def);
	const f = Math.round(Math.max(0, Math.min(1, (time ?? clip.duration * 0.25) / clip.duration)) * (clip.times.length - 1));
	return { draws: poseMeshes(b, rig, clip, f), clip };
}

/** One presentation still as a PNG. */
export function renderBeauty(b: Build, o: BeautyOptions = {}): { png: Uint8Array; width: number; height: number } {
	const { draws } = posedAt(b, o.clip, o.time);
	const size = o.size ?? 768;
	const data = frame(b, draws, boundsOf([draws]), o.yaw ?? 35, o);
	return { png: encodePng(data, size, size), width: size, height: size };
}

/**
 * A full turn around the model as an animated PNG. With a clip, the model
 * plays it while the camera turns (loops repeat to fill the turn).
 */
export function renderTurntable(b: Build, o: TurntableOptions = {}): { png: Uint8Array; width: number; height: number; frames: number; delay: number } {
	const n = Math.max(4, Math.min(120, o.frames ?? 36));
	const seconds = o.seconds ?? 4;
	const size = o.size ?? 512;
	let poses: MeshData[][] = Array.from({ length: n }, () => b.meshes);
	if (o.clip) {
		const def = b.compiled.scene.clips?.find((c) => c.id === o.clip);
		if (!def) throw new Error(`no clip "${o.clip}"`);
		const rig = buildRig(b);
		const clip = sampleClip(b, rig, def);
		poses = Array.from({ length: n }, (_, i) => {
			const t = ((i / n) * seconds) % clip.duration;
			return poseMeshes(b, rig, clip, Math.round((t / clip.duration) * (clip.times.length - 1)));
		});
	}
	// one framing for every frame, wide enough for the whole turn, so the model does not breathe in and out
	const bounds = boundsOf(poses);
	const cx = (bounds.min[0] + bounds.max[0]) / 2, cz = (bounds.min[2] + bounds.max[2]) / 2;
	const rr = Math.max(bounds.max[0] - cx, cx - bounds.min[0], bounds.max[2] - cz, cz - bounds.min[2]) * Math.SQRT2;
	const round = { min: [cx - rr, bounds.min[1], cz - rr] as V3, max: [cx + rr, bounds.max[1], cz + rr] as V3 };
	// the farthest fit of the turn, with the same height for every frame
	const yawAt = (i: number) => (o.yaw ?? 35) + (360 * i) / n;
	const cams = poses.map((_, i) => fitCamera(round, yawAt(i), o.pitch ?? 18, 0.8));
	const far = Math.max(...cams.map((c) => Math.hypot(c.eye[0] - c.target[0], c.eye[1] - c.target[1], c.eye[2] - c.target[2])));
	const ty = cams.reduce((s, c) => s + c.target[1], 0) / cams.length;
	const frames = poses.map((ms, i) => {
		const y = (yawAt(i) * Math.PI) / 180, p = ((o.pitch ?? 18) * Math.PI) / 180;
		const d = norm([Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)]);
		const target: V3 = [cx, ty, cz];
		const cam: Camera = { eye: [target[0] + d[0] * far, target[1] + d[1] * far, target[2] + d[2] * far], target, up: [0, 1, 0], ortho: false, fov: 30, halfHeight: 1 };
		return frame(b, ms, bounds, yawAt(i), { ...o, size }, cam);
	});
	const delay = (seconds * 1000) / n;
	return { png: encodeApng(frames, size, size, delay), width: size, height: size, frames: n, delay };
}
