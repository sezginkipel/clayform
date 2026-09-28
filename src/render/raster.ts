/**
 * A small deferred software rasterizer. No GPU, no browser: the agent's eye
 * works the same on a laptop, a CI runner or a server.
 *
 * Pass 1 rasterizes triangle ids + barycentrics with a depth test.
 * Pass 2 shades each pixel once: mesh, or an analytic ground plane with a
 * projected key shadow and a soft contact shadow (so floating is visible).
 */

import { clamp, cross, dot, linearToSrgb, norm, srgbToLinear, sub, type RGB, type V3 } from '../core/math.js';

export interface Drawable {
	positions: Float32Array;
	normals: Float32Array;
	colors: Float32Array;
	ao: Float32Array;
	indices: Uint32Array;
	triPrim: Int32Array;
}

export interface Shade {
	roughness: number;
	metalness: number;
	emissive: RGB | null;
	emissiveStrength: number;
}

export interface Camera {
	eye: V3;
	target: V3;
	up: V3;
	ortho: boolean;
	/** vertical field of view, degrees (perspective) */
	fov: number;
	/** half of the visible height in meters (orthographic) */
	halfHeight: number;
}

export type RenderMode = 'shaded' | 'parts' | 'normals' | 'depth' | 'clay';

export interface RasterOptions {
	width: number;
	height: number;
	mode: RenderMode;
	ground: boolean;
	groundY: number;
	/** meters; grid spacing on the ground */
	gridStep: number;
	/** ground disc radius around `groundCenter` */
	groundRadius: number;
	groundCenter: [number, number];
	shadow: boolean;
	ssaa: number;
	partColors?: (prim: number) => RGB;
	/** also return the part (prim index) seen at each output pixel, -1 for none */
	ids?: boolean;
}

export interface Image {
	width: number;
	height: number;
	data: Uint8Array;
	/** prim index per output pixel (when requested), -1 = background */
	ids?: Int32Array;
}

const KEY: V3 = norm([0.5, 0.85, 0.6]);
const FILL: V3 = norm([-0.7, 0.35, 0.3]);
const RIM: V3 = norm([-0.2, 0.5, -0.9]);

