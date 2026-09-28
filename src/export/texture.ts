/**
 * Textures for engines that ignore vertex colors.
 *
 * `bakeAtlas` unwraps meshes into flat charts (connected triangles that face
 * the same axis, projected onto that axis plane), packs the charts of every
 * mesh into one square atlas and paints each texel with the surface color at
 * that point: the parts' own colors and patterns when the build is known, so
 * stripes and spots are sharper than the vertices could hold, otherwise the
 * interpolated vertex colors. Gutters are filled by dilation so mipmaps do
 * not bleed. One atlas can serve many builds (a kit).
 *
 * The shading helpers turn a build into flat-shaded or toon-shaded meshes and
 * make inverted-hull outlines.
 */

import type { Build, MeshData } from '../core/build.js';
import { colorWeight } from '../core/build.js';
import { primColor, type Prim } from '../core/compile.js';
import type { V3 } from '../core/math.js';
import { encodePng } from '../render/png.js';

export type Shading = 'smooth' | 'flat' | 'toon';

/* ------------------------------------------------------------ shading */

const L = (() => {
	const v: V3 = [0.35, 0.85, 0.4];
	const n = Math.hypot(...v);
	return v.map((x) => x / n) as V3;
})();

/** Toon light level for a normal: `bands` flat steps from 0.55 to 1, darkened in occluded creases. */
export function toonLevel(nx: number, ny: number, nz: number, ao: number, bands: number): number {
	const t = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]) * (0.35 + 0.65 * ao);
	const b = Math.max(2, Math.round(bands));
	const i = Math.min(b - 1, Math.floor(t * b));
	return 0.55 + (0.45 * i) / (b - 1);
}

/** Every triangle gets its own vertices with the face normal: the faceted low-poly look. */
export function flatten(m: MeshData): MeshData {
	const nt = m.indices.length / 3;
	const n = nt * 3;
	const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), colors = new Float32Array(n * 3);
	const ao = new Float32Array(n), vertPrim = new Int32Array(n), joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
	const indices = new Uint32Array(n), weld = new Uint32Array(n);
	for (let t = 0; t < nt; t++) {
		const a = m.indices[t * 3], b = m.indices[t * 3 + 1], c = m.indices[t * 3 + 2];
		const P = m.positions;
		const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
		const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
		let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
		const fl = Math.hypot(fx, fy, fz) || 1;
		fx /= fl; fy /= fl; fz /= fl;
		[a, b, c].forEach((src, k) => {
			const v = t * 3 + k;
			positions.set(m.positions.subarray(src * 3, src * 3 + 3), v * 3);
			normals[v * 3] = fx; normals[v * 3 + 1] = fy; normals[v * 3 + 2] = fz;
			colors.set(m.colors.subarray(src * 3, src * 3 + 3), v * 3);
			ao[v] = m.ao[src];
			vertPrim[v] = m.vertPrim[src];
			joints.set(m.joints.subarray(src * 4, src * 4 + 4), v * 4);
			weights.set(m.weights.subarray(src * 4, src * 4 + 4), v * 4);
			indices[v] = v;
			weld[v] = m.weld ? m.weld[src] : src;
		});
	}
	return { ...m, positions, normals, colors, ao, vertPrim, joints, weights, indices, weld };
}

/** Bake toon bands into vertex colors (AO is folded into the bands). */
export function toonColors(m: MeshData, bands: number): MeshData {
	const colors = new Float32Array(m.colors.length);
	for (let v = 0; v < m.ao.length; v++) {
		const k = toonLevel(m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2], m.ao[v], bands);
		for (let c = 0; c < 3; c++) colors[v * 3 + c] = m.colors[v * 3 + c] * k;
	}
	return { ...m, colors, ao: new Float32Array(m.ao.length).fill(1) };
}

/**
 * Inverted hull: the surface pushed out along its (welded) normals with the
 * winding flipped, so with back-face culling only a dark rim shows around the
 * model. Skinning is copied, so the outline follows animation.
 */
export function outlineMesh(m: MeshData, width: number): MeshData {
	const n = m.positions.length / 3;
	const nrm = new Float32Array(m.normals);
	if (m.weld) {
		// split vertices at sharp edges would tear the hull apart: average their normals
		const sum = new Map<number, V3>();
		for (let v = 0; v < n; v++) {
			const k = m.weld[v];
			const s = sum.get(k) ?? [0, 0, 0];
			s[0] += m.normals[v * 3]; s[1] += m.normals[v * 3 + 1]; s[2] += m.normals[v * 3 + 2];
			sum.set(k, s);
		}
		for (let v = 0; v < n; v++) {
			const s = sum.get(m.weld[v])!;
			const l = Math.hypot(...s) || 1;
			nrm[v * 3] = s[0] / l; nrm[v * 3 + 1] = s[1] / l; nrm[v * 3 + 2] = s[2] / l;
		}
	}
	const positions = new Float32Array(n * 3);
	for (let i = 0; i < n * 3; i++) positions[i] = m.positions[i] + nrm[i] * width;
	const indices = new Uint32Array(m.indices.length);
	for (let t = 0; t < indices.length; t += 3) {
		indices[t] = m.indices[t];
		indices[t + 1] = m.indices[t + 2];
		indices[t + 2] = m.indices[t + 1];
	}
	return {
		...m,
		name: `${m.name}_outline`,
		positions,
		normals: nrm.map((x) => -x),
		colors: new Float32Array(n * 3),
		ao: new Float32Array(n).fill(1),
		indices
	};
}

