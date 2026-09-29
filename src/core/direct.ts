/**
 * Parts meshed directly instead of through the distance grid: thin sheets
 * (leaves, flags, sails, paper, cloth), which a grid could only show two cells
 * thick, and imported meshes kept as their own triangles. Their distance
 * functions still exist, so they attach, blend colours and get checked like
 * other parts; only the triangles come from here.
 */

import type { Prim } from './compile.js';
import { toWorld } from './compile.js';
import { meshTriangles } from './meshload.js';
import type { Shape } from './schema.js';
import type { V3 } from './math.js';

type Sheet = Extract<Shape, { type: 'sheet' }>;

export interface SheetSpec {
	w: number;
	h: number;
	t: number;
	/** total bend in radians around local X (the sheet curls toward +Z) */
	bend: number;
	waveA: number;
	waveL: number;
}

export function sheetSpec(s: Sheet): SheetSpec {
	return {
		w: s.size[0],
		h: s.size[1],
		t: s.thickness ?? 0.004,
		bend: ((s.bend ?? 0) * Math.PI) / 180,
		waveA: s.wave?.amplitude ?? 0,
		waveL: s.wave?.length ?? 0.5
	};
}

/** The sheet's mid-surface at (u, v), u across (X), v along (Y). */
function surface(sp: SheetSpec, u: number, v: number): V3 {
	const wave = sp.waveA ? sp.waveA * Math.sin((2 * Math.PI * u) / sp.waveL) : 0;
	if (Math.abs(sp.bend) < 1e-4) return [u, v, wave];
	const R = sp.h / sp.bend;
	const a = v / R;
	// bent around X: the offset (wave) lies along the arc's normal
	const ny = -Math.sin(a), nz = Math.cos(a);
	return [u, R * Math.sin(a) + wave * ny, R * (1 - Math.cos(a)) + wave * nz];
}

/** Distance to the sheet (approximate for bends and waves, exact for a flat sheet). */
export function sheetDist(x: number, y: number, z: number, sp: SheetSpec): number {
	const dx = Math.max(Math.abs(x) - sp.w / 2, 0);
	let dSurf: number;
	if (Math.abs(sp.bend) < 1e-4) {
		const wave = sp.waveA ? sp.waveA * Math.sin((2 * Math.PI * x) / sp.waveL) : 0;
		const slope = sp.waveA ? (2 * Math.PI * sp.waveA) / sp.waveL : 0;
		const dy = Math.max(Math.abs(y) - sp.h / 2, 0);
		const dz = Math.abs(z - wave) / Math.sqrt(1 + slope * slope);
		dSurf = Math.hypot(dy, dz);
	} else {
		// closest point on the arc: the centre of the bend is at (y = 0, z = R); a negative bend curls to -Z
		const R = sp.h / sp.bend, sg = Math.sign(R), half = Math.abs(sp.bend) / 2;
		const a = Math.max(-half, Math.min(half, Math.atan2(y * sg, (R - z) * sg)));
		const cy = R * Math.sin(a), cz = R * (1 - Math.cos(a));
		dSurf = Math.hypot(y - cy, z - cz);
		// a wave on a bent sheet: stay on the safe side by its amplitude
		if (sp.waveA) dSurf = Math.max(0, dSurf - Math.abs(sp.waveA));
	}
	return Math.hypot(dx, dSurf) - sp.t / 2;
}

export function sheetBounds(sp: SheetSpec): { min: V3; max: V3 } {
	const pad = sp.t / 2 + Math.abs(sp.waveA);
	if (Math.abs(sp.bend) < 1e-4) return { min: [-sp.w / 2, -sp.h / 2, -pad], max: [sp.w / 2, sp.h / 2, pad] };
	let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
	for (let i = 0; i <= 32; i++) {
		const p = surface({ ...sp, waveA: 0 }, 0, -sp.h / 2 + (sp.h * i) / 32);
		minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
		minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
	}
	return { min: [-sp.w / 2, minY - pad, minZ - pad], max: [sp.w / 2, maxY + pad, maxZ + pad] };
}

/**
 * Triangles for a direct part, in world space. A sheet is a front, a back
 * (thickness apart) and a thin rim, so it is closed; a kept mesh is the file's
 * triangles placed like the part.
 */
