/**
 * Compiled scene → triangle meshes with the attributes every downstream
 * stage needs: normals, base color, ambient occlusion, dominant part per
 * triangle (materials, critics, the parts render) and skin weights (rig).
 */

import { add, clamp, type V3 } from './math.js';
import { bodyBase, bodyField, compile, partDist, primColor, primDist, worldAabb, type Compiled, type Prim } from './compile.js';
import { directMesh, geometricNormals } from './direct.js';
import { surfaceNets, type Eval, type MeshField } from './mesher.js';
import { applyStyle } from './style.js';
import type { Scene } from './schema.js';

export interface MeshData {
	name: string;
	positions: Float32Array;
	normals: Float32Array;
	/** sRGB 0..1 */
	colors: Float32Array;
	ao: Float32Array;
	indices: Uint32Array;
	/** Dominant prim index per triangle. */
	triPrim: Int32Array;
	/** Dominant prim index per vertex. */
	vertPrim: Int32Array;
	joints: Uint16Array;
	weights: Float32Array;
	/** For a separate part: the prim it belongs to; -1 for the fused body. */
	prim: number;
	/** After sharp-edge splitting: the welded vertex each vertex came from (for connectivity). */
	weld?: Uint32Array;
}

export interface Build {
	compiled: Compiled;
	/** the scene as written (compiled.scene has the style applied) */
	source: Scene;
	meshes: MeshData[];
	/** Translation applied to everything so the model stands on y=0. */
	offset: V3;
	min: V3;
	max: V3;
	cell: number;
	stats: { triangles: number; vertices: number; ms: number; samples: number };
}

export interface BuildOptions {
	resolution?: number;
	ao?: boolean;
	edges?: 'soft' | 'sharp';
}

const BLOCK = 4;

export interface BodyContext {
	min: V3;
	max: V3;
	field: MeshField;
	near: (x: number, y: number, z: number, reach: number) => { prims: Int32Array; sculpts: Int32Array; lip: number } | null;
	gradNear: (x: number, y: number, z: number) => V3;
}

/** Everything a build (or a worker doing part of one) needs, derived deterministically from the scene. */
export interface BuildContext {
	source: Scene;
	scene: Scene;
	c: Compiled;
	res: number;
	wantAo: boolean;
	sharp: boolean;
	cell: number;
	ext: number;
	body: BodyContext | null;
}

export function prepareContext(source: Scene, opts: BuildOptions = {}): BuildContext {
	const scene = applyStyle(source);
	const c = compile(scene);
	const res = opts.resolution ?? scene.settings?.resolution ?? 96;
	const wantAo = opts.ao ?? scene.settings?.ao ?? true;
	const sharp = (opts.edges ?? scene.settings?.edges) === 'sharp';
	const adds = c.body.filter((p) => p.op === 'add');
	const visible = c.prims.filter((p) => !p.hidden && p.op === 'add');
	const all = worldAabb(visible.length ? visible : c.prims);
	const ext = all ? Math.max(all.max[0] - all.min[0], all.max[1] - all.min[1], all.max[2] - all.min[2]) : 1;
	const cell = Math.max(ext, 1e-3) / res;
	return { source, scene, c, res, wantAo, sharp, cell, ext, body: adds.length ? prepareBody(c, cell, adds) : null };
}