/* ------------------------------------------------------------- atlas */

export interface AtlasSource {
	mesh: MeshData;
	/** the build the mesh came from: its parts give the texel colors; without it vertex colors are interpolated */
	build?: Build;
}

export interface AtlasMesh {
	/** new vertex → source vertex (vertices are split along chart seams) */
	remap: Uint32Array;
	uv: Float32Array;
	indices: Uint32Array;
}

export interface Atlas {
	size: number;
	rgba: Uint8Array;
	png: Uint8Array;
	/** one per source, in order */
	meshes: AtlasMesh[];
	charts: number;
	texelsPerMeter: number;
	/** share of the atlas covered by charts */
	coverage: number;
}

export interface AtlasOptions {
	size?: number;
	/** texels of gutter around each chart (default 2) */
	padding?: number;
	/** darken creases with the baked ambient occlusion (default true) */
	bakeAo?: boolean;
	/** toon bands baked into the texels (0 = off) */
	toonBands?: number;
}

interface Chart {
	src: number;
	tris: number[];
	u: number;
	v: number;
	umin: number;
	vmin: number;
	w: number;
	h: number;
	x: number;
	y: number;
	pw: number;
	ph: number;
}

function chartsOf(m: MeshData, src: number): Chart[] {
	const nt = m.indices.length / 3, P = m.positions, I = m.indices;
	const label = new Uint8Array(nt);
	for (let t = 0; t < nt; t++) {
		const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
		const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
		const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
		const f = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
		const ax = Math.abs(f[0]) >= Math.abs(f[1]) && Math.abs(f[0]) >= Math.abs(f[2]) ? 0 : Math.abs(f[1]) >= Math.abs(f[2]) ? 1 : 2;
		label[t] = ax * 2 + (f[ax] < 0 ? 1 : 0);
	}
	// union triangles that share an edge and face the same way
	const parent = new Int32Array(nt).map((_, i) => i);
	const find = (i: number): number => {
		while (parent[i] !== i) i = parent[i] = parent[parent[i]];
		return i;
	};
	const key = (v: number) => (m.weld ? m.weld[v] : v);
	const nv = m.positions.length / 3;
	const edges = new Map<number, number>();
	for (let t = 0; t < nt; t++)
		for (let k = 0; k < 3; k++) {
			const a = key(I[t * 3 + k]), b = key(I[t * 3 + ((k + 1) % 3)]);
			const e = Math.min(a, b) * nv + Math.max(a, b);
			const o = edges.get(e);
			if (o === undefined) edges.set(e, t);
			else if (label[o] === label[t]) parent[find(o)] = find(t);
		}
	const byRoot = new Map<number, number[]>();
	for (let t = 0; t < nt; t++) {
		const r = find(t);
		const list = byRoot.get(r);
		if (list) list.push(t);
		else byRoot.set(r, [t]);
	}
	const charts: Chart[] = [];
	for (const tris of byRoot.values()) {
		const ax = label[tris[0]] >> 1;
		const u = (ax + 1) % 3, v = (ax + 2) % 3;
		let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
		for (const t of tris)
			for (let k = 0; k < 3; k++) {
				const p = I[t * 3 + k] * 3;
				umin = Math.min(umin, P[p + u]); umax = Math.max(umax, P[p + u]);
				vmin = Math.min(vmin, P[p + v]); vmax = Math.max(vmax, P[p + v]);
			}
		// lay every chart landscape: it packs tighter
		if (vmax - vmin > umax - umin) charts.push({ src, tris, u: v, v: u, umin: vmin, vmin: umin, w: vmax - vmin, h: umax - umin, x: 0, y: 0, pw: 0, ph: 0 });
		else charts.push({ src, tris, u, v, umin, vmin, w: umax - umin, h: vmax - vmin, x: 0, y: 0, pw: 0, ph: 0 });
	}
	return charts;
}

