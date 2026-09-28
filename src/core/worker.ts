/**
 * Build worker: recompiles the scene (deterministic, so every worker agrees)
 * and does one slice of the work — a slab of the distance grid, or the
 * attributes of a range of vertices.
 */

import { parentPort } from 'node:worker_threads';
import { prepareContext, vertexAttributes, type BuildContext, type BuildOptions } from './build.js';
import { gridDims, placeVertices, sampleSlab } from './mesher.js';
import type { Scene } from './schema.js';

const cache: { key: string; ctx: BuildContext }[] = [];

function contextFor(scene: Scene, opts: BuildOptions): BuildContext {
	const key = JSON.stringify(scene) + '|' + JSON.stringify(opts);
	const hit = cache.find((c) => c.key === key);
	if (hit) return hit.ctx;
	const ctx = prepareContext(scene, opts);
	cache.unshift({ key, ctx });
	cache.length = Math.min(cache.length, 2);
	return ctx;
}

parentPort!.on('message', (m: { id: number; task: 'sample' | 'place' | 'attributes'; scene: Scene; opts: BuildOptions; l0?: number; l1?: number; positions?: Float32Array; shared?: SharedArrayBuffer; blocks?: Int32Array }) => {
	try {
		const ctx = contextFor(m.scene, m.opts);
		if (m.task === 'sample') {
			const r = sampleSlab(ctx.body!.field, ctx.cell, m.l0!, m.l1!);
			// write straight into the shared grid; only the small dense flags travel back
			const [nx, ny] = gridDims(ctx.body!.field, ctx.cell);
			new Float32Array(m.shared!).set(r.vals, r.k0 * nx * ny);
			parentPort!.postMessage({ id: m.id, dense: r.dense, k0: r.k0, samples: r.samples }, [r.dense.buffer as ArrayBuffer]);
		} else if (m.task === 'place') {
			const p = placeVertices(ctx.body!.field, ctx.cell, new Float32Array(m.shared!), Array.from(m.blocks!), ctx.sharp ? ctx.body!.gradNear : undefined);
			parentPort!.postMessage({ id: m.id, cells: p.cells, positions: p.positions }, [p.cells.buffer as ArrayBuffer, p.positions.buffer as ArrayBuffer]);
		} else {
			const at = vertexAttributes(ctx, m.positions!, 0, m.positions!.length / 3);
			parentPort!.postMessage({ id: m.id, ...at }, [at.normals.buffer, at.colors.buffer, at.ao.buffer, at.vertPrim.buffer, at.joints.buffer, at.weights.buffer] as ArrayBuffer[]);
		}
	} catch (e) {
		parentPort!.postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) });
	}
});