function prepareBody(c: Compiled, cell: number, adds: Prim[]): BodyContext {
	const box = worldAabb(adds)!;
	const maxK = Math.max(0, ...c.body.map((p) => p.k));
	const pad = c.grow + maxK + cell * 3;
	const min: V3 = [box.min[0] - pad, box.min[1] - pad, box.min[2] - pad];
	const max: V3 = [box.max[0] + pad, box.max[1] + pad, box.max[2] + pad];
	type List = { prims: Int32Array; sculpts: Int32Array; lip: number };
	const lists = new Map<string, List | null>();
	const listFor = (bmin: V3, bmax: V3): List | null => {
		const key = `${bmin[0].toFixed(5)},${bmin[1].toFixed(5)},${bmin[2].toFixed(5)},${bmax[0].toFixed(5)}`;
		if (lists.has(key)) return lists.get(key)!;
		const pr: number[] = [];
		let hasAdd = false;
		let empty = false;
		let lip = 1;
		c.body.forEach((p, i) => {
			const e = p.k * 1.5 + c.grow;
			const touches =
				p.min[0] - e <= bmax[0] && p.max[0] + e >= bmin[0] &&
				p.min[1] - e <= bmax[1] && p.max[1] + e >= bmin[1] &&
				p.min[2] - e <= bmax[2] && p.max[2] + e >= bmin[2];
			if (p.op === 'intersect') {
				if (!touches) empty = true;
				pr.push(i);
			} else if (touches) {
				pr.push(i);
				if (p.op === 'add') hasAdd = true;
			} else return;
			if (p.detail) lip = Math.max(lip, 1 + (5.5 * p.detail.amount) / p.detail.scale);
		});
		let r: List | null = null;
		if (hasAdd && !empty) {
			const sc: number[] = [];
			c.sculpts.forEach((s, i) => {
				if (s.global || (s.min[0] <= bmax[0] && s.max[0] >= bmin[0] && s.min[1] <= bmax[1] && s.max[1] >= bmin[1] && s.min[2] <= bmax[2] && s.max[2] >= bmin[2])) {
					sc.push(i);
					lip = Math.max(lip, s.lip);
				}
			});
			r = { prims: Int32Array.from(pr), sculpts: Int32Array.from(sc), lip: lip * 1.25 };
		}
		lists.set(key, r);
		return r;
	};
	const field: MeshField = {
		min, max, lip: 8,
		block(bmin, bmax) {
			const l = listFor(bmin, bmax);
			if (!l) return null;
			return { ev: (x, y, z) => bodyField(c, x, y, z, l.prims, l.sculpts), lip: l.lip };
		}
	};
	// neighbourhood lists for a point's block, grown by `reach` (cached per block)
	const blockSize = BLOCK * cell;
	// hot path (called per vertex and per crossing): numeric keys, no string building
	const nearCache = new Map<number, List | null>();
	const reaches: number[] = [];
	const near = (x: number, y: number, z: number, reach: number): List | null => {
		const bi = Math.floor((x - min[0]) / blockSize), bj = Math.floor((y - min[1]) / blockSize), bk = Math.floor((z - min[2]) / blockSize);
		let ri = reaches.indexOf(reach);
		if (ri < 0) ri = reaches.push(reach) - 1;
		const key = ((((bk + 2) * 4096 + (bj + 2)) * 4096 + (bi + 2)) * 8) + ri;
		const hit = nearCache.get(key);
		if (hit !== undefined) return hit;
		const bmin: V3 = [min[0] + bi * blockSize - reach, min[1] + bj * blockSize - reach, min[2] + bk * blockSize - reach];
		const bmax: V3 = [min[0] + (bi + 1) * blockSize + reach, min[1] + (bj + 1) * blockSize + reach, min[2] + (bk + 1) * blockSize + reach];
		const l = listFor(bmin, bmax);
		nearCache.set(key, l);
		return l;
	};
	const gradNear = (x: number, y: number, z: number): V3 => {
		const l = near(x, y, z, cell * 3);
		const e = cell * 0.25;
		const g = (px: number, py: number, pz: number) => (l ? bodyField(c, px, py, pz, l.prims, l.sculpts) : bodyField(c, px, py, pz));
		const gx = g(x + e, y, z) - g(x - e, y, z), gy = g(x, y + e, z) - g(x, y - e, z), gz = g(x, y, z + e) - g(x, y, z - e);
		const n = Math.hypot(gx, gy, gz) || 1;
		return [gx / n, gy / n, gz / n];
	};
	return { min, max, field, near, gradNear };
}

export function buildScene(scene: Scene, opts: BuildOptions = {}): Build {
	const t0 = performance.now();
	const ctx = prepareContext(scene, opts);
	let body: MeshData | null = null;
	let samples = 0;
	if (ctx.body) {
		const raw = surfaceNets(ctx.body.field, ctx.cell, ctx.sharp ? { normal: ctx.body.gradNear } : {});
		samples += raw.samples;
		body = bodyMesh(ctx, raw.positions, raw.indices, vertexAttributes(ctx, raw.positions, 0, raw.positions.length / 3));
	}
	return finishBuild(ctx, body, samples, t0);
}

