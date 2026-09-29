/**
 * Game-ready triangle counts. Surface nets spends as many triangles on a flat
 * wall as on a nose; quadric simplification (meshoptimizer) removes the
 * redundant ones while keeping color seams, normals and material borders.
 *
 * Every mesh of a model is held to the same geometric error, measured against
 * the whole model's size: a wheel is not kept finer than the body just because
 * it is small. With a triangle budget, that shared error is raised step by
 * step until the model fits, so the budget goes where the shape needs it.
 */

import { MeshoptSimplifier } from 'meshoptimizer';
import { splitSharp, type Build, type MeshData } from './build.js';

export interface SimplifyOptions {
	/** total triangle target across all meshes */
	triangles?: number;
	/** max geometric error relative to the model size (default 0.004 = 0.4%, or 0.05 with a triangle target) */
	error?: number;
}

export interface SimplifyReport {
	/** the shared error the meshes were reduced to, relative to the model size */
	error: number;
	/** the budget could not be met within the error allowed */
	overBudget: boolean;
}

/** Attribute weights: normals, colour, roughness/metalness, emission. Colour seams (company paint) cost the most. */
const WEIGHTS = [0.35, 0.35, 0.35, 1.2, 1.2, 1.2, 1.5, 1.5, 3];
/** Sharp meshes get their normals recomputed from the faces afterwards, so the old ones barely count. */
const SHARP_WEIGHTS = [0.02, 0.02, 0.02, 1.2, 1.2, 1.2, 1.5, 1.5, 3];

export async function simplifyBuild(b: Build, o: SimplifyOptions = {}): Promise<Build & { simplified?: SimplifyReport }> {
	await MeshoptSimplifier.ready;
	const maxError = o.error ?? (o.triangles ? 0.05 : 0.004);
	const size = Math.max(1e-6, b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
	const prims = b.compiled.prims;
	const inputs = b.meshes.map((m) => prepare(m, size, prims));
	const at = (e: number, from = inputs) => from.map((p) => (p ? reduce(p, e) : null));
	const count = (r: (Reduced | null)[]) => r.reduce((s, x, i) => s + (x ? x.indices.length / 3 : b.meshes[i].indices.length / 3), 0);

	if (!o.triangles) {
		const chosen = at(maxError);
		return finish(b, b.meshes.map((m, i) => (chosen[i] ? rebuild(m, chosen[i]!) : m)), { error: maxError, overBudget: false });
	}
	// a near-lossless pass first; the search then works on that much smaller mesh
	let lo = Math.min(maxError, 0.0005), hi = maxError;
	const first = at(lo);
	const base = inputs.map((p, i) => (p && first[i] ? { ...p, indices: first[i]!.indices } : p));
	let chosen = at(maxError, base), error = maxError, overBudget = false;
	{
		if (count(chosen) > o.triangles) overBudget = true;
		else {
			// the smallest shared error that fits, bisected in log space
			if (count(first) <= o.triangles) {
				chosen = first;
				error = lo;
			} else {
				for (let i = 0; i < 9; i++) {
					const mid = Math.sqrt(lo * hi);
					const r = at(mid, base);
					if (count(r) <= o.triangles) {
						hi = mid;
						chosen = r;
						error = mid;
					} else lo = mid;
				}
			}
		}
	}
	return finish(b, b.meshes.map((m, i) => (chosen[i] ? rebuild(m, chosen[i]!) : m)), { error, overBudget });
}

function finish(b: Build, meshes: MeshData[], simplified: SimplifyReport): Build & { simplified: SimplifyReport } {
	let triangles = 0, vertices = 0;
	for (const m of meshes) {
		triangles += m.indices.length / 3;
		vertices += m.positions.length / 3;
	}
	return { ...b, meshes, stats: { ...b.stats, triangles, vertices }, simplified };
}

interface Prepared {
	weights: number[];
	/** positions scaled so the model is one unit across: errors are relative to the model */
	unit: Float32Array;
	attrs: Float32Array;
	indices: Uint32Array;
}
interface Reduced {
	indices: Uint32Array;
}

function prepare(m: MeshData, size: number, prims: Build['compiled']['prims']): Prepared | null {
	const n = m.positions.length / 3;
	if (n < 16) return null;
	const A = 9;
	const attrs = new Float32Array(n * A);
	for (let v = 0; v < n; v++) {
		const p = prims[m.vertPrim[v]];
		attrs.set([m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2], m.colors[v * 3], m.colors[v * 3 + 1], m.colors[v * 3 + 2], p?.roughness ?? 0.75, p?.metalness ?? 0, p?.emissive ? 1 : 0], v * A);
	}
	const unit = new Float32Array(m.positions.length);
	for (let i = 0; i < unit.length; i++) unit[i] = m.positions[i] / size;
	// a mesh split at sharp edges carries `weld`
	return { unit, attrs, indices: new Uint32Array(m.indices), weights: m.weld ? SHARP_WEIGHTS : WEIGHTS };
}