export function rasterize(draws: Drawable[], shades: Shade[], cam: Camera, o: RasterOptions): Image {
	const s = Math.max(1, Math.round(o.ssaa));
	const W = o.width * s, H = o.height * s;
	const N = W * H;
	const depth = new Float32Array(N).fill(Infinity);
	const triId = new Int32Array(N).fill(-1);
	const drawId = new Int8Array(N).fill(-1);
	const bary = new Float32Array(N * 2);

	const f = norm(sub(cam.target, cam.eye));
	const r = norm(cross(f, cam.up));
	const u = cross(r, f);
	const aspect = W / H;
	const tanH = Math.tan((cam.fov * Math.PI) / 360);

	const project = (x: number, y: number, z: number, out: Float64Array, o3: number) => {
		const dx = x - cam.eye[0], dy = y - cam.eye[1], dz = z - cam.eye[2];
		const vx = dx * r[0] + dy * r[1] + dz * r[2];
		const vy = dx * u[0] + dy * u[1] + dz * u[2];
		const vz = dx * f[0] + dy * f[1] + dz * f[2];
		let sx: number, sy: number;
		if (cam.ortho) {
			sx = vx / (cam.halfHeight * aspect);
			sy = vy / cam.halfHeight;
		} else {
			sx = vx / (vz * tanH * aspect);
			sy = vy / (vz * tanH);
		}
		out[o3] = (sx * 0.5 + 0.5) * W;
		out[o3 + 1] = (0.5 - sy * 0.5) * H;
		out[o3 + 2] = vz;
	};

	/* ------------------------------------------------ pass 1: visibility */
	draws.forEach((d, di) => {
		const nv = d.positions.length / 3;
		const sp = new Float64Array(nv * 3);
		for (let v = 0; v < nv; v++) project(d.positions[v * 3], d.positions[v * 3 + 1], d.positions[v * 3 + 2], sp, v * 3);
		const idx = d.indices;
		for (let t = 0; t < idx.length; t += 3) {
			const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
			const z0 = sp[a + 2], z1 = sp[b + 2], z2 = sp[c + 2];
			if (!cam.ortho && (z0 <= 1e-4 || z1 <= 1e-4 || z2 <= 1e-4)) continue;
			const x0 = sp[a], y0 = sp[a + 1], x1 = sp[b], y1 = sp[b + 1], x2 = sp[c], y2 = sp[c + 1];
			const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
			if (area >= 0) continue; // back face (screen Y points down)
			const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
			const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
			if (minX > maxX || minY > maxY) continue;
			const ia = 1 / area;
			const iz0 = 1 / z0, iz1 = 1 / z1, iz2 = 1 / z2;
			for (let py = minY; py <= maxY; py++) {
				const cy = py + 0.5;
				for (let px = minX; px <= maxX; px++) {
					const cx = px + 0.5;
					const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * ia;
					const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * ia;
					const w2 = 1 - w0 - w1;
					if (w0 < 0 || w1 < 0 || w2 < 0) continue;
					let z: number, b1: number, b2: number;
					if (cam.ortho) {
						z = w0 * z0 + w1 * z1 + w2 * z2;
						b1 = w1;
						b2 = w2;
					} else {
						const iz = w0 * iz0 + w1 * iz1 + w2 * iz2;
						z = 1 / iz;
						b1 = w1 * iz1 * z;
						b2 = w2 * iz2 * z;
					}
					const p = py * W + px;
					if (z >= depth[p]) continue;
					depth[p] = z;
					triId[p] = t / 3;
					drawId[p] = di;
					bary[p * 2] = b1;
					bary[p * 2 + 1] = b2;
				}
			}
		}
	});

	/* ------------------------------------------- shadow masks on ground */
	let keyMask: Float32Array | null = null;
	let contact: Float32Array | null = null;
	if (o.ground && o.shadow && o.mode !== 'normals' && o.mode !== 'depth') {
		keyMask = new Float32Array(N);
		contact = new Float32Array(N);
		const sp = new Float64Array(9);
		const splat = (mask: Float32Array, dir: V3) => {
			for (const d of draws) {
				const idx = d.indices;
				const P = d.positions;
				for (let t = 0; t < idx.length; t += 3) {
					for (let k = 0; k < 3; k++) {
						const v = idx[t + k] * 3;
						const h = P[v + 1] - o.groundY;
						const tt = h / dir[1];
						project(P[v] - dir[0] * tt, o.groundY, P[v + 2] - dir[2] * tt, sp, k * 3);
					}
					fillTri(mask, W, H, sp);
				}
			}
		};
		splat(keyMask, KEY);
		splat(contact, [0, 1, 0]);
		blur(keyMask, W, H, Math.max(1, Math.round(s * 1.5)));
		blur(contact, W, H, Math.max(2, Math.round(Math.min(W, H) * 0.02)));
		blur(contact, W, H, Math.max(2, Math.round(Math.min(W, H) * 0.02)));
	}

	/* ------------------------------------------------- pass 2: shading */
	const out = new Float32Array(N * 3);
	let zmin = Infinity, zmax = -Infinity;
	if (o.mode === 'depth')
		for (let p = 0; p < N; p++) if (triId[p] >= 0) { zmin = Math.min(zmin, depth[p]); zmax = Math.max(zmax, depth[p]); }

	for (let py = 0; py < H; py++) {
		for (let px = 0; px < W; px++) {
			const p = py * W + px;
			// view ray
			const sx = ((px + 0.5) / W) * 2 - 1, sy = 1 - ((py + 0.5) / H) * 2;
			let ro: V3, rd: V3;
			if (cam.ortho) {
				const ox = sx * cam.halfHeight * aspect, oy = sy * cam.halfHeight;
				ro = [cam.eye[0] + r[0] * ox + u[0] * oy, cam.eye[1] + r[1] * ox + u[1] * oy, cam.eye[2] + r[2] * ox + u[2] * oy];
				rd = f;
			} else {
				ro = cam.eye;
				rd = norm([f[0] + r[0] * sx * tanH * aspect + u[0] * sy * tanH, f[1] + r[1] * sx * tanH * aspect + u[1] * sy * tanH, f[2] + r[2] * sx * tanH * aspect + u[2] * sy * tanH]);
			}
			// ground hit
			let gt = Infinity;
			if (o.ground && Math.abs(rd[1]) > 1e-6) {
				const t = (o.groundY - ro[1]) / rd[1];
				if (t > 0) gt = t;
			}
			const tri = triId[p];
			// along-ray distance of the mesh hit
			const meshT = tri >= 0 ? (cam.ortho ? depth[p] : depth[p] / Math.max(1e-6, dot(rd, f))) : Infinity;
			let col: RGB;
			if (tri >= 0 && meshT <= gt + 1e-4) {
				col = shadeMesh(draws[drawId[p]], shades, tri, bary[p * 2], bary[p * 2 + 1], rd, o, depth[p], zmin, zmax);
			} else if (gt < Infinity) {
				const gx = ro[0] + rd[0] * gt, gz = ro[2] + rd[2] * gt;
				col = shadeGround(gx, gz, o, keyMask ? keyMask[p] : 0, contact ? contact[p] : 0, sy);
			} else col = background(sy);
			out[p * 3] = col[0];
			out[p * 3 + 1] = col[1];
			out[p * 3 + 2] = col[2];
		}
	}

	// downsample + encode sRGB
	const img = new Uint8Array(o.width * o.height * 4);
	const inv = 1 / (s * s);
	for (let y = 0; y < o.height; y++)
		for (let x = 0; x < o.width; x++) {
			let cr = 0, cg = 0, cb = 0;
			for (let j = 0; j < s; j++)
				for (let i = 0; i < s; i++) {
					const p = ((y * s + j) * W + x * s + i) * 3;
					cr += out[p];
					cg += out[p + 1];
					cb += out[p + 2];
				}
			const q = (y * o.width + x) * 4;
			img[q] = Math.round(clamp(cr * inv, 0, 1) * 255);
			img[q + 1] = Math.round(clamp(cg * inv, 0, 1) * 255);
			img[q + 2] = Math.round(clamp(cb * inv, 0, 1) * 255);
			img[q + 3] = 255;
		}
	let ids: Int32Array | undefined;
	if (o.ids) {
		ids = new Int32Array(o.width * o.height).fill(-1);
		const h = s >> 1;
		for (let y = 0; y < o.height; y++)
			for (let x = 0; x < o.width; x++) {
				const p = (y * s + h) * W + x * s + h;
				if (triId[p] >= 0) ids[y * o.width + x] = draws[drawId[p]].triPrim[triId[p]];
			}
	}
	return { width: o.width, height: o.height, data: img, ids };
}