/** Per-vertex attributes of the fused body for vertices [v0, v1) (a worker does a slice). */
export function vertexAttributes(ctx: BuildContext, positions: Float32Array, v0: number, v1: number): VertexAttrs {
	const b = ctx.body!;
	return computeAttributes(positions, v0, v1, ctx.cell, ctx.c, ctx.c.body, -1, b.near, (x, y, z) => bodyField(ctx.c, x, y, z), ctx.wantAo, ctx.ext);
}

export function bodyMesh(ctx: BuildContext, positions: Float32Array, indices: Uint32Array, at: VertexAttrs): MeshData {
	const m = assemble('body', positions, indices, at, -1);
	return ctx.sharp ? splitSharp(m, 40) : m;
}

export function finishBuild(ctx: BuildContext, body: MeshData | null, samples: number, t0: number): Build {
	const { c, res, cell, sharp, wantAo, scene, source } = ctx;
	const meshes: MeshData[] = body ? [body] : [];
	/* ---------------------------------------------------- separate parts */
	for (const pr of c.prims) {
		if (!pr.separate || pr.hidden || pr.op !== 'add') continue;
		const e = Math.max(pr.max[0] - pr.min[0], pr.max[1] - pr.min[1], pr.max[2] - pr.min[2]);
		const sc = Math.min(cell, e / Math.max(20, res * 0.4));
		const pad = sc * 3;
		const f: Eval = (x, y, z) => partDist(pr, x, y, z);
		const field: MeshField = {
			min: [pr.min[0] - pad, pr.min[1] - pad, pr.min[2] - pad],
			max: [pr.max[0] + pad, pr.max[1] + pad, pr.max[2] + pad],
			lip: 1.25 + (pr.detail ? (5.5 * pr.detail.amount) / pr.detail.scale : 0),
			block: () => ({ ev: f, lip: 1.25 + (pr.detail ? (5.5 * pr.detail.amount) / pr.detail.scale : 0) })
		};
		const gradSep = (x: number, y: number, z: number): V3 => {
			const h = sc * 0.25;
			const gx = f(x + h, y, z) - f(x - h, y, z), gy = f(x, y + h, z) - f(x, y - h, z), gz = f(x, y, z + h) - f(x, y, z - h);
			const n = Math.hypot(gx, gy, gz) || 1;
			return [gx / n, gy / n, gz / n];
		};
		const direct = directMesh(pr, cell);
		if (direct) {
			// sheets and kept meshes: their own triangles, normals from those triangles
			const at = computeAttributes(direct.positions, 0, direct.positions.length / 3, sc, c, [pr], pr.index, () => null, f, wantAo, e);
			at.normals = geometricNormals(direct.positions, direct.indices);
			const m = assemble(pr.id, direct.positions, direct.indices, at, pr.index);
			meshes.push(direct.sharp ? splitSharp(m, 40) : m);
			continue;
		}
		const raw = surfaceNets(field, sc, sharp ? { normal: gradSep } : {});
		samples += raw.samples;
		const m = assemble(pr.id, raw.positions, raw.indices, computeAttributes(raw.positions, 0, raw.positions.length / 3, sc, c, [pr], pr.index, () => null, f, wantAo, e), pr.index);
		meshes.push(sharp ? splitSharp(m, 40) : m);
	}

	/* ------------------------------------------------------------ ground */
	let minY = Infinity;
	const bmin: V3 = [Infinity, Infinity, Infinity], bmax: V3 = [-Infinity, -Infinity, -Infinity];
	for (const m of meshes)
		for (let i = 0; i < m.positions.length; i += 3) {
			for (let a = 0; a < 3; a++) {
				bmin[a] = Math.min(bmin[a], m.positions[i + a]);
				bmax[a] = Math.max(bmax[a], m.positions[i + a]);
			}
		}
	minY = bmin[1];
	const offset: V3 = scene.settings?.ground === 'none' || !isFinite(minY) ? [0, 0, 0] : [0, -minY, 0];
	if (offset[1] !== 0) {
		for (const m of meshes) for (let i = 1; i < m.positions.length; i += 3) m.positions[i] += offset[1];
		bmin[1] += offset[1];
		bmax[1] += offset[1];
	}

	let triangles = 0, vertices = 0;
	for (const m of meshes) {
		triangles += m.indices.length / 3;
		vertices += m.positions.length / 3;
	}
	return {
		compiled: c,
		source,
		meshes,
		offset,
		min: isFinite(bmin[0]) ? bmin : [0, 0, 0],
		max: isFinite(bmax[0]) ? bmax : [0, 0, 0],
		cell,
		stats: { triangles, vertices, ms: Math.round(performance.now() - t0), samples }
	};
}

