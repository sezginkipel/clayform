/**
 * Layouts: many objects in one place (a dungeon corner, a street, a forest
 * patch). A layout places scenes or templates with a position, a yaw and a
 * scale, and can generate rows, grids, circles and scatters. Each scene is
 * built once; instances reuse it with a transform.
 */

import { settleItems, type Settled } from './settle.js';
import { z } from 'zod';
import { buildScene, type Build, type MeshData } from './core/build.js';
import { bodyField, type Compiled, type Prim } from './core/compile.js';
import { m4Compose, m4Invert, qEuler, rng, type M4, type V3 } from './core/math.js';
import { FORMAT, Id, formatZodError, type Scene } from './core/schema.js';
import type { Issue } from './critic/critics.js';

const num = z.number().finite();

export const Placement = z.strictObject({
	id: Id,
	scene: z.string().min(1).describe('a workspace scene id, a template id, or a path to a .clay.json'),
	position: z.union([z.tuple([num, num]), z.tuple([num, num, num])]).describe('[x, z] on the ground, or [x, y, z]'),
	rotation: num.optional().describe('turn around Y, in degrees'),
	scale: num.positive().optional(),
	fixed: z.boolean().optional().describe('with settle: stays where it is placed (a shelf on a wall) and still holds up what lands on it')
});

export const Pattern = z.strictObject({
	id: Id,
	scene: z.string().min(1),
	type: z.enum(['row', 'grid', 'circle', 'scatter']),
	count: z.number().int().min(1).max(400),
	spacing: num.positive().optional().describe('meters between items (row, grid)'),
	columns: z.number().int().min(1).max(100).optional().describe('grid columns (default: square-ish)'),
	radius: num.positive().optional().describe('circle radius'),
	area: z.tuple([num.positive(), num.positive()]).optional().describe('scatter area [width, depth]'),
	origin: z.tuple([num, num]).optional().describe('[x, z] of the pattern center (default 0, 0)'),
	direction: num.optional().describe('row direction in degrees around Y (default along +X)'),
	rotate: z.union([z.enum(['none', 'random', 'face_center', 'face_out']), num]).optional().describe('how each item turns'),
	scaleJitter: num.min(0).max(0.9).optional().describe('random scale spread, e.g. 0.2 = ±20%'),
	minGap: num.min(0).optional().describe('scatter: keep items at least this far apart'),
	seed: z.number().int().optional()
});

export const Layout = z.strictObject({
	format: z.literal('clayform-layout/1'),
	name: z.string().min(1).max(80),
	items: z.array(Placement).max(1000).optional(),
	patterns: z.array(Pattern).max(64).optional(),
	settle: z.boolean().optional().describe('drop every item straight down until it rests on the ground or on another item, so nothing floats or passes through (items do not tip or slide)')
});
export type Layout = z.infer<typeof Layout>;

export interface Placed {
	id: string;
	scene: string;
	position: V3;
	rotation: number;
	scale: number;
	fixed?: boolean;
}

export function parseLayout(input: unknown): { ok: true; layout: Layout } | { ok: false; error: string } {
	const r = Layout.safeParse(input);
	if (!r.success) return { ok: false, error: formatZodError(r.error) };
	const ids = new Set<string>();
	for (const p of [...(r.data.items ?? []), ...(r.data.patterns ?? [])]) {
		if (ids.has(p.id)) return { ok: false, error: `• duplicate id "${p.id}" in the layout` };
		ids.add(p.id);
	}
	if (!r.data.items?.length && !r.data.patterns?.length) return { ok: false, error: '• the layout places nothing — add items or patterns' };
	return { ok: true, layout: r.data };
}