/* ---------------------------------------------------------------- shading */

function aces(x: number) {
	const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
	return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1);
}

const BG_TOP: RGB = [0.965, 0.961, 0.949];
const BG_BOTTOM: RGB = [0.87, 0.86, 0.84];

function background(sy: number): RGB {
	const t = sy * 0.5 + 0.5;
	return [BG_BOTTOM[0] + (BG_TOP[0] - BG_BOTTOM[0]) * t, BG_BOTTOM[1] + (BG_TOP[1] - BG_BOTTOM[1]) * t, BG_BOTTOM[2] + (BG_TOP[2] - BG_BOTTOM[2]) * t];
}

function shadeGround(gx: number, gz: number, o: RasterOptions, key: number, contact: number, sy: number): RGB {
	const dx = gx - o.groundCenter[0], dz = gz - o.groundCenter[1];
	const rr = Math.hypot(dx, dz) / o.groundRadius;
	const fade = clamp(1 - (rr - 0.55) / 0.45, 0, 1);
	const bg = background(sy);
	let g = 0.9;
	const step = o.gridStep;
	const lx = Math.abs(gx / step - Math.round(gx / step)), lz = Math.abs(gz / step - Math.round(gz / step));
	const line = Math.min(lx, lz) < 0.02 ? 1 : 0;
	g -= line * 0.06;
	if (Math.abs(gx) < step * 0.02 || Math.abs(gz) < step * 0.02) g -= 0.05;
	g *= 1 - 0.22 * clamp(key, 0, 1) - 0.3 * clamp(contact, 0, 1);
	const col: RGB = [g * 0.99, g * 0.98, g * 0.96];
	return [bg[0] + (col[0] - bg[0]) * fade, bg[1] + (col[1] - bg[1]) * fade, bg[2] + (col[2] - bg[2]) * fade];
}