export interface VertexAttrs {
	normals: Float32Array;
	colors: Float32Array;
	ao: Float32Array;
	vertPrim: Int32Array;
	joints: Uint16Array;
	weights: Float32Array;
}

/**
 * The surface color at a point from weighted parts. Two parts' colors mix only
 * where their seam is smooth (one of them has a blend radius): a hard seam
 * keeps a crisp line, so paint does not bleed from a door onto the wall and
 * parts need not be separate just to keep their colors apart.
 */
export function mixColors(prims: Prim[], ids: ArrayLike<number>, w: ArrayLike<number>, dominant: number, p: V3, n?: V3): [number, number, number] {
	const dom = prims[ids[dominant]];
	let tw = 0, r = 0, g = 0, b = 0;
	for (let j = 0; j < ids.length; j++) {
		const pr = prims[ids[j]];
		if (j !== dominant && Math.max(pr.k, dom.k) <= 0) continue;
		const col = primColor(pr, p, n);
		r += col[0] * w[j]; g += col[1] * w[j]; b += col[2] * w[j];
		tw += w[j];
	}
	return [r / tw, g / tw, b / tw];
}

/** How much a part colors the surface at a point (inverse square distance); -1 when it never does. */
export function colorWeight(pr: Prim, x: number, y: number, z: number, cell: number): number {
	if (pr.op === 'intersect') return -1;
	if (pr.op === 'carve' && !pr.part.material?.color) return -1;
	const raw = primDist(pr, x, y, z);
	const d = pr.op === 'carve' ? Math.abs(raw) : Math.max(0, raw);
	// a point well inside an added part lies on a carved cavity: the carve owns its color
	const inside = pr.op === 'add' && raw < -cell * 0.75 ? 0.02 : 1;
	return inside / (d * d + (cell * 0.75) ** 2);
}

