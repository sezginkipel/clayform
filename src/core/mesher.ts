/**
 * Surface nets over a sampled distance field, with optional dual contouring.
 *
 * Both share the same topology (one vertex per cell with a sign change, one
 * quad per crossing edge). Surface nets put the vertex at the average of the
 * edge crossings, which rounds every edge to the cell size. Dual contouring
 * instead solves a tiny least-squares problem (QEF) from the crossings and the
 * field normals there, so vertices land on edges and corners.
 *
 * The grid is split into 4³ blocks. For each block the caller returns an
 * evaluator restricted to the primitives that can reach it (or null when
 * nothing can), and blocks whose center is far from any surface are filled
 * with a single value. Only the thin shell around the surface is sampled
 * densely.
 */

import type { V3 } from './math.js';

export type Eval = (x: number, y: number, z: number) => number;

export interface MeshField {
	min: V3;
	max: V3;
	/** Conservative Lipschitz bound of the field. */
	lip: number;
	/** Evaluator valid inside [bmin, bmax] (+ its local Lipschitz bound), or null if the region is certainly outside. */
	block(bmin: V3, bmax: V3): { ev: Eval; lip: number } | null;
}

export interface RawMesh {
	positions: Float32Array;
	indices: Uint32Array;
	cell: number;
	samples: number;
}

const B = 4;

const EDGES: [number, number][] = [
	[0, 1], [2, 3], [4, 5], [6, 7],
	[0, 2], [1, 3], [4, 6], [5, 7],
	[0, 4], [1, 5], [2, 6], [3, 7]
];

export interface NetsOptions {
	/** Field normal at a world point. When given, vertices are placed by dual contouring. */
	normal?: (x: number, y: number, z: number) => V3;
	/** A grid already sampled (e.g. by workers with sampleSlab), with its dense-block flags. */
	vals?: { vals: Float32Array; dense: Uint8Array; samples: number };
}

/** Solve (AᵀA + λI) y = Aᵀb for a symmetric 3×3 matrix (Cramer). */
function solve3(a: number[], b: number[], lambda: number): V3 {
	const m00 = a[0] + lambda, m01 = a[1], m02 = a[2], m11 = a[3] + lambda, m12 = a[4], m22 = a[5] + lambda;
	const c00 = m11 * m22 - m12 * m12, c01 = m02 * m12 - m01 * m22, c02 = m01 * m12 - m02 * m11;
	const det = m00 * c00 + m01 * c01 + m02 * c02;
	if (Math.abs(det) < 1e-12) return [0, 0, 0];
	const c11 = m00 * m22 - m02 * m02, c12 = m01 * m02 - m00 * m12, c22 = m00 * m11 - m01 * m01;
	return [
		(c00 * b[0] + c01 * b[1] + c02 * b[2]) / det,
		(c01 * b[0] + c11 * b[1] + c12 * b[2]) / det,
		(c02 * b[0] + c12 * b[1] + c22 * b[2]) / det
	];
}

export function gridDims(f: MeshField, cell: number): [number, number, number] {
	return [
		Math.max(2, Math.ceil((f.max[0] - f.min[0]) / cell) + 1),
		Math.max(2, Math.ceil((f.max[1] - f.min[1]) / cell) + 1),
		Math.max(2, Math.ceil((f.max[2] - f.min[2]) / cell) + 1)
	];
}

/** Number of block layers along Z (the unit work is split by). */
export function blockLayers(f: MeshField, cell: number): number {
	return Math.ceil(gridDims(f, cell)[2] / B);
}

/**
 * Sample the grid for block layers [l0, l1) along Z. Returns just that slab
 * (grid rows l0·B … min(l1·B, nz) − 1), so several workers can fill one grid.
 */
export interface Slab {
	vals: Float32Array;
	/** 1 for blocks sampled point by point (only those can hold the surface) */
	dense: Uint8Array;
	k0: number;
	samples: number;
}

export function blockCounts(f: MeshField, cell: number): [number, number, number] {
	const [nx, ny, nz] = gridDims(f, cell);
	return [Math.ceil(nx / B), Math.ceil(ny / B), Math.ceil(nz / B)];
}