/** No part may vanish to meet a budget. Under this many triangles a mesh is gone (a closed shape needs 4). */
const VANISHED = 4;
/** What a vanished part is brought back as: its simplest shape, about a box. */
const RESCUE = 12;

function reduce(p: Prepared, error: number): Reduced {
	// Permissive: collapses may cross the split normals of sharp edges when the error allows it.
	// Without it every sharp seam locks the flat faces next to it, and a tilted box stays at 90+ triangles.
	const [out] = MeshoptSimplifier.simplifyWithAttributes(p.indices, p.unit, 3, p.attrs, 9, p.weights, null, 0, error, ['ErrorAbsolute', 'Permissive', 'Prune']);
	if (out.length / 3 >= Math.min(VANISHED, p.indices.length / 3)) return { indices: out };
	const floor = Math.min(RESCUE, p.indices.length / 3);
	// a small part (a window, a bolt) fell under the error and was pruned away: keep its simplest shape instead
	const [kept] = MeshoptSimplifier.simplifyWithAttributes(p.indices, p.unit, 3, p.attrs, 9, p.weights, null, floor * 3, 1, ['ErrorAbsolute', 'Permissive']);
	return { indices: kept.length ? kept : p.indices };
}

function rebuild(m: MeshData, r: Reduced): MeshData {
	const out = r.indices;
	if (out.length >= m.indices.length) return m;
	const n = m.positions.length / 3;
	const [remap, unique] = MeshoptSimplifier.compactMesh(new Uint32Array(out));
	const idx = new Uint32Array(out.length);
	for (let i = 0; i < out.length; i++) idx[i] = remap[out[i]];
	const P = new Float32Array(unique * 3), N = new Float32Array(unique * 3), C = new Float32Array(unique * 3);
	const AO = new Float32Array(unique), VP = new Int32Array(unique), J = new Uint16Array(unique * 4), W = new Float32Array(unique * 4);
	for (let v = 0; v < n; v++) {
		const k = remap[v];
		if (k === 0xffffffff || k >= unique) continue;
		for (let c = 0; c < 3; c++) {
			P[k * 3 + c] = m.positions[v * 3 + c];
			N[k * 3 + c] = m.normals[v * 3 + c];
			C[k * 3 + c] = m.colors[v * 3 + c];
		}
		AO[k] = m.ao[v];
		VP[k] = m.vertPrim[v];
		for (let c = 0; c < 4; c++) {
			J[k * 4 + c] = m.joints[v * 4 + c];
			W[k * 4 + c] = m.weights[v * 4 + c];
		}
	}
	const TP = new Int32Array(idx.length / 3);
	for (let t = 0; t < TP.length; t++) {
		const a = VP[idx[t * 3]], b = VP[idx[t * 3 + 1]], c = VP[idx[t * 3 + 2]];
		TP[t] = a === b || a === c ? a : b === c ? b : a;
	}
	const out2: MeshData = { ...m, positions: P, normals: N, colors: C, ao: AO, vertPrim: VP, joints: J, weights: W, indices: idx, triPrim: TP, weld: undefined };
	// sharp: flat faces get their exact face normals back, split again where faces meet steeply
	return m.weld ? splitSharp(out2, 40) : out2;
}