function computeAttributes(
	positions: Float32Array,
	v0: number,
	v1: number,
	cell: number,
	c: Compiled,
	cands: Prim[],
	rigid: number,
	near: (x: number, y: number, z: number, reach: number) => { prims: Int32Array; sculpts: Int32Array } | null,
	field: Eval,
	wantAo: boolean,
	size: number
): VertexAttrs {
	const n = v1 - v0;
	const normals = new Float32Array(n * 3);
	const colors = new Float32Array(n * 3);
	const ao = new Float32Array(n).fill(1);
	const vertPrim = new Int32Array(n);
	const joints = new Uint16Array(n * 4);
	const weights = new Float32Array(n * 4);
	const h = cell * 0.5;
	const aoSteps = [0.02, 0.05, 0.1, 0.18].map((f) => Math.max(cell * 1.5, size * f));
	const w: number[] = [];
	const ids: number[] = [];

	for (let v = 0; v < n; v++) {
		const src = v0 + v;
		const x = positions[src * 3], y = positions[src * 3 + 1], z = positions[src * 3 + 2];
		const l = rigid < 0 ? near(x, y, z, cell * 3) : null;
		const nf: Eval = l ? (px, py, pz) => bodyField(c, px, py, pz, l.prims, l.sculpts) : field;
		let nx = nf(x + h, y, z) - nf(x - h, y, z);
		let ny = nf(x, y + h, z) - nf(x, y - h, z);
		let nz = nf(x, y, z + h) - nf(x, y, z - h);
		const nl = Math.hypot(nx, ny, nz) || 1;
		nx /= nl; ny /= nl; nz /= nl;
		normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz;

		if (wantAo) {
			let occ = 0, sca = 1;
			const la = rigid < 0 ? near(x, y, z, aoSteps[aoSteps.length - 1] + cell * 2) : null;
			const af: Eval = la ? (px, py, pz) => bodyField(c, px, py, pz, la.prims, la.sculpts) : field;
			for (const s of aoSteps) {
				const d = af(x + nx * s, y + ny * s, z + nz * s);
				occ += Math.max(0, s - d) / s * sca * 0.25;
				sca *= 0.8;
			}
			ao[v] = clamp(1 - occ * 1.6, 0.25, 1);
		}

		// weights over candidate prims
		w.length = 0;
		ids.length = 0;
		const list = rigid >= 0 ? null : l?.prims;
		const m = list ? list.length : cands.length;
		for (let j = 0; j < m; j++) {
			const pr = list ? cands[list[j]] : cands[j];
			const wt = colorWeight(pr, x, y, z, cell);
			if (wt < 0) continue;
			w.push(wt);
			ids.push(pr.index);
		}
		if (!ids.length) {
			// e.g. a vertex made by a sculpt far from parts: nearest add prim
			let best = -1, bd = Infinity;
			for (const pr of cands) {
				if (pr.op !== 'add') continue;
				const d = primDist(pr, x, y, z);
				if (d < bd) { bd = d; best = pr.index; }
			}
			if (best < 0) best = cands[0]?.index ?? 0;
			w.push(1);
			ids.push(best);
		}
		// color: the dominant part's, mixed only with parts it blends with; dominant prim: max weight
		let bi = 0;
		for (let j = 0; j < ids.length; j++) if (w[j] > w[bi]) bi = j;
		const col = mixColors(c.prims, ids, w, bi, [x, y, z], [nx, ny, nz]);
		colors[v * 3] = col[0]; colors[v * 3 + 1] = col[1]; colors[v * 3 + 2] = col[2];
		vertPrim[v] = ids[bi];

		// skin: top 4 among parts whose surface is really here — within their blend
		// radius (+1.5 cells) of the nearest one — so neighbouring legs do not share vertices
		let dmin = Infinity;
		const dist: number[] = ids.map((id) => {
			const pr = c.prims[id];
			const d = pr.op === 'add' ? Math.max(0, primDist(pr, x, y, z)) : Infinity;
			if (d < dmin) dmin = d;
			return d;
		});
		// ...and only parts related to the dominant one in the attach hierarchy (a hand
		// resting near the hip must not follow the leg)
		const dom = ids[bi];
		const related = (p: number) => p === dom || c.prims[dom].parent === p || c.prims[p].parent === dom;
		const order = ids
			.map((_, j) => j)
			.filter((j) => c.prims[ids[j]].op === 'add' && related(ids[j]) && dist[j] <= dmin + Math.max(c.prims[ids[j]].k, cell * 1.5))
			.sort((a, b2) => w[b2] - w[a])
			.slice(0, 4);
		if (!order.length) order.push(bi);
		let sw = 0;
		for (const j of order) sw += w[j] * w[j];
		order.forEach((j, s) => {
			joints[v * 4 + s] = ids[j];
			weights[v * 4 + s] = (w[j] * w[j]) / sw;
		});
		if (rigid >= 0) {
			joints[v * 4] = rigid;
			weights[v * 4] = 1;
			for (let s = 1; s < 4; s++) { joints[v * 4 + s] = 0; weights[v * 4 + s] = 0; }
		}
	}

	return { normals, colors, ao, vertPrim, joints, weights };
}

function assemble(name: string, positions: Float32Array, indices: Uint32Array, at: VertexAttrs, prim: number): MeshData {
	const triPrim = new Int32Array(indices.length / 3);
	for (let t = 0; t < triPrim.length; t++) {
		const a = at.vertPrim[indices[t * 3]], b = at.vertPrim[indices[t * 3 + 1]], cc = at.vertPrim[indices[t * 3 + 2]];
		triPrim[t] = a === b || a === cc ? a : b === cc ? b : a;
	}
	return { name, positions, indices, triPrim, prim, ...at };
}