/** Every item, with patterns expanded (deterministic for a seed). */
export function expandLayout(l: Layout): Placed[] {
	const out: Placed[] = [];
	for (const it of l.items ?? [])
		out.push({ id: it.id, scene: it.scene, position: it.position.length === 2 ? [it.position[0], 0, it.position[1]] : [...it.position] as V3, rotation: it.rotation ?? 0, scale: it.scale ?? 1, ...(it.fixed ? { fixed: true } : {}) });
	for (const p of l.patterns ?? []) {
		const r = rng(p.seed ?? 1);
		const [ox, oz] = p.origin ?? [0, 0];
		const pts: [number, number][] = [];
		if (p.type === 'row') {
			const d = ((p.direction ?? 0) * Math.PI) / 180, s = p.spacing ?? 1;
			for (let i = 0; i < p.count; i++) {
				const t = (i - (p.count - 1) / 2) * s;
				pts.push([ox + Math.cos(d) * t, oz - Math.sin(d) * t]);
			}
		} else if (p.type === 'grid') {
			const cols = p.columns ?? Math.ceil(Math.sqrt(p.count)), rows = Math.ceil(p.count / cols), s = p.spacing ?? 1;
			for (let i = 0; i < p.count; i++) pts.push([ox + ((i % cols) - (cols - 1) / 2) * s, oz + (Math.floor(i / cols) - (rows - 1) / 2) * s]);
		} else if (p.type === 'circle') {
			const R = p.radius ?? 2;
			for (let i = 0; i < p.count; i++) {
				const a = (i / p.count) * Math.PI * 2;
				pts.push([ox + Math.sin(a) * R, oz + Math.cos(a) * R]);
			}
		} else {
			const [w, d] = p.area ?? [6, 6];
			const gap = p.minGap ?? 0;
			for (let tries = 0; pts.length < p.count && tries < p.count * 60; tries++) {
				const q: [number, number] = [ox + (r() - 0.5) * w, oz + (r() - 0.5) * d];
				if (gap && pts.some((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) < gap)) continue;
				pts.push(q);
			}
		}
		pts.forEach(([x, z], i) => {
			let yaw = 0;
			const rot = p.rotate ?? 'none';
			if (rot === 'random') yaw = r() * 360;
			else if (rot === 'face_center') yaw = (Math.atan2(ox - x, oz - z) * 180) / Math.PI;
			else if (rot === 'face_out') yaw = (Math.atan2(x - ox, z - oz) * 180) / Math.PI;
			else if (typeof rot === 'number') yaw = rot;
			const sj = p.scaleJitter ?? 0;
			out.push({ id: `${p.id}_${i + 1}`, scene: p.scene, position: [x, 0, z], rotation: yaw, scale: 1 + (r() * 2 - 1) * sj });
		});
	}
	return out;
}

export interface LayoutBuild {
	layout: Layout;
	placed: Placed[];
	/** one build per distinct scene reference */
	builds: Map<string, Build>;
	matrices: M4[];
	/** everything merged into one Build-shaped object (for rendering and export) */
	merged: Build;
	/** with settle: where each item came to rest */
	settled?: Settled[];
}

const matrixOf = (p: Placed): M4 => m4Compose(p.position, qEuler([0, p.rotation, 0]), [p.scale, p.scale, p.scale]);

export function buildLayout(l: Layout, resolve: (ref: string) => Scene): LayoutBuild {
	const placed = expandLayout(l);
	const builds = new Map<string, Build>();
	for (const p of placed) if (!builds.has(p.scene)) builds.set(p.scene, buildScene(resolve(p.scene)));
	const settled = l.settle ? settleItems(placed, builds) : undefined;
	return { layout: l, placed, builds, matrices: placed.map(matrixOf), merged: mergeBuilds({ layout: l, placed }, builds), ...(settled ? { settled } : {}) };
}

