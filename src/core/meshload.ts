/**
 * Imported meshes as parts. A GLB or OBJ is read into triangles, then baked
 * once into a signed distance grid so it behaves like any other part: it
 * blends, carves, anchors, mirrors and goes through the critics.
 *
 * Sign comes from a flood fill: grid points reachable from the outside
 * without crossing the surface are outside, the rest are inside. Points in
 * the thin band next to the surface take the sign of the nearest face.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileRoot, userPath } from './files.js';
import { m4Compose, m4Identity, m4Mul, type M4 } from './math.js';

export interface TriMesh {
	positions: Float32Array;
	indices: Uint32Array;
	min: [number, number, number];
	max: [number, number, number];
}

export interface MeshField {
	/** local distance function (mesh units after normalization) */
	sdf: (x: number, y: number, z: number) => number;
	min: [number, number, number];
	max: [number, number, number];
	closed: boolean;
	triangles: number;
}

/* ---------------------------------------------------------------- paths */

export function resolveAsset(src: string): string {
	// a hosted session reads only inside its workspace
	if (fileRoot()) return userPath(src);
	if (isAbsolute(src)) return src;
	const tries = [resolve(src)];
	if (process.env.CLAYFORM_WORKSPACE) tries.push(join(resolve(process.env.CLAYFORM_WORKSPACE), src));
	tries.push(join(resolve('.clayform'), src));
	return tries.find((p) => existsSync(p)) ?? tries[0];
}

/* -------------------------------------------------------------- loaders */

export function loadTriMesh(path: string): TriMesh {
	const file = resolveAsset(path);
	if (!existsSync(file)) throw new Error(`mesh file not found: ${path} (looked in ${file}) — give an absolute path or one relative to where the server runs`);
	const lower = file.toLowerCase();
	if (lower.endsWith('.glb')) return readGlb(new Uint8Array(readFileSync(file)));
	if (lower.endsWith('.obj')) return readObj(readFileSync(file, 'utf8'));
	throw new Error(`unsupported mesh format for ${path} — use .glb or .obj`);
}

function finish(pos: number[], idx: number[]): TriMesh {
	if (!idx.length) throw new Error('the mesh has no triangles');
	const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < pos.length; i += 3)
		for (let a = 0; a < 3; a++) {
			min[a] = Math.min(min[a], pos[i + a]);
			max[a] = Math.max(max[a], pos[i + a]);
		}
	return { positions: new Float32Array(pos), indices: new Uint32Array(idx), min, max };
}

export function readObj(text: string): TriMesh {
	const v: number[] = [];
	const idx: number[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith('v ')) {
			const p = line.split(/\s+/);
			v.push(+p[1], +p[2], +p[3]);
		} else if (line.startsWith('f ')) {
			const n = v.length / 3;
			const f = line.split(/\s+/).slice(1).map((t) => {
				const i = parseInt(t.split('/')[0], 10);
				return i < 0 ? n + i : i - 1;
			});
			for (let k = 1; k < f.length - 1; k++) idx.push(f[0], f[k], f[k + 1]);
		}
	}
	return finish(v, idx);
}