/** World position after the ground offset. */
export function grounded(b: Build, p: V3): V3 {
	return add(p, b.offset);
}

export { bodyBase };

/**
 * Give sharp edges sharp shading: split a vertex where its faces meet at more
 * than `angle` degrees, so each side keeps its own normal. `weld` remembers
 * the original vertex so connectivity checks still see one surface.
 */
export function splitSharp(m: MeshData, angle: number): MeshData {
	const nv = m.positions.length / 3, nt = m.indices.length / 3;
	const P = m.positions, I = m.indices;
	const fn = new Float32Array(nt * 3);
	for (let t = 0; t < nt; t++) {
		const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
		const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
		const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
		// area-weighted: keep the cross product unnormalized for averaging, store unit for tests
		fn[t * 3] = uy * vz - uz * vy;
		fn[t * 3 + 1] = uz * vx - ux * vz;
		fn[t * 3 + 2] = ux * vy - uy * vx;
	}
	const unit = (t: number): V3 => {
		const l = Math.hypot(fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]) || 1;
		return [fn[t * 3] / l, fn[t * 3 + 1] / l, fn[t * 3 + 2] / l];
	};
	// faces per vertex
	const start = new Uint32Array(nv + 1);
	for (let k = 0; k < I.length; k++) start[I[k] + 1]++;
	for (let v = 0; v < nv; v++) start[v + 1] += start[v];
	const fill = start.slice(0, nv);
	const faces = new Uint32Array(I.length);
	for (let k = 0; k < I.length; k++) faces[fill[I[k]]++] = (k / 3) | 0;
	const cos = Math.cos((angle * Math.PI) / 180);
	const out: { src: number; n: V3 }[] = [];
	const corner = new Uint32Array(I.length);
	for (let v = 0; v < nv; v++) {
		const list = Array.from(faces.subarray(start[v], start[v + 1]));
		const groups: { n: V3; sum: V3; tris: number[] }[] = [];
		for (const t of list) {
			const u = unit(t);
			let g = groups.find((q) => q.n[0] * u[0] + q.n[1] * u[1] + q.n[2] * u[2] > cos);
			if (!g) groups.push((g = { n: u, sum: [0, 0, 0], tris: [] }));
			g.sum = [g.sum[0] + fn[t * 3], g.sum[1] + fn[t * 3 + 1], g.sum[2] + fn[t * 3 + 2]];
			const l = Math.hypot(...g.sum) || 1;
			g.n = [g.sum[0] / l, g.sum[1] / l, g.sum[2] / l];
			g.tris.push(t);
		}
		if (groups.length <= 1) {
			const id = out.length;
			out.push({ src: v, n: [m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]] });
			for (const t of list) for (let k = 0; k < 3; k++) if (I[t * 3 + k] === v) corner[t * 3 + k] = id;
			continue;
		}
		for (const g of groups) {
			const id = out.length;
			out.push({ src: v, n: g.n });
			for (const t of g.tris) for (let k = 0; k < 3; k++) if (I[t * 3 + k] === v) corner[t * 3 + k] = id;
		}
	}
	const n = out.length;
	const pick = <T extends Float32Array | Uint16Array | Int32Array>(arr: T, comps: number, make: (len: number) => T): T => {
		const r = make(n * comps);
		for (let i = 0; i < n; i++) for (let c = 0; c < comps; c++) r[i * comps + c] = arr[out[i].src * comps + c];
		return r;
	};
	const normals = new Float32Array(n * 3);
	out.forEach((o, i) => normals.set(o.n, i * 3));
	return {
		...m,
		positions: pick(m.positions, 3, (l) => new Float32Array(l)),
		normals,
		colors: pick(m.colors, 3, (l) => new Float32Array(l)),
		ao: pick(m.ao, 1, (l) => new Float32Array(l)),
		vertPrim: pick(m.vertPrim, 1, (l) => new Int32Array(l)),
		joints: pick(m.joints, 4, (l) => new Uint16Array(l)),
		weights: pick(m.weights, 4, (l) => new Float32Array(l)),
		indices: corner,
		weld: Uint32Array.from(out.map((o) => (m.weld ? m.weld[o.src] : o.src)))
	};
}