export function sampleSlab(f: MeshField, cell: number, l0: number, l1: number): Slab {
	const [nx, ny, nz] = gridDims(f, cell);
	const k0 = l0 * B, k1 = Math.min(l1 * B, nz);
	const [ox, oy, oz] = f.min;
	const vals = new Float32Array(nx * ny * Math.max(0, k1 - k0));
	const [bx, by] = blockCounts(f, cell);
	const dense = new Uint8Array(bx * by * Math.max(0, l1 - l0));
	const at = (i: number, j: number, k: number) => i + nx * (j + ny * (k - k0));
	let samples = 0;
	const margin = cell * 2;
	const halfDiag = (Math.sqrt(3) * B * cell) / 2;
	for (let bk = k0; bk < k1; bk += B)
		for (let bj = 0; bj < ny; bj += B)
			for (let bi = 0; bi < nx; bi += B) {
				const ie = Math.min(bi + B, nx), je = Math.min(bj + B, ny), ke = Math.min(bk + B, nz);
				const bmin: V3 = [ox + bi * cell - margin, oy + bj * cell - margin, oz + bk * cell - margin];
				const bmax: V3 = [ox + (ie - 1) * cell + margin, oy + (je - 1) * cell + margin, oz + (ke - 1) * cell + margin];
				const blk = f.block(bmin, bmax);
				if (!blk) {
					for (let k = bk; k < ke; k++) for (let j = bj; j < je; j++) for (let i = bi; i < ie; i++) vals[at(i, j, k)] = 1e3;
					continue;
				}
				const cx = ox + ((bi + ie - 1) / 2) * cell, cy = oy + ((bj + je - 1) / 2) * cell, cz = oz + ((bk + ke - 1) / 2) * cell;
				const ev = blk.ev;
				const dc = ev(cx, cy, cz);
				samples++;
				if (Math.abs(dc) > halfDiag * blk.lip + margin) {
					for (let k = bk; k < ke; k++) for (let j = bj; j < je; j++) for (let i = bi; i < ie; i++) vals[at(i, j, k)] = dc;
					continue;
				}
				for (let k = bk; k < ke; k++) {
					const z = oz + k * cell;
					for (let j = bj; j < je; j++) {
						const y = oy + j * cell;
						for (let i = bi; i < ie; i++) vals[at(i, j, k)] = ev(ox + i * cell, y, z);
					}
				}
				dense[bi / B + bx * (bj / B + by * (bk / B - l0))] = 1;
				samples += (ie - bi) * (je - bj) * (ke - bk);
			}
	return { vals, dense, k0, samples };
}

export function surfaceNets(f: MeshField, cell: number, opts: NetsOptions = {}): RawMesh {
	let vals: Float32Array, samples: number, dense: Uint8Array;
	if (opts.vals) {
		({ vals, dense, samples } = opts.vals);
	} else {
		({ vals, dense, samples } = sampleSlab(f, cell, 0, blockLayers(f, cell)));
	}
	const blocks = denseBlocks(dense);
	const placed = placeVertices(f, cell, vals, blocks, opts.normal);
	return { ...connect(f, cell, vals, blocks, placed), samples };
}

/**
 * Blocks filled with one value are at least two cells from any surface, so no
 * sign change can start there: only densely sampled blocks are visited.
 */
export function denseBlocks(dense: Uint8Array): number[] {
	const out: number[] = [];
	for (let q = 0; q < dense.length; q++) if (dense[q]) out.push(q);
	return out;
}

export interface Placed {
	/** grid cell index of each vertex */
	cells: Int32Array;
	positions: Float32Array;
}

/**
 * One vertex per cell with a sign change, for the cells of `blocks`. Each block
 * is independent, so ranges of blocks can be placed in parallel and
 * concatenated in order.
 */