export function readGlb(bytes: Uint8Array): TriMesh {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file (bad magic)');
	let off = 12;
	let json: Record<string, any> | null = null;
	let bin: Uint8Array | null = null;
	while (off < bytes.byteLength) {
		const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
		const body = bytes.subarray(off + 8, off + 8 + len);
		if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
		else if (type === 0x004e4942) bin = body;
		off += 8 + len;
	}
	if (!json) throw new Error('GLB has no JSON chunk');
	const used: string[] = json.extensionsRequired ?? [];
	const bad = used.filter((e) => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(e));
	if (bad.length) throw new Error(`GLB uses ${bad.join(', ')} — export it without compression/quantization`);
	const acc = (i: number): { data: ArrayLike<number>; comps: number } => {
		const a = json!.accessors[i];
		const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as string] ?? 1;
		const bv = json!.bufferViews[a.bufferView];
		if (!bin || bv.buffer !== 0) throw new Error('GLB accessor points outside the binary chunk (external buffers are not supported)');
		const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType as number];
		if (!size) throw new Error(`unsupported accessor component type ${a.componentType}`);
		const stride = bv.byteStride ?? size * comps;
		const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
		const out = new Float64Array(a.count * comps);
		const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
		for (let e = 0; e < a.count; e++)
			for (let c = 0; c < comps; c++) {
				const o = base + e * stride + c * size;
				out[e * comps + c] = a.componentType === 5126 ? view.getFloat32(o, true) : a.componentType === 5125 ? view.getUint32(o, true) : a.componentType === 5123 ? view.getUint16(o, true) : view.getUint8(o);
			}
		return { data: out, comps };
	};
	const pos: number[] = [];
	const idx: number[] = [];
	const nodes: any[] = json.nodes ?? [];
	const local = (n: any): M4 => {
		if (n.matrix) return n.matrix as M4;
		return m4Compose(n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]);
	};
	const visit = (i: number, parent: M4) => {
		const n = nodes[i];
		const m = m4Mul(parent, local(n));
		// skinned meshes are placed by their skeleton; use the bind pose as authored
		if (n.mesh !== undefined) {
			for (const prim of json!.meshes[n.mesh].primitives) {
				if ((prim.mode ?? 4) !== 4) continue;
				if (prim.attributes?.POSITION === undefined) continue;
				const p = acc(prim.attributes.POSITION);
				const base = pos.length / 3;
				const M = n.skin !== undefined ? m4Identity() : m;
				for (let e = 0; e < p.data.length / 3; e++) {
					const x = p.data[e * 3], y = p.data[e * 3 + 1], z = p.data[e * 3 + 2];
					pos.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
				}
				if (prim.indices !== undefined) {
					const ix = acc(prim.indices).data;
					for (let k = 0; k < ix.length; k++) idx.push(base + ix[k]);
				} else for (let k = 0; k < p.data.length / 3; k++) idx.push(base + k);
			}
		}
		for (const c of n.children ?? []) visit(c, m);
	};
	const scene = json.scenes?.[json.scene ?? 0];
	const roots: number[] = scene?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((n) => (n.children ?? []).includes(i)));
	for (const r of roots) visit(r, m4Identity());
	return finish(pos, idx);
}

/* ------------------------------------------------------------------ BVH */

interface Node {
	min: number[];
	max: number[];
	left: number;
	right: number;
	start: number;
	count: number;
}