/** One Build-shaped object with every item's meshes moved into place (for rendering and export). */
export function mergeBuilds(lb: { layout: Layout; placed: Placed[] }, builds: Map<string, Build>): Build {
	const l = lb.layout, placed = lb.placed;
	const prims: Prim[] = [];
	const meshes: MeshData[] = [];
	const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
	let cell = Infinity;
	for (const p of placed) {
		const b = builds.get(p.scene)!;
		const M = matrixOf(p);
		const base = prims.length;
		for (const pr of b.compiled.prims) prims.push({ ...pr, id: `${p.id}/${pr.id}`, index: prims.length });
		cell = Math.min(cell, b.cell * p.scale);
		for (const m of b.meshes) {
			const n = m.positions.length / 3;
			const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
			for (let v = 0; v < n; v++) {
				const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
				P[v * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
				P[v * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
				P[v * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
				const nx = m.normals[v * 3], ny = m.normals[v * 3 + 1], nz = m.normals[v * 3 + 2];
				const qx = M[0] * nx + M[4] * ny + M[8] * nz, qy = M[1] * nx + M[5] * ny + M[9] * nz, qz = M[2] * nx + M[6] * ny + M[10] * nz;
				const l = Math.hypot(qx, qy, qz) || 1;
				N[v * 3] = qx / l; N[v * 3 + 1] = qy / l; N[v * 3 + 2] = qz / l;
				for (let a = 0; a < 3; a++) {
					min[a] = Math.min(min[a], P[v * 3 + a]);
					max[a] = Math.max(max[a], P[v * 3 + a]);
				}
			}
			meshes.push({
				...m,
				name: m.prim < 0 ? p.id : `${p.id}_${m.name}`,
				positions: P,
				normals: N,
				triPrim: m.triPrim.map((t) => t + base),
				vertPrim: m.vertPrim.map((t) => t + base),
				prim: m.prim < 0 ? -1 : m.prim + base
			});
		}
	}
	const scene: Scene = { format: FORMAT, name: l.name, settings: { rig: 'none' }, parts: [] };
	const compiled = { scene, prims, body: [], sculpts: [], byId: new Map(prims.map((q) => [q.id, q])), grow: 0, lip: 1, warnings: [] } as Compiled;
	let triangles = 0, vertices = 0;
	for (const m of meshes) {
		triangles += m.indices.length / 3;
		vertices += m.positions.length / 3;
	}
	const merged: Build = {
		compiled,
		source: scene,
		meshes,
		offset: [0, 0, 0],
		min: isFinite(min[0]) ? min : [0, 0, 0],
		max: isFinite(max[0]) ? max : [0, 0, 0],
		cell: isFinite(cell) ? cell : 0.01,
		stats: { triangles, vertices, ms: 0, samples: 0 }
	};
	return merged;
}

/**
 * Items that overlap: vertices of one item that lie inside another item's
 * shape (its own field, evaluated in its local frame).
 */
export function critiqueLayout(lb: LayoutBuild): Issue[] {
	const issues: Issue[] = [];
	const inv = lb.matrices.map(m4Invert);
	const boxes = lb.placed.map((p, i) => {
		const b = lb.builds.get(p.scene)!;
		const M = lb.matrices[i];
		const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
		for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
			const c: V3 = [corner & 1 ? b.max[0] : b.min[0], corner & 2 ? b.max[1] : b.min[1], corner & 4 ? b.max[2] : b.min[2]];
			const w: V3 = [M[0] * c[0] + M[4] * c[1] + M[8] * c[2] + M[12], M[1] * c[0] + M[5] * c[1] + M[9] * c[2] + M[13], M[2] * c[0] + M[6] * c[1] + M[10] * c[2] + M[14]];
			for (let a = 0; a < 3; a++) {
				min[a] = Math.min(min[a], w[a]);
				max[a] = Math.max(max[a], w[a]);
			}
		}
		return { min, max };
	});
	for (let i = 0; i < lb.placed.length; i++)
		for (let j = i + 1; j < lb.placed.length; j++) {
			const A = boxes[i], B = boxes[j];
			if (A.max[0] < B.min[0] || B.max[0] < A.min[0] || A.max[2] < B.min[2] || B.max[2] < A.min[2] || A.max[1] < B.min[1] || B.max[1] < A.min[1]) continue;
			const bi = lb.builds.get(lb.placed[i].scene)!, bj = lb.builds.get(lb.placed[j].scene)!;
			const mesh = bi.meshes[0];
			if (!mesh) continue;
			let deepest = 0, hits = 0;
			const M = lb.matrices[i], Q = inv[j];
			const step = Math.max(1, Math.floor(mesh.positions.length / 3 / 1500));
			for (let v = 0; v < mesh.positions.length / 3; v += step) {
				const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2];
				const wx = M[0] * x + M[4] * y + M[8] * z + M[12], wy = M[1] * x + M[5] * y + M[9] * z + M[13], wz = M[2] * x + M[6] * y + M[10] * z + M[14];
				if (wx < B.min[0] || wx > B.max[0] || wy < B.min[1] || wy > B.max[1] || wz < B.min[2] || wz > B.max[2]) continue;
				const lx = Q[0] * wx + Q[4] * wy + Q[8] * wz + Q[12], ly = Q[1] * wx + Q[5] * wy + Q[9] * wz + Q[13], lz = Q[2] * wx + Q[6] * wy + Q[10] * wz + Q[14];
				const d = bodyField(bj.compiled, lx, ly - bj.offset[1], lz) * lb.placed[j].scale;
				if (d < -bj.cell * 1.5) {
					hits++;
					deepest = Math.min(deepest, d);
				}
			}
			if (hits >= 4)
				issues.push({ severity: 'warn', code: 'items-overlap', message: `${lb.placed[i].id} and ${lb.placed[j].id} pass through each other (up to ${(-deepest * 100).toFixed(1)} cm) — move them apart or lower minGap/spacing`, parts: [lb.placed[i].id, lb.placed[j].id] });
		}
	const rests = new Map((lb.settled ?? []).map((s) => [s.id, s]));
	for (const s of lb.settled ?? [])
		if (s.tips) issues.push({ severity: 'warn', code: 'item-tips', message: `${s.id} rests on ${s.on} with its weight over the edge, so it would tip over; move it further onto what holds it`, parts: [s.id] });
	for (const p of lb.placed)
		if (p.position[1] > 0.01 && (!rests.has(p.id) || rests.get(p.id)!.on === 'fixed'))
			issues.push({ severity: 'info', code: 'item-lifted', message: `${p.id} is placed ${(p.position[1] * 100).toFixed(0)} cm above the ground` });
	return issues.slice(0, 20);
}

export function describeLayout(lb: LayoutBuild): string {
	const counts = new Map<string, number>();
	for (const p of lb.placed) counts.set(p.scene, (counts.get(p.scene) ?? 0) + 1);
	const size = lb.merged.max.map((v, i) => (v - lb.merged.min[i]).toFixed(2)).join(' × ');
	return [
		`layout "${lb.layout.name}" — ${lb.placed.length} items from ${counts.size} scenes, ${size} m, ${lb.merged.stats.triangles.toLocaleString('en')} triangles`,
		...[...counts.entries()].map(([s, n]) => `  ${s} × ${n}`),
		...(lb.settled ? [settleLine(lb.settled)] : [])
	].join('\n');
}

function settleLine(st: Settled[]): string {
	const onItems = st.filter((s) => s.on !== 'ground' && s.on !== 'fixed');
	const moved = st.filter((s) => Math.abs(s.to - s.from) > 0.005);
	const tips = st.filter((s) => s.tips);
	return `settled: ${moved.length} of ${st.length} items moved; ${onItems.length ? onItems.map((s) => `${s.id} on ${s.on}`).join(', ') : 'all on the ground'}${tips.length ? `; would tip: ${tips.map((s) => s.id).join(', ')}` : ''}`;
}
