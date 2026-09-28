/**
 * Parallel builds on worker threads. The distance grid is split into slabs
 * along Z and the vertex attributes into ranges; workers recompute the same
 * deterministic context, so the result is identical to `buildScene`.
 *
 * Set CLAYFORM_WORKERS=0 to turn it off, or a number to cap the workers.
 */

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { bodyMesh, buildScene, finishBuild, prepareContext, type Build, type BuildOptions, type VertexAttrs } from './build.js';
import { blockCounts, blockLayers, connect, denseBlocks, gridDims } from './mesher.js';
import { fileRoot } from './files.js';
import type { Scene } from './schema.js';

interface Job {
	msg: Record<string, unknown>;
	transfer: ArrayBuffer[];
	resolve: (v: any) => void;
	reject: (e: Error) => void;
}

class Pool {
	private idle: Worker[] = [];
	private queue: Job[] = [];
	private pending = new Map<number, Job>();
	private seq = 0;
	broken = false;
	readonly size: number;

	constructor(size: number) {
		this.size = size;
		const here = new URL(import.meta.url);
		const isTs = here.pathname.endsWith('.ts');
		// from source (tests, tsx) the worker goes through a tiny tsx bootstrap
		const url = new URL(isTs ? './worker-dev.mjs' : './worker.js', here);
		for (let i = 0; i < size; i++) {
			const w = new Worker(url);
			w.unref();
			w.on('message', (m: { id: number; error?: string }) => {
				const job = this.pending.get(m.id);
				this.pending.delete(m.id);
				if (job) (m.error ? job.reject(new Error(m.error)) : job.resolve(m));
				this.release(w);
			});
			const fail = (e: Error) => {
				// a broken pool must never hang a build: fail everything and let callers go serial
				this.broken = true;
				for (const job of this.pending.values()) job.reject(e);
				this.pending.clear();
				for (const job of this.queue.splice(0)) job.reject(e);
			};
			w.on('error', fail);
			w.on('exit', (code) => {
				if (code !== 0) fail(new Error(`build worker exited with code ${code}`));
			});
			this.idle.push(w);
		}
	}

	run(msg: Record<string, unknown>, transfer: ArrayBuffer[] = []): Promise<any> {
		if (this.broken) return Promise.reject(new Error('the build worker pool is unavailable'));
		return new Promise((resolve, reject) => {
			this.queue.push({ msg, transfer, resolve, reject });
			this.pump();
		});
	}

	private pump() {
		while (this.idle.length && this.queue.length) {
			const w = this.idle.pop()!;
			const job = this.queue.shift()!;
			const id = ++this.seq;
			this.pending.set(id, job);
			w.ref(); // keep the process alive while this worker is busy
			w.postMessage({ ...job.msg, id }, job.transfer);
		}
	}

	private release(w: Worker) {
		w.unref(); // an idle pool must not keep a CLI command running
		this.idle.push(w);
		this.pump();
	}
}

let pool: Pool | null | undefined;

function getPool(): Pool | null {
	if (pool?.broken) pool = null;
	if (pool !== undefined) return pool;
	const env = process.env.CLAYFORM_WORKERS;
	const want = env === undefined ? Math.min(8, availableParallelism() - 1) : Number(env);
	pool = want >= 2 ? new Pool(want) : null;
	return pool;
}

const split = (n: number, parts: number): [number, number][] => {
	const out: [number, number][] = [];
	const step = Math.ceil(n / parts);
	for (let a = 0; a < n; a += step) out.push([a, Math.min(n, a + step)]);
	return out;
};

/** Same result as buildScene, faster on big scenes. Falls back to buildScene when it would not help. */
export async function buildSceneAsync(scene: Scene, opts: BuildOptions = {}): Promise<Build> {
	const p = getPool();
	if (!p) return buildScene(scene, opts);
	try {
		return await parallelBuild(p, scene, opts);
	} catch {
		// workers unavailable (sandbox, missing loader, crash): the serial build gives the same result
		return buildScene(scene, opts);
	}
}

async function parallelBuild(p: Pool, scene: Scene, opts: BuildOptions): Promise<Build> {
	const t0 = performance.now();
	const ctx = prepareContext(scene, opts);
	// workers resolve mesh sources and style sheets under the same session root
	const root = fileRoot();
	if (!ctx.body) return buildScene(scene, opts);
	const f = ctx.body.field;
	const layers = blockLayers(f, ctx.cell);
	const [nx, ny, nz] = gridDims(f, ctx.cell);
	if (nx * ny * nz < 200_000) return buildScene(scene, opts);

	// 1. the distance grid, slab by slab, written by the workers into shared memory
	const shared = new SharedArrayBuffer(nx * ny * nz * 4);
	const vals = new Float32Array(shared);
	const slabs = await Promise.all(split(layers, p.size * 2).map(([l0, l1]) => p.run({ task: 'sample', scene, opts, root, l0, l1, shared })));
	const [bx, by, bz] = blockCounts(f, ctx.cell);
	const dense = new Uint8Array(bx * by * bz);
	let samples = 0;
	for (const s of slabs) {
		dense.set(s.dense, (s.k0 / 4) * bx * by);
		samples += s.samples;
	}
	// 2. vertices, block range by block range (concatenated in order, so the result matches a serial build)
	const blocks = denseBlocks(dense);
	const placedParts = await Promise.all(split(blocks.length, p.size * 2).map(([a, b]) => p.run({ task: 'place', scene, opts, root, shared, blocks: Int32Array.from(blocks.slice(a, b)) })));
	let nv = 0;
	for (const q of placedParts) nv += q.cells.length;
	const cells = new Int32Array(nv), positions = new Float32Array(nv * 3);
	let o = 0;
	for (const q of placedParts) {
		cells.set(q.cells, o);
		positions.set(q.positions, o * 3);
		o += q.cells.length;
	}
	// 3. faces
	const raw = connect(f, ctx.cell, vals, blocks, { cells, positions });
	// 4. vertex attributes, range by range
	const n = raw.positions.length / 3;
	const ranges = split(n, p.size * 2);
	const parts = await Promise.all(ranges.map(([v0, v1]) => {
		const positions = raw.positions.slice(v0 * 3, v1 * 3);
		return p.run({ task: 'attributes', scene, opts, root, positions }, [positions.buffer as ArrayBuffer]);
	}));
	const at: VertexAttrs = {
		normals: new Float32Array(n * 3), colors: new Float32Array(n * 3), ao: new Float32Array(n),
		vertPrim: new Int32Array(n), joints: new Uint16Array(n * 4), weights: new Float32Array(n * 4)
	};
	ranges.forEach(([v0], i) => {
		const r = parts[i];
		at.normals.set(r.normals, v0 * 3);
		at.colors.set(r.colors, v0 * 3);
		at.ao.set(r.ao, v0);
		at.vertPrim.set(r.vertPrim, v0);
		at.joints.set(r.joints, v0 * 4);
		at.weights.set(r.weights, v0 * 4);
	});
	return finishBuild(ctx, bodyMesh(ctx, raw.positions, raw.indices, at), samples, t0);
}