class Bvh {
	nodes: Node[] = [];
	order: Uint32Array;
	constructor(private P: Float32Array, private I: Uint32Array) {
		const n = I.length / 3;
		this.order = new Uint32Array(n);
		for (let i = 0; i < n; i++) this.order[i] = i;
		const cent = new Float32Array(n * 3);
		for (let t = 0; t < n; t++)
			for (let a = 0; a < 3; a++) cent[t * 3 + a] = (P[I[t * 3] * 3 + a] + P[I[t * 3 + 1] * 3 + a] + P[I[t * 3 + 2] * 3 + a]) / 3;
		this.build(0, n, cent);
	}
	private build(start: number, end: number, cent: Float32Array): number {
		const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
		for (let i = start; i < end; i++) {
			const t = this.order[i];
			for (let k = 0; k < 3; k++) {
				const v = this.I[t * 3 + k] * 3;
				for (let a = 0; a < 3; a++) {
					min[a] = Math.min(min[a], this.P[v + a]);
					max[a] = Math.max(max[a], this.P[v + a]);
				}
			}
		}
		const id = this.nodes.length;
		this.nodes.push({ min, max, left: -1, right: -1, start, count: end - start });
		if (end - start <= 6) return id;
		const ax = max[1] - min[1] > max[0] - min[0] ? (max[2] - min[2] > max[1] - min[1] ? 2 : 1) : max[2] - min[2] > max[0] - min[0] ? 2 : 0;
		const sub = Array.from(this.order.subarray(start, end)).sort((a, b) => cent[a * 3 + ax] - cent[b * 3 + ax]);
		this.order.set(sub, start);
		const mid = (start + end) >> 1;
		const l = this.build(start, mid, cent), r = this.build(mid, end, cent);
		this.nodes[id].left = l;
		this.nodes[id].right = r;
		this.nodes[id].count = 0;
		return id;
	}
	/** nearest distance² and the face normal's sign of (p - closest) */
	nearest(px: number, py: number, pz: number): { d2: number; side: number } {
		let best = Infinity, side = 1;
		const stack = [0];
		const P = this.P, I = this.I;
		while (stack.length) {
			const n = this.nodes[stack.pop()!];
			const dx = Math.max(n.min[0] - px, 0, px - n.max[0]), dy = Math.max(n.min[1] - py, 0, py - n.max[1]), dz = Math.max(n.min[2] - pz, 0, pz - n.max[2]);
			if (dx * dx + dy * dy + dz * dz >= best) continue;
			if (n.count) {
				for (let i = n.start; i < n.start + n.count; i++) {
					const t = this.order[i];
					const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
					const r = closest(px, py, pz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
					const d2 = (px - r[0]) ** 2 + (py - r[1]) ** 2 + (pz - r[2]) ** 2;
					if (d2 < best) {
						best = d2;
						// face normal
						const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
						const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
						const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
						side = (px - r[0]) * nx + (py - r[1]) * ny + (pz - r[2]) * nz >= 0 ? 1 : -1;
					}
				}
			} else stack.push(n.left, n.right);
		}
		return { d2: best, side };
	}
}

/** Closest point on triangle (Ericson, Real-Time Collision Detection 5.1.5). */
function closest(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): [number, number, number] {
	const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
	const apx = px - ax, apy = py - ay, apz = pz - az;
	const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
	if (d1 <= 0 && d2 <= 0) return [ax, ay, az];
	const bpx = px - bx, bpy = py - by, bpz = pz - bz;
	const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
	if (d3 >= 0 && d4 <= d3) return [bx, by, bz];
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const v = d1 / (d1 - d3);
		return [ax + abx * v, ay + aby * v, az + abz * v];
	}
	const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
	const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
	if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const w = d2 / (d2 - d6);
		return [ax + acx * w, ay + acy * w, az + acz * w];
	}
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
		return [bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w];
	}
	const denom = 1 / (va + vb + vc);
	const v = vb * denom, w = vc * denom;
	return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
}

/* ------------------------------------------------------------ SDF grid */

const cache = new Map<string, MeshField>();

/**
 * Load + normalize + bake. `size` scales the longest axis to that many
 * meters; the mesh is centered on its bounding box.
 */