function shadeMesh(
	d: Drawable, shades: Shade[], tri: number, b1: number, b2: number, rd: V3, o: RasterOptions, z: number, zmin: number, zmax: number
): RGB {
	const i0 = d.indices[tri * 3], i1 = d.indices[tri * 3 + 1], i2 = d.indices[tri * 3 + 2];
	const b0 = 1 - b1 - b2;
	const n = norm([
		d.normals[i0 * 3] * b0 + d.normals[i1 * 3] * b1 + d.normals[i2 * 3] * b2,
		d.normals[i0 * 3 + 1] * b0 + d.normals[i1 * 3 + 1] * b1 + d.normals[i2 * 3 + 1] * b2,
		d.normals[i0 * 3 + 2] * b0 + d.normals[i1 * 3 + 2] * b1 + d.normals[i2 * 3 + 2] * b2
	]);
	if (o.mode === 'normals') return [n[0] * 0.5 + 0.5, n[1] * 0.5 + 0.5, n[2] * 0.5 + 0.5];
	if (o.mode === 'depth') {
		const t = zmax > zmin ? (z - zmin) / (zmax - zmin) : 0;
		return [1 - t * 0.85, 1 - t * 0.85, 1 - t * 0.85];
	}
	const prim = d.triPrim[tri];
	const ao = d.ao[i0] * b0 + d.ao[i1] * b1 + d.ao[i2] * b2;
	let base: RGB;
	if (o.mode === 'parts' && o.partColors) {
		// flat enough that the legend swatch matches what you see
		const pc = o.partColors(prim);
		const l = 0.72 + 0.28 * Math.max(0, dot(n, KEY)) - 0.12 * (1 - ao);
		return [pc[0] * l, pc[1] * l, pc[2] * l];
	} else if (o.mode === 'clay') base = [0.78, 0.74, 0.7];
	else
		base = [
			d.colors[i0 * 3] * b0 + d.colors[i1 * 3] * b1 + d.colors[i2 * 3] * b2,
			d.colors[i0 * 3 + 1] * b0 + d.colors[i1 * 3 + 1] * b1 + d.colors[i2 * 3 + 1] * b2,
			d.colors[i0 * 3 + 2] * b0 + d.colors[i1 * 3 + 2] * b1 + d.colors[i2 * 3 + 2] * b2
		];
	const lin: RGB = [srgbToLinear(base[0]), srgbToLinear(base[1]), srgbToLinear(base[2])];
	const sh = shades[prim] ?? { roughness: 0.75, metalness: 0, emissive: null, emissiveStrength: 1 };
	const V: V3 = [-rd[0], -rd[1], -rd[2]];
	const ndl = Math.max(0, dot(n, KEY));
	const ndf = Math.max(0, dot(n, FILL));
	const rim = Math.pow(1 - Math.max(0, dot(n, V)), 3) * 0.22 + Math.max(0, dot(n, RIM)) * 0.12;
	const hemi = 0.5 + 0.5 * n[1];
	const metal = o.mode === 'shaded' ? sh.metalness : 0;
	const rough = o.mode === 'shaded' ? sh.roughness : 0.8;
	const out: RGB = [0, 0, 0];
	const hv = norm([KEY[0] + V[0], KEY[1] + V[1], KEY[2] + V[2]]);
	const gloss = 1 - rough;
	const shin = 4 + gloss * gloss * 160;
	const spec = Math.pow(Math.max(0, dot(n, hv)), shin) * ((shin + 8) / 25) * ndl * (0.15 + gloss * 0.85);
	const refl = 2 * dot(n, V);
	const ry = refl * n[1] - V[1];
	const env = 0.35 + 0.45 * clamp(ry * 0.5 + 0.5, 0, 1);
	for (let c = 0; c < 3; c++) {
		const alb = lin[c];
		const sky = [0.62, 0.66, 0.74][c] * hemi + [0.3, 0.27, 0.24][c] * (1 - hemi);
		const diff = alb * (1 - metal) * (ndl * [1.08, 1.0, 0.92][c] * 1.05 + ndf * [0.55, 0.62, 0.75][c] * 0.35 + sky * 0.62 * ao);
		const f0 = 0.04 * (1 - metal) + alb * metal;
		const sp = f0 * spec + metal * alb * env * 0.9 * ao;
		out[c] = diff * (0.55 + 0.45 * ao) + sp + rim * alb * 0.8;
		if (sh.emissive && o.mode === 'shaded') out[c] += srgbToLinear(sh.emissive[c]) * sh.emissiveStrength;
	}
	return [linearToSrgb(aces(out[0] * 1.35)), linearToSrgb(aces(out[1] * 1.35)), linearToSrgb(aces(out[2] * 1.35))];
}

/* ---------------------------------------------------------------- helpers */

function fillTri(mask: Float32Array, W: number, H: number, sp: Float64Array) {
	const x0 = sp[0], y0 = sp[1], x1 = sp[3], y1 = sp[4], x2 = sp[6], y2 = sp[7];
	const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
	if (Math.abs(area) < 1e-9) return;
	const ia = 1 / area;
	const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
	const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
	for (let py = minY; py <= maxY; py++)
		for (let px = minX; px <= maxX; px++) {
			const cx = px + 0.5, cy = py + 0.5;
			const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * ia;
			const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * ia;
			if (w0 < 0 || w1 < 0 || 1 - w0 - w1 < 0) continue;
			mask[py * W + px] = 1;
		}
}

function blur(m: Float32Array, W: number, H: number, rad: number) {
	const tmp = new Float32Array(m.length);
	const span = rad * 2 + 1;
	for (let y = 0; y < H; y++) {
		let acc = 0;
		for (let x = -rad; x <= rad; x++) acc += m[y * W + clamp(x, 0, W - 1)];
		for (let x = 0; x < W; x++) {
			tmp[y * W + x] = acc / span;
			acc += m[y * W + Math.min(W - 1, x + rad + 1)] - m[y * W + Math.max(0, x - rad)];
		}
	}
	for (let x = 0; x < W; x++) {
		let acc = 0;
		for (let y = -rad; y <= rad; y++) acc += tmp[clamp(y, 0, H - 1) * W + x];
		for (let y = 0; y < H; y++) {
			m[y * W + x] = acc / span;
			acc += tmp[Math.min(H - 1, y + rad + 1) * W + x] - tmp[Math.max(0, y - rad) * W + x];
		}
	}
}
