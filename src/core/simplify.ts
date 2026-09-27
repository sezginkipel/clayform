/**
 * Game-ready triangle counts. Surface nets spends as many triangles on a flat
 * wall as on a nose; quadric simplification (meshoptimizer) removes the
 * redundant ones while keeping color seams, normals and material borders.
 */

import { MeshoptSimplifier } from 'meshoptimizer';
import type { Build, MeshData } from './build.js';

export interface SimplifyOptions {
	/** total triangle target across all meshes */
	triangles?: number;
	/** max geometric error relative to the model size (default 0.004 = 0.4%) */
	error?: number;
}

export async function simplifyBuild(b: Build, o: SimplifyOptions = {}): Promise<Build> {
	await MeshoptSimplifier.ready;
	const total = b.stats.triangles;
	const error = o.error ?? (o.triangles ? 0.05 : 0.004);
	const prims = b.compiled.prims;
	const meshes = b.meshes.map((m) => {
		const tris = m.indices.length / 3;
		const share = o.triangles ? Math.max(12, Math.floor((o.triangles * tris) / Math.max(1, total))) : 0;
		return simplifyMesh(m, share, error, prims);
	});
	let triangles = 0, vertices = 0;
	for (const m of meshes) {
		triangles += m.indices.length / 3;
		vertices += m.positions.length / 3;
	}
	return { ...b, meshes, stats: { ...b.stats, triangles, vertices } };
}

function simplifyMesh(m: MeshData, targetTris: number, error: number, prims: Build['compiled']['prims']): MeshData {
	const n = m.positions.length / 3;
	if (n < 16) return m;
	const A = 9;
	const attrs = new Float32Array(n * A);
	for (let v = 0; v < n; v++) {
		const p = prims[m.vertPrim[v]];
		attrs.set([m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2], m.colors[v * 3], m.colors[v * 3 + 1], m.colors[v * 3 + 2], p?.roughness ?? 0.75, p?.metalness ?? 0, p?.emissive ? 1 : 0], v * A);
	}
	const idx = new Uint32Array(m.indices);
	const [out] = MeshoptSimplifier.simplifyWithAttributes(
		idx, m.positions, 3, attrs, A, [0.35, 0.35, 0.35, 1.2, 1.2, 1.2, 1.5, 1.5, 3],
		null, Math.max(3, Math.floor(targetTris) * 3), error, ['Prune']
	);
	if (out.length >= m.indices.length) return m;
	const [remap, unique] = MeshoptSimplifier.compactMesh(out);
	const P = new Float32Array(unique * 3), N = new Float32Array(unique * 3), C = new Float32Array(unique * 3);
	const AO = new Float32Array(unique), VP = new Int32Array(unique), J = new Uint16Array(unique * 4), W = new Float32Array(unique * 4);
	for (let v = 0; v < n; v++) {
		const r = remap[v];
		if (r === 0xffffffff || r >= unique) continue;
		for (let k = 0; k < 3; k++) {
			P[r * 3 + k] = m.positions[v * 3 + k];
			N[r * 3 + k] = m.normals[v * 3 + k];
			C[r * 3 + k] = m.colors[v * 3 + k];
		}
		AO[r] = m.ao[v];
		VP[r] = m.vertPrim[v];
		for (let k = 0; k < 4; k++) {
			J[r * 4 + k] = m.joints[v * 4 + k];
			W[r * 4 + k] = m.weights[v * 4 + k];
		}
	}
	const TP = new Int32Array(out.length / 3);
	for (let t = 0; t < TP.length; t++) {
		const a = VP[out[t * 3]], b = VP[out[t * 3 + 1]], c = VP[out[t * 3 + 2]];
		TP[t] = a === b || a === c ? a : b === c ? b : a;
	}
	return { ...m, positions: P, normals: N, colors: C, ao: AO, vertPrim: VP, joints: J, weights: W, indices: out, triPrim: TP };
}