export function meshField(src: string, size: number | undefined, res: number): MeshField {
	const file = resolveAsset(src);
	const key = `${file}|${existsSync(file) ? statSync(file).mtimeMs : 0}|${size ?? ''}|${res}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const m = loadTriMesh(src);
	const ext = [m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]];
	const longest = Math.max(...ext, 1e-9);
	const k = size ? size / longest : 1;
	const c = [(m.min[0] + m.max[0]) / 2, (m.min[1] + m.max[1]) / 2, (m.min[2] + m.max[2]) / 2];
	const P = new Float32Array(m.positions.length);
	for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] = (m.positions[i + a] - c[a]) * k;
	const half = ext.map((e) => (e * k) / 2);
	const f = bake(P, m.indices, half as [number, number, number], res);
	cache.set(key, f);
	return f;
}

function bake(P: Float32Array, I: Uint32Array, half: [number, number, number], res: number): MeshField {
	const longest = Math.max(...half) * 2;
	const cell = longest / res;
	const pad = cell * 3;
	const min: [number, number, number] = [-half[0] - pad, -half[1] - pad, -half[2] - pad];
	const n = [0, 1, 2].map((a) => Math.max(2, Math.ceil((half[a] * 2 + pad * 2) / cell) + 1));
	const [nx, ny, nz] = n;
	const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
	const dist = new Float32Array(nx * ny * nz);
	const side = new Int8Array(nx * ny * nz);
	const bvh = new Bvh(P, I);
	for (let k = 0; k < nz; k++)
		for (let j = 0; j < ny; j++)
			for (let i = 0; i < nx; i++) {
				const r = bvh.nearest(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
				dist[at(i, j, k)] = Math.sqrt(r.d2);
				side[at(i, j, k)] = r.side;
			}
	// flood the outside from the grid border without crossing the surface band
	const band = cell * 0.87;
	const outside = new Uint8Array(nx * ny * nz);
	const queue: number[] = [];
	const push = (i: number, j: number, k: number) => {
		const p = at(i, j, k);
		if (outside[p] || dist[p] <= band) return;
		outside[p] = 1;
		queue.push(p);
	};
	for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { push(0, j, k); push(nx - 1, j, k); }
	for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { push(i, 0, k); push(i, ny - 1, k); }
	for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { push(i, j, 0); push(i, j, nz - 1); }
	while (queue.length) {
		const p = queue.pop()!;
		const i = p % nx, j = Math.floor(p / nx) % ny, k = Math.floor(p / (nx * ny));
		if (i > 0) push(i - 1, j, k);
		if (i < nx - 1) push(i + 1, j, k);
		if (j > 0) push(i, j - 1, k);
		if (j < ny - 1) push(i, j + 1, k);
		if (k > 0) push(i, j, k - 1);
		if (k < nz - 1) push(i, j, k + 1);
	}
	const sd = new Float32Array(nx * ny * nz);
	let insideCount = 0;
	for (let p = 0; p < sd.length; p++) {
		const s = dist[p] <= band ? side[p] : outside[p] ? 1 : -1;
		if (s < 0 && dist[p] > band) insideCount++;
		sd[p] = s * dist[p];
	}
	// An open mesh leaks the flood inside: keep it as a thin shell instead of nothing.
	const closed = insideCount > 0;
	if (!closed) for (let p = 0; p < sd.length; p++) sd[p] = dist[p] - cell * 0.75;
	const max: [number, number, number] = [half[0], half[1], half[2]];
	const sdf = (x: number, y: number, z: number) => {
		const fx = (x - min[0]) / cell, fy = (y - min[1]) / cell, fz = (z - min[2]) / cell;
		const cx = Math.min(Math.max(fx, 0), nx - 1.001), cy = Math.min(Math.max(fy, 0), ny - 1.001), cz = Math.min(Math.max(fz, 0), nz - 1.001);
		const i = Math.floor(cx), j = Math.floor(cy), k = Math.floor(cz);
		const u = cx - i, v = cy - j, w = cz - k;
		const s = (a: number, b: number, c: number) => sd[at(i + a, j + b, k + c)];
		const x0 = s(0, 0, 0) + (s(1, 0, 0) - s(0, 0, 0)) * u, x1 = s(0, 1, 0) + (s(1, 1, 0) - s(0, 1, 0)) * u;
		const x2 = s(0, 0, 1) + (s(1, 0, 1) - s(0, 0, 1)) * u, x3 = s(0, 1, 1) + (s(1, 1, 1) - s(0, 1, 1)) * u;
		const y0 = x0 + (x1 - x0) * v, y1 = x2 + (x3 - x2) * v;
		const d = y0 + (y1 - y0) * w;
		// outside the grid: add the distance to it (stays a lower bound)
		const ox = (Math.abs(fx - cx) + Math.abs(fy - cy) + Math.abs(fz - cz)) > 0 ? Math.hypot((fx - cx) * cell, (fy - cy) * cell, (fz - cz) * cell) : 0;
		return d + ox;
	};
	return { sdf, min: [-half[0], -half[1], -half[2]], max, closed, triangles: I.length / 3 };
}