/** Skyline packing at `s` meters per texel (tallest first, each at its lowest spot); false if it does not fit. */
function pack(charts: Chart[], s: number, size: number, pad: number): boolean {
	for (const c of charts) {
		c.pw = Math.ceil(c.w / s) + 1 + pad * 2;
		c.ph = Math.ceil(c.h / s) + 1 + pad * 2;
	}
	const order = charts.slice().sort((a, b) => b.ph - a.ph || b.pw - a.pw);
	const sky = new Int32Array(size);
	for (const c of order) {
		if (c.pw > size) return false;
		let bestX = -1, bestY = Infinity;
		for (let x = 0; x + c.pw <= size; ) {
			let y = 0, jump = x + 1;
			for (let k = x; k < x + c.pw; k++)
				if (sky[k] >= y) {
					y = sky[k];
					jump = k + 1;
				}
			if (y < bestY) {
				bestY = y;
				bestX = x;
			}
			// every start up to the (last) highest column still covers it, so none of them is lower
			x = jump;
		}
		if (bestX < 0 || bestY + c.ph > size) return false;
		c.x = bestX;
		c.y = bestY;
		for (let k = bestX; k < bestX + c.pw; k++) sky[k] = bestY + c.ph;
	}
	return true;
}

export function bakeAtlas(sources: AtlasSource[], opts: AtlasOptions = {}): Atlas {
	const size = Math.max(64, Math.min(8192, Math.round(opts.size ?? 1024)));
	const pad = Math.max(1, Math.round(opts.padding ?? 2));
	const bakeAo = opts.bakeAo ?? true;
	const charts = sources.flatMap((s, i) => chartsOf(s.mesh, i));

	// texel size: start from the area estimate, grow until everything fits
	let area = 0;
	for (const c of charts) area += (c.w + 1e-6) * (c.h + 1e-6);
	// texel size: the smallest (sharpest) that still packs, by bisection
	let lo = Math.sqrt(area) / size || 1e-4;
	let hi = lo * 1.5;
	for (let tries = 0; !pack(charts, hi, size, pad); tries++) {
		lo = hi;
		hi *= 1.5;
		if (tries > 40) throw new Error('could not pack the texture atlas — too many separate pieces for this size; raise the atlas size');
	}
	for (let i = 0; i < 10; i++) {
		const mid = (lo + hi) / 2;
		if (pack(charts, mid, size, pad)) hi = mid;
		else lo = mid;
	}
	const s = hi;
	pack(charts, s, size, pad);

	/* ------------------------------------------------ vertices and uvs */
	const meshes: AtlasMesh[] = sources.map((src) => ({ remap: new Uint32Array(0), uv: new Float32Array(0), indices: new Uint32Array(src.mesh.indices.length) }));
	const bySrc = sources.map(() => [] as Chart[]);
	for (const c of charts) bySrc[c.src].push(c);
	bySrc.forEach((list, si) => {
		const m = sources[si].mesh;
		const remap: number[] = [], uv: number[] = [];
		for (const c of list) {
			const local = new Map<number, number>();
			for (const t of c.tris)
				for (let k = 0; k < 3; k++) {
					const old = m.indices[t * 3 + k];
					let nv = local.get(old);
					if (nv === undefined) {
						nv = remap.length;
						local.set(old, nv);
						remap.push(old);
						uv.push((c.x + pad + 0.5 + (m.positions[old * 3 + c.u] - c.umin) / s) / size, (c.y + pad + 0.5 + (m.positions[old * 3 + c.v] - c.vmin) / s) / size);
					}
					meshes[si].indices[t * 3 + k] = nv;
				}
		}
		meshes[si].remap = Uint32Array.from(remap);
		meshes[si].uv = Float32Array.from(uv);
	});

	/* ---------------------------------------------------------- texels */
	const rgb = new Float32Array(size * size * 3);
	const covered = new Uint8Array(size * size);
	const cand: Prim[] = [];
	for (const c of charts) {
		const src = sources[c.src], m = src.mesh, am = meshes[c.src];
		const b = src.build;
		const prims = b ? (m.prim >= 0 ? [b.compiled.prims[m.prim]] : b.compiled.body) : [];
		const reach = b ? b.cell * 3 : 0;
		for (const t of c.tris) {
			const vi = [am.indices[t * 3], am.indices[t * 3 + 1], am.indices[t * 3 + 2]];
			const src3 = vi.map((v) => am.remap[v]);
			const px = vi.map((v) => am.uv[v * 2] * size), py = vi.map((v) => am.uv[v * 2 + 1] * size);
			const det = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
			if (Math.abs(det) < 1e-12) continue;
			// parts that can color this triangle
			cand.length = 0;
			if (b) {
				const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
				for (const v of src3)
					for (let a = 0; a < 3; a++) {
						const q = m.positions[v * 3 + a] - b.offset[a];
						lo[a] = Math.min(lo[a], q);
						hi[a] = Math.max(hi[a], q);
					}
				for (const pr of prims)
					if (pr.min[0] - reach <= hi[0] && pr.max[0] + reach >= lo[0] && pr.min[1] - reach <= hi[1] && pr.max[1] + reach >= lo[1] && pr.min[2] - reach <= hi[2] && pr.max[2] + reach >= lo[2]) cand.push(pr);
			}
			const x0 = Math.max(0, Math.floor(Math.min(...px))), x1 = Math.min(size - 1, Math.ceil(Math.max(...px)));
			const y0 = Math.max(0, Math.floor(Math.min(...py))), y1 = Math.min(size - 1, Math.ceil(Math.max(...py)));
			const paint = (x: number, y: number, w0: number, w1: number, w2: number) => {
				const wts = [w0, w1, w2];
				const at = (arr: Float32Array, k: number, stride: number) => wts[0] * arr[src3[0] * stride + k] + wts[1] * arr[src3[1] * stride + k] + wts[2] * arr[src3[2] * stride + k];
				let r = at(m.colors, 0, 3), g = at(m.colors, 1, 3), bl = at(m.colors, 2, 3);
				if (b && cand.length) {
					const p: V3 = [at(m.positions, 0, 3) - b.offset[0], at(m.positions, 1, 3) - b.offset[1], at(m.positions, 2, 3) - b.offset[2]];
					let tw = 0, sr = 0, sg = 0, sb = 0;
					for (const pr of cand) {
						const wt = colorWeight(pr, p[0], p[1], p[2], b.cell);
						if (wt < 0) continue;
						const col = primColor(pr, p);
						sr += col[0] * wt; sg += col[1] * wt; sb += col[2] * wt;
						tw += wt;
					}
					if (tw > 0) { r = sr / tw; g = sg / tw; bl = sb / tw; }
				}
				const ao = at(m.ao, 0, 1);
				let k = bakeAo ? ao : 1;
				if (opts.toonBands) {
					const nx = at(m.normals, 0, 3), ny = at(m.normals, 1, 3), nz = at(m.normals, 2, 3);
					const nl = Math.hypot(nx, ny, nz) || 1;
					k = toonLevel(nx / nl, ny / nl, nz / nl, ao, opts.toonBands);
				}
				const o = y * size + x;
				rgb[o * 3] = r * k; rgb[o * 3 + 1] = g * k; rgb[o * 3 + 2] = bl * k;
				covered[o] = 1;
			};
			for (let y = y0; y <= y1; y++)
				for (let x = x0; x <= x1; x++) {
					const cx = x + 0.5, cy = y + 0.5;
					const w1 = ((cx - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (cy - py[0])) / det;
					const w2 = ((px[1] - px[0]) * (cy - py[0]) - (cx - px[0]) * (py[1] - py[0])) / det;
					const w0 = 1 - w1 - w2;
					if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
					paint(x, y, w0, w1, w2);
				}
			// slivers and tiny charts can miss every texel center: paint the texels under the corners and the middle
			const spots: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1 / 3, 1 / 3, 1 / 3]];
			for (const [a0, a1, a2] of spots) {
				const x = Math.min(size - 1, Math.max(0, Math.floor(a0 * px[0] + a1 * px[1] + a2 * px[2])));
				const y = Math.min(size - 1, Math.max(0, Math.floor(a0 * py[0] + a1 * py[1] + a2 * py[2])));
				if (!covered[y * size + x]) paint(x, y, a0, a1, a2);
			}
		}
	}
	let inside = 0;
	for (let i = 0; i < covered.length; i++) inside += covered[i];

	// gutters: grow every chart outward so filtering and mipmaps sample its own color
	let frontier = covered;
	for (let pass = 0; pass < pad + 2; pass++) {
		const next = new Uint8Array(frontier);
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const o = y * size + x;
				if (frontier[o]) continue;
				let n = 0, r = 0, g = 0, bl = 0;
				for (let dy = -1; dy <= 1; dy++)
					for (let dx = -1; dx <= 1; dx++) {
						const xx = x + dx, yy = y + dy;
						if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
						const q = yy * size + xx;
						if (!frontier[q]) continue;
						r += rgb[q * 3]; g += rgb[q * 3 + 1]; bl += rgb[q * 3 + 2];
						n++;
					}
				if (!n) continue;
				rgb[o * 3] = r / n; rgb[o * 3 + 1] = g / n; rgb[o * 3 + 2] = bl / n;
				next[o] = 1;
			}
		frontier = next;
	}

	const rgba = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		const on = frontier[i];
		for (let c = 0; c < 3; c++) rgba[i * 4 + c] = on ? Math.round(Math.max(0, Math.min(1, rgb[i * 3 + c])) * 255) : 128;
		rgba[i * 4 + 3] = 255;
	}
	return { size, rgba, png: encodePng(rgba, size, size), meshes, charts: charts.length, texelsPerMeter: 1 / s, coverage: inside / (size * size) };
}