export function directMesh(pr: Prim, cell: number): { positions: Float32Array; indices: Uint32Array; sharp: boolean } | null {
	const s = pr.part.shape;
	let local: { positions: number[]; indices: number[] } | null = null;
	let sharp = false;
	if (s.type === 'sheet') local = sheetLocal(sheetSpec(s), cell / Math.max(pr.scl[0], pr.scl[1], 1e-6));
	else if (s.type === 'mesh' && s.keep) {
		const m = meshTriangles(s.src, s.size);
		local = { positions: Array.from(m.positions), indices: Array.from(m.indices) };
		sharp = true;
	}
	if (!local) return null;
	const n = local.positions.length / 3;
	const positions = new Float32Array(n * 3);
	for (let v = 0; v < n; v++) {
		const w = toWorld(pr, [local.positions[v * 3], local.positions[v * 3 + 1], local.positions[v * 3 + 2]]);
		positions.set(w, v * 3);
	}
	const indices = Uint32Array.from(local.indices);
	// a mirrored twin is reflected: flip the winding so its faces still point out
	if (pr.flipX) for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
	return { positions, indices, sharp };
}

function sheetLocal(sp: SheetSpec, cell: number): { positions: number[]; indices: number[] } {
	// enough rows for the bend and the wave, and enough cells that patterns show in vertex colours
	const nu = Math.min(96, Math.max(1, Math.ceil(sp.w / (cell * 2)), sp.waveA ? Math.ceil((sp.w / sp.waveL) * 12) : 1));
	const nv = Math.min(96, Math.max(1, Math.ceil(sp.h / (cell * 2)), Math.ceil(Math.abs(sp.bend) / (Math.PI / 24))));
	const pos: number[] = [], idx: number[] = [];
	const normalAt = (u: number, v: number): V3 => {
		const e = 1e-4 * Math.max(sp.w, sp.h);
		const a = surface(sp, u + e, v), b = surface(sp, u - e, v), c = surface(sp, u, v + e), d = surface(sp, u, v - e);
		const du: V3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dv: V3 = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
		const nx = du[1] * dv[2] - du[2] * dv[1], ny = du[2] * dv[0] - du[0] * dv[2], nz = du[0] * dv[1] - du[1] * dv[0];
		const l = Math.hypot(nx, ny, nz) || 1;
		return [nx / l, ny / l, nz / l];
	};
	const grid = (side: 1 | -1) => {
		const base = pos.length / 3;
		for (let j = 0; j <= nv; j++)
			for (let i = 0; i <= nu; i++) {
				const u = -sp.w / 2 + (sp.w * i) / nu, v = -sp.h / 2 + (sp.h * j) / nv;
				const p = surface(sp, u, v), n = normalAt(u, v);
				pos.push(p[0] + n[0] * side * sp.t / 2, p[1] + n[1] * side * sp.t / 2, p[2] + n[2] * side * sp.t / 2);
			}
		const at = (i: number, j: number) => base + j * (nu + 1) + i;
		for (let j = 0; j < nv; j++)
			for (let i = 0; i < nu; i++) {
				const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
				if (side > 0) idx.push(a, b, c, a, c, d);
				else idx.push(a, c, b, a, d, c);
			}
		return at;
	};
	const front = grid(1), back = grid(-1);
	// the rim joins the two faces around the edge
	const ring: [number, number][] = [];
	for (let i = 0; i < nu; i++) ring.push([i, 0]);
	for (let j = 0; j < nv; j++) ring.push([nu, j]);
	for (let i = nu; i > 0; i--) ring.push([i, nv]);
	for (let j = nv; j > 0; j--) ring.push([0, j]);
	for (let k = 0; k < ring.length; k++) {
		const [i0, j0] = ring[k], [i1, j1] = ring[(k + 1) % ring.length];
		const a = front(i0, j0), b = front(i1, j1), c = back(i1, j1), d = back(i0, j0);
		idx.push(a, d, c, a, c, b);
	}
	return { positions: pos, indices: idx };
}

/** Area-weighted vertex normals from the triangles. */
export function geometricNormals(P: Float32Array, I: Uint32Array): Float32Array {
	const N = new Float32Array(P.length);
	for (let t = 0; t < I.length; t += 3) {
		const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
		const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
		const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		for (const k of [a, b, c]) {
			N[k] += nx;
			N[k + 1] += ny;
			N[k + 2] += nz;
		}
	}
	for (let v = 0; v < N.length; v += 3) {
		const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1;
		N[v] /= l;
		N[v + 1] /= l;
		N[v + 2] /= l;
	}
	return N;
}