export function placeVertices(f: MeshField, cell: number, vals: Float32Array, blocks: number[], normal?: (x: number, y: number, z: number) => V3): Placed {
	const opts = { normal };
	const [nx, ny, nz] = gridDims(f, cell);
	const [ox, oy, oz] = f.min;
	const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
	const [bx, by] = blockCounts(f, cell);
	const cx = nx - 1, cy = ny - 1, cz = nz - 1;
	const cellsOut: number[] = [];
	const pos: number[] = [];
	const corner = new Float32Array(8);
	const crossings: number[] = [];
	for (const q of blocks) {
		const bi = (q % bx) * B, bj = (Math.floor(q / bx) % by) * B, bk = Math.floor(q / (bx * by)) * B;
		for (let k = bk; k < Math.min(bk + B, cz); k++)
		for (let j = bj; j < Math.min(bj + B, cy); j++)
			for (let i = bi; i < Math.min(bi + B, cx); i++) {
				let mask = 0;
				for (let c = 0; c < 8; c++) {
					const v = vals[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
					corner[c] = v;
					if (v < 0) mask |= 1 << c;
				}
				if (mask === 0 || mask === 255) continue;
				let sx = 0, sy = 0, sz = 0, n = 0;
				crossings.length = 0;
				for (const [a, b] of EDGES) {
					const va = corner[a], vb = corner[b];
					if (va < 0 === vb < 0) continue;
					const t = va / (va - vb);
					const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1;
					const bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1;
					const px = ax + (bx - ax) * t, py = ay + (by - ay) * t, pz = az + (bz - az) * t;
					sx += px;
					sy += py;
					sz += pz;
					n++;
					if (opts.normal) crossings.push(px, py, pz);
				}
				let vx = sx / n, vy = sy / n, vz = sz / n;
				if (opts.normal) {
					// QEF in cell units around the mass point: minimize Σ (nᵢ·(x − pᵢ))² + λ|x − m|²
					const ata = [0, 0, 0, 0, 0, 0], atb = [0, 0, 0];
					for (let c = 0; c < crossings.length; c += 3) {
						const px = crossings[c], py = crossings[c + 1], pz = crossings[c + 2];
						const nn = opts.normal(ox + (i + px) * cell, oy + (j + py) * cell, oz + (k + pz) * cell);
						const d = nn[0] * (px - vx) + nn[1] * (py - vy) + nn[2] * (pz - vz);
						ata[0] += nn[0] * nn[0]; ata[1] += nn[0] * nn[1]; ata[2] += nn[0] * nn[2];
						ata[3] += nn[1] * nn[1]; ata[4] += nn[1] * nn[2]; ata[5] += nn[2] * nn[2];
						atb[0] += nn[0] * d; atb[1] += nn[1] * d; atb[2] += nn[2] * d;
					}
					const y = solve3(ata, atb, 0.05);
					vx = Math.min(1, Math.max(0, vx + y[0]));
					vy = Math.min(1, Math.max(0, vy + y[1]));
					vz = Math.min(1, Math.max(0, vz + y[2]));
				}
				cellsOut.push(i + cx * (j + cy * k));
				pos.push(ox + (i + vx) * cell, oy + (j + vy) * cell, oz + (k + vz) * cell);
			}
	}
	return { cells: Int32Array.from(cellsOut), positions: new Float32Array(pos) };
}

/** Quads between the placed vertices, one per grid edge with a sign change. */
export function connect(f: MeshField, cell: number, vals: Float32Array, blocks: number[], placed: Placed): { positions: Float32Array; indices: Uint32Array; cell: number } {
	const [nx, ny, nz] = gridDims(f, cell);
	const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
	const [bx, by] = blockCounts(f, cell);
	const cx = nx - 1, cy = ny - 1, cz = nz - 1;
	const cellVert = new Int32Array(cx * cy * cz).fill(-1);
	for (let n = 0; n < placed.cells.length; n++) cellVert[placed.cells[n]] = n;
	const pos = placed.positions;
	const idx: number[] = [];
	const cv = (i: number, j: number, k: number) => cellVert[i + cx * (j + cy * k)];
	const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
		if (a < 0 || b < 0 || c < 0 || d < 0) return;
		if (flip) [b, d] = [d, b];
		const dac = (pos[a * 3] - pos[c * 3]) ** 2 + (pos[a * 3 + 1] - pos[c * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[c * 3 + 2]) ** 2;
		const dbd = (pos[b * 3] - pos[d * 3]) ** 2 + (pos[b * 3 + 1] - pos[d * 3 + 1]) ** 2 + (pos[b * 3 + 2] - pos[d * 3 + 2]) ** 2;
		if (dac <= dbd) idx.push(a, b, c, a, c, d);
		else idx.push(a, b, d, b, c, d);
	};

	for (const q of blocks) {
		const bi = (q % bx) * B, bj = (Math.floor(q / bx) % by) * B, bk = Math.floor(q / (bx * by)) * B;
		for (let k = bk; k < Math.min(bk + B, nz); k++)
		for (let j = bj; j < Math.min(bj + B, ny); j++)
			for (let i = bi; i < Math.min(bi + B, nx); i++) {
				const v0 = vals[at(i, j, k)];
				const in0 = v0 < 0;
				// X edge
				if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1) {
					const in1 = vals[at(i + 1, j, k)] < 0;
					if (in0 !== in1) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !in0);
				}
				// Y edge
				if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1) {
					const in1 = vals[at(i, j + 1, k)] < 0;
					if (in0 !== in1) quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !in0);
				}
				// Z edge
				if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) {
					const in1 = vals[at(i, j, k + 1)] < 0;
					if (in0 !== in1) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !in0);
				}
			}
	}

	return { positions: pos, indices: new Uint32Array(idx), cell };
}
