/**
 * Surface nets (a simple dual contouring) over a sampled distance field.
 *
 * The grid is split into 8³ blocks. For each block the caller returns an
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

export function surfaceNets(f: MeshField, cell: number): RawMesh {
	const nx = Math.max(2, Math.ceil((f.max[0] - f.min[0]) / cell) + 1);
	const ny = Math.max(2, Math.ceil((f.max[1] - f.min[1]) / cell) + 1);
	const nz = Math.max(2, Math.ceil((f.max[2] - f.min[2]) / cell) + 1);
	const [ox, oy, oz] = f.min;
	const vals = new Float32Array(nx * ny * nz);
	const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
	let samples = 0;

	const margin = cell * 2;
	const halfDiag = (Math.sqrt(3) * B * cell) / 2;
	for (let bk = 0; bk < nz; bk += B)
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
				samples += (ie - bi) * (je - bj) * (ke - bk);
			}

	// vertices: one per cell with a sign change
	const cx = nx - 1, cy = ny - 1, cz = nz - 1;
	const cellVert = new Int32Array(cx * cy * cz).fill(-1);
	const pos: number[] = [];
	const corner = new Float32Array(8);
	for (let k = 0; k < cz; k++)
		for (let j = 0; j < cy; j++)
			for (let i = 0; i < cx; i++) {
				let mask = 0;
				for (let c = 0; c < 8; c++) {
					const v = vals[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
					corner[c] = v;
					if (v < 0) mask |= 1 << c;
				}
				if (mask === 0 || mask === 255) continue;
				let sx = 0, sy = 0, sz = 0, n = 0;
				for (const [a, b] of EDGES) {
					const va = corner[a], vb = corner[b];
					if (va < 0 === vb < 0) continue;
					const t = va / (va - vb);
					const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1;
					const bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1;
					sx += ax + (bx - ax) * t;
					sy += ay + (by - ay) * t;
					sz += az + (bz - az) * t;
					n++;
				}
				cellVert[i + cx * (j + cy * k)] = pos.length / 3;
				pos.push(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (k + sz / n) * cell);
			}

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

	for (let k = 0; k < nz; k++)
		for (let j = 0; j < ny; j++)
			for (let i = 0; i < nx; i++) {
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

	return { positions: new Float32Array(pos), indices: new Uint32Array(idx), cell, samples };
}
