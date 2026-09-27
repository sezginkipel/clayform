/**
 * Compiled scene → triangle meshes with the attributes every downstream
 * stage needs: normals, base color, ambient occlusion, dominant part per
 * triangle (materials, critics, the parts render) and skin weights (rig).
 */

import { add, clamp, type V3 } from './math.js';
import { bodyBase, bodyField, compile, primColor, primDist, worldAabb, type Compiled, type Prim } from './compile.js';
import { surfaceNets, type Eval, type MeshField } from './mesher.js';
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
}

export interface Build {
	compiled: Compiled;
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
}

const BLOCK = 4;

export function buildScene(scene: Scene, opts: BuildOptions = {}): Build {
	const t0 = performance.now();
	const c = compile(scene);
	const res = opts.resolution ?? scene.settings?.resolution ?? 96;
	const wantAo = opts.ao ?? scene.settings?.ao ?? true;
	const meshes: MeshData[] = [];
	let samples = 0;

	const adds = c.body.filter((p) => p.op === 'add');
	const visible = c.prims.filter((p) => !p.hidden && p.op === 'add');
	const all = worldAabb(visible.length ? visible : c.prims);
	const ext = all ? Math.max(all.max[0] - all.min[0], all.max[1] - all.min[1], all.max[2] - all.min[2]) : 1;
	let cell = Math.max(ext, 1e-3) / res;

	/* -------------------------------------------------------- fused body */
	if (adds.length) {
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
		const raw = surfaceNets(field, cell);
		samples += raw.samples;

		// attribute pass: lists for a vertex's block, grown by `reach` (cached per block)
		const blockSize = BLOCK * cell;
		const near = (x: number, y: number, z: number, reach: number): List | null => {
			const bi = Math.floor((x - min[0]) / blockSize), bj = Math.floor((y - min[1]) / blockSize), bk = Math.floor((z - min[2]) / blockSize);
			const bmin: V3 = [min[0] + bi * blockSize - reach, min[1] + bj * blockSize - reach, min[2] + bk * blockSize - reach];
			const bmax: V3 = [min[0] + (bi + 1) * blockSize + reach, min[1] + (bj + 1) * blockSize + reach, min[2] + (bk + 1) * blockSize + reach];
			return listFor(bmin, bmax);
		};
		meshes.push(attributes('body', raw.positions, raw.indices, cell, c, c.body, -1, near, (x, y, z) => bodyField(c, x, y, z), wantAo, ext));
	}

	/* ---------------------------------------------------- separate parts */
	for (const pr of c.prims) {
		if (!pr.separate || pr.hidden || pr.op !== 'add') continue;
		const e = Math.max(pr.max[0] - pr.min[0], pr.max[1] - pr.min[1], pr.max[2] - pr.min[2]);
		const sc = Math.min(cell, e / Math.max(20, res * 0.4));
		const pad = sc * 3;
		const f: Eval = (x, y, z) => primDist(pr, x, y, z);
		const field: MeshField = {
			min: [pr.min[0] - pad, pr.min[1] - pad, pr.min[2] - pad],
			max: [pr.max[0] + pad, pr.max[1] + pad, pr.max[2] + pad],
			lip: 1.25 + (pr.detail ? (5.5 * pr.detail.amount) / pr.detail.scale : 0),
			block: () => ({ ev: f, lip: 1.25 + (pr.detail ? (5.5 * pr.detail.amount) / pr.detail.scale : 0) })
		};
		const raw = surfaceNets(field, sc);
		samples += raw.samples;
		meshes.push(attributes(pr.id, raw.positions, raw.indices, sc, c, [pr], pr.index, () => null, f, wantAo, e));
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
		meshes,
		offset,
		min: isFinite(bmin[0]) ? bmin : [0, 0, 0],
		max: isFinite(bmax[0]) ? bmax : [0, 0, 0],
		cell,
		stats: { triangles, vertices, ms: Math.round(performance.now() - t0), samples }
	};
}

function attributes(
	name: string,
	positions: Float32Array,
	indices: Uint32Array,
	cell: number,
	c: Compiled,
	cands: Prim[],
	rigid: number,
	near: (x: number, y: number, z: number, reach: number) => { prims: Int32Array; sculpts: Int32Array } | null,
	field: Eval,
	wantAo: boolean,
	size: number
): MeshData {
	const n = positions.length / 3;
	const normals = new Float32Array(n * 3);
	const colors = new Float32Array(n * 3);
	const ao = new Float32Array(n).fill(1);
	const vertPrim = new Int32Array(n);
	const joints = new Uint16Array(n * 4);
	const weights = new Float32Array(n * 4);
	const h = cell * 0.5;
	const eps = (cell * 0.75) ** 2;
	const aoSteps = [0.02, 0.05, 0.1, 0.18].map((f) => Math.max(cell * 1.5, size * f));
	const w: number[] = [];
	const ids: number[] = [];

	for (let v = 0; v < n; v++) {
		const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
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
			if (pr.op === 'intersect') continue;
			if (pr.op === 'carve' && !pr.part.material?.color) continue;
			const raw = primDist(pr, x, y, z);
			const d = pr.op === 'carve' ? Math.abs(raw) : Math.max(0, raw);
			// a vertex well inside an added part lies on a carved cavity: the carve owns its color
			const inside = pr.op === 'add' && raw < -cell * 0.75 ? 0.02 : 1;
			w.push(inside / (d * d + eps));
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
		// color: weighted blend; dominant prim: max weight
		let tw = 0, r = 0, g = 0, b = 0, bi = 0;
		for (let j = 0; j < ids.length; j++) {
			const pr = c.prims[ids[j]];
			const col = primColor(pr, [x, y, z]);
			r += col[0] * w[j]; g += col[1] * w[j]; b += col[2] * w[j];
			tw += w[j];
			if (w[j] > w[bi]) bi = j;
		}
		colors[v * 3] = r / tw; colors[v * 3 + 1] = g / tw; colors[v * 3 + 2] = b / tw;
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

	const triPrim = new Int32Array(indices.length / 3);
	for (let t = 0; t < triPrim.length; t++) {
		const a = vertPrim[indices[t * 3]], b = vertPrim[indices[t * 3 + 1]], cc = vertPrim[indices[t * 3 + 2]];
		triPrim[t] = a === b || a === cc ? a : b === cc ? b : a;
	}
	return { name, positions, normals, colors, ao, indices, triPrim, vertPrim, joints, weights, prim: rigid };
}

/** World position after the ground offset. */
export function grounded(b: Build, p: V3): V3 {
	return add(p, b.offset);
}

export { bodyBase };
