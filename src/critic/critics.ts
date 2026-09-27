/**
 * Critics: measurable checks for the things a language model is worst at
 * judging from a picture — disconnected pieces, parts swallowed by other
 * parts, detail lost to resolution, broken symmetry, models that would tip
 * over, and triangle budgets. Every issue names the parts involved and says
 * what to change.
 */

import { bodyField, primDist } from '../core/compile.js';
import type { Build, MeshData } from '../core/build.js';
import type { V3 } from '../core/math.js';

export type Severity = 'error' | 'warn' | 'info';

export interface Issue {
	severity: Severity;
	code: string;
	message: string;
	parts?: string[];
	at?: V3;
}

export interface Report {
	ok: boolean;
	issues: Issue[];
	stats: {
		triangles: number;
		vertices: number;
		size: V3;
		height: number;
		islands: number;
		buildMs: number;
		cell: number;
		centerOfMass: V3 | null;
		watertight: boolean;
	};
}

const r3 = (v: V3): V3 => [+v[0].toFixed(3), +v[1].toFixed(3), +v[2].toFixed(3)];

export function critique(b: Build): Report {
	const c = b.compiled;
	const issues: Issue[] = [];
	for (const w of c.warnings) issues.push({ severity: 'warn', code: 'placement', message: w });

	const body = b.meshes.find((m) => m.prim < 0);
	const idOf = (i: number) => c.prims[i]?.id ?? String(i);

	/* ------------------------------------------------------------ islands */
	let islands = 0;
	let watertight = true;
	if (body) {
		const comps = components(body);
		islands = comps.length;
		const mainParts = new Set(comps[0] ? [...comps[0].prims.keys()] : []);
		for (const comp of comps.slice(1)) {
			const who = [...comp.prims.entries()].sort((a, z) => z[1] - a[1]).map(([p]) => idOf(p));
			if (comp.tris < 16) {
				issues.push({ severity: 'info', code: 'speck', message: `a tiny loose fragment (${comp.tris} triangles) near ${who[0]} — usually two surfaces almost touching; add blend or embed`, parts: who.slice(0, 1), at: r3(comp.center) });
				continue;
			}
			const split = [...comp.prims.keys()].filter((p) => mainParts.has(p)).map(idOf);
			issues.push({
				severity: 'error',
				code: 'floating',
				message: split.length
					? `${split.join(', ')} ${split.length > 1 ? 'are' : 'is'} cut into separate pieces (with ${who.filter((w) => !split.includes(w)).slice(0, 3).join(', ') || 'nothing else'} in the loose piece) — a carve or gap splits the body; check carve order (a carve cuts every part listed before it) or add blend`
					: `${who.slice(0, 3).join(', ')} ${who.length > 1 ? 'are' : 'is'} not connected to the rest of the body — use attach, raise embed, or mark it separate if it should be its own mesh`,
				parts: split.length ? split : who.slice(0, 3),
				at: r3(comp.center)
			});
		}
		watertight = isClosed(body);
		if (!watertight) issues.push({ severity: 'info', code: 'open-edges', message: 'a few non-manifold edges where two surfaces meet within one cell; harmless for rendering, raise resolution if exporting for printing' });
	}

	/* ---------------------------------------------- hidden / lost parts */
	const shown = new Set<number>();
	for (const m of b.meshes) for (const p of m.vertPrim) shown.add(p);
	for (const p of c.prims) {
		if (p.hidden || p.op !== 'add') continue;
		const ext = Math.min(p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]);
		const cell = p.separate ? Math.min(b.cell, ext / 20) : b.cell;
		if (!shown.has(p.index)) {
			if (ext < cell * 2)
				issues.push({ severity: 'error', code: 'too-small', message: `${p.id} (${(ext * 100).toFixed(1)} cm thick) is smaller than two cells (${(cell * 100).toFixed(1)} cm) and vanished — raise settings.resolution or make it separate`, parts: [p.id] });
			else
				issues.push({ severity: 'error', code: 'buried', message: `${p.id} is completely inside other parts, nothing of it is visible — move it outward, lower its embed, or remove it`, parts: [p.id] });
		} else if (!p.separate && ext < cell * 2.5) {
			issues.push({ severity: 'warn', code: 'thin', message: `${p.id} is only ${(ext / cell).toFixed(1)} cells thick and will look lumpy — raise resolution or make it separate`, parts: [p.id] });
		}
	}

	/* ------------------------------- unrelated parts fused (animation) */
	if (body && (c.scene.clips?.length ?? 0) > 0) {
		const related = (a: number, z: number) => {
			const A = c.prims[a], Z = c.prims[z];
			return a === z || A.parent === z || Z.parent === a || (A.parent >= 0 && A.parent === Z.parent && !['leg', 'arm', 'wing', 'tail'].includes(A.role) && !['leg', 'arm', 'wing', 'tail'].includes(Z.role));
		};
		const movers = new Set(['leg', 'arm', 'wing', 'tail', 'head', 'wheel', 'rotor', 'ear']);
		const pairs = new Map<string, number>();
		const adds = c.body.filter((p) => p.op === 'add');
		const step = Math.max(1, Math.floor(body.positions.length / 3 / 6000));
		for (let v = 0; v < body.positions.length / 3; v += step) {
			const x = body.positions[v * 3], y = body.positions[v * 3 + 1] - b.offset[1], z = body.positions[v * 3 + 2];
			const dom = body.vertPrim[v];
			for (const q of adds) {
				if (related(dom, q.index)) continue;
				// only matters if one of them (or an ancestor) moves on its own
				const moves = (i: number) => {
					for (let p = c.prims[i]; p; p = c.prims[p.parent]) {
						if (movers.has(p.role)) return true;
						if (p.parent < 0) break;
					}
					return false;
				};
				if (!moves(dom) && !moves(q.index)) continue;
				if (primDist(q, x, y, z) < b.cell * 0.9) {
					const key = [idOf(dom), q.id].sort().join(' + ');
					pairs.set(key, (pairs.get(key) ?? 0) + 1);
				}
			}
		}
		for (const [k, n] of [...pairs.entries()].sort((a, z) => z[1] - a[1]).slice(0, 4)) {
			if (n < 6) continue;
			issues.push({ severity: 'warn', code: 'fused-unrelated', message: `${k} touch and fuse into one surface but move independently — the bridge will stretch when animated; move them apart (more than their blend radius) or make one separate`, parts: k.split(' + ') });
		}
	}

	/* ---------------------------------------------- separate: touching? */
	if (body) {
		for (const m of b.meshes) {
			if (m.prim < 0) continue;
			const pr = c.prims[m.prim];
			let best = Infinity;
			const others = c.prims.filter((o) => o.separate && !o.hidden && o.op === 'add' && o.index !== pr.index);
			const step = Math.max(1, Math.floor(m.positions.length / 3 / 400));
			for (let v = 0; v < m.positions.length / 3; v += step) {
				const x = m.positions[v * 3], y = m.positions[v * 3 + 1] - b.offset[1], z = m.positions[v * 3 + 2];
				let d = bodyField(c, x, y, z);
				for (const o of others) d = Math.min(d, primDist(o, x, y, z));
				if (d < best) best = d;
			}
			const groundTouch = minY(m) < b.cell * 1.5;
			if (best > b.cell * 2 && !groundTouch)
				issues.push({ severity: 'warn', code: 'separate-gap', message: `${pr.id} (separate) does not touch the body — the gap is ${(best * 100).toFixed(1)} cm`, parts: [pr.id] });
		}
	}

	/* ------------------------------------------------------------ ground */
	if (c.scene.settings?.ground === 'none' && isFinite(b.min[1])) {
		if (b.min[1] > b.cell * 1.5) issues.push({ severity: 'info', code: 'above-ground', message: `lowest point is ${(b.min[1] * 100).toFixed(1)} cm above y=0 (ground: none)` });
		if (b.min[1] < -b.cell * 1.5) issues.push({ severity: 'info', code: 'below-ground', message: `model reaches ${(b.min[1] * 100).toFixed(1)} cm below y=0 (ground: none)` });
	}

	/* ---------------------------------------------------------- symmetry */
	if (c.scene.settings?.symmetry === 'x' && body) {
		const per = new Map<number, { sum: number; n: number }>();
		let sum = 0, n = 0;
		const step = Math.max(1, Math.floor(body.positions.length / 3 / 3000));
		for (let v = 0; v < body.positions.length / 3; v += step) {
			const x = body.positions[v * 3], y = body.positions[v * 3 + 1] - b.offset[1], z = body.positions[v * 3 + 2];
			const d = Math.abs(bodyField(c, -x, y, z));
			sum += d;
			n++;
			const p = body.vertPrim[v];
			const e = per.get(p) ?? { sum: 0, n: 0 };
			e.sum += d;
			e.n++;
			per.set(p, e);
		}
		const mean = sum / Math.max(1, n);
		if (mean > b.cell * 0.75) {
			const worst = [...per.entries()].map(([p, e]) => ({ id: idOf(p), m: e.sum / e.n })).sort((a, z) => z.m - a.m).filter((w) => w.m > b.cell).slice(0, 4);
			issues.push({
				severity: 'warn',
				code: 'asymmetric',
				message: `declared X symmetry is off by ${(mean * 100).toFixed(1)} cm on average; worst: ${worst.map((w) => `${w.id} (${(w.m * 100).toFixed(1)} cm)`).join(', ') || 'spread out'} — use mirror: true instead of hand-placing both sides`,
				parts: worst.map((w) => w.id)
			});
		}
	}

	/* --------------------------------------------------------- stability */
	const com = centerOfMass(b.meshes);
	if (com && c.scene.settings?.ground !== 'none') {
		const contacts: [number, number][] = [];
		const touching = new Map<number, number>();
		for (const m of b.meshes)
			for (let v = 0; v < m.positions.length / 3; v++)
				if (m.positions[v * 3 + 1] < b.cell * 1.2) {
					contacts.push([m.positions[v * 3], m.positions[v * 3 + 2]]);
					touching.set(m.vertPrim[v], (touching.get(m.vertPrim[v]) ?? 0) + 1);
				}
		if (contacts.length >= 3) {
			const hull = convexHull(contacts);
			const inside = pointInHull([com[0], com[2]], hull);
			if (!inside && hull.length >= 3) {
				const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length, cz = hull.reduce((s, p) => s + p[1], 0) / hull.length;
				const dir = Math.abs(com[0] - cx) > Math.abs(com[2] - cz) ? (com[0] > cx ? '+x (its left)' : '-x (its right)') : com[2] > cz ? '+z (forward)' : '-z (backward)';
				const who = [...touching.entries()].sort((a, z) => z[1] - a[1]).map(([p]) => idOf(p));
				issues.push({
					severity: 'warn',
					code: 'tips-over',
					message: `only ${who.slice(0, 4).join(', ')} touch${who.length === 1 ? 'es' : ''} the ground and the center of mass is outside that footprint — it would tip toward ${dir}. If a small part hangs lower than the base, raise it; otherwise widen the base`,
					parts: who.slice(0, 4)
				});
			}
		}
	}

	/* ------------------------------------------------------------ budget */
	const budget = c.scene.settings?.budget;
	if (budget && b.stats.triangles > budget) {
		const res = c.scene.settings?.resolution ?? 96;
		const suggest = Math.max(16, Math.floor(res * Math.sqrt(budget / b.stats.triangles)));
		issues.push({ severity: 'warn', code: 'over-budget', message: `${b.stats.triangles} triangles is over the budget of ${budget}; resolution ${suggest} would fit` });
	}

	const size: V3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
	return {
		ok: !issues.some((i) => i.severity === 'error'),
		issues,
		stats: {
			triangles: b.stats.triangles,
			vertices: b.stats.vertices,
			size: r3(size),
			height: +size[1].toFixed(3),
			islands,
			buildMs: b.stats.ms,
			cell: +b.cell.toFixed(4),
			centerOfMass: com ? r3(com) : null,
			watertight
		}
	};
}

export function formatReport(r: Report): string {
	const s = r.stats;
	const lines = [
		`size ${s.size.map((v) => v.toFixed(2)).join(' × ')} m · ${s.triangles.toLocaleString('en')} triangles · ${s.islands} body island${s.islands === 1 ? '' : 's'} · built in ${s.buildMs} ms`
	];
	if (!r.issues.length) lines.push('critics: no issues found');
	for (const i of r.issues) lines.push(`${i.severity.toUpperCase()} [${i.code}] ${i.message}`);
	return lines.join('\n');
}

/* ------------------------------------------------------------ helpers */

function minY(m: MeshData) {
	let y = Infinity;
	for (let i = 1; i < m.positions.length; i += 3) y = Math.min(y, m.positions[i]);
	return y;
}

interface Comp {
	tris: number;
	prims: Map<number, number>;
	center: V3;
}

function components(m: MeshData): Comp[] {
	const n = m.positions.length / 3;
	const parent = new Int32Array(n);
	for (let i = 0; i < n; i++) parent[i] = i;
	const find = (x: number): number => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]];
			x = parent[x];
		}
		return x;
	};
	const idx = m.indices;
	for (let t = 0; t < idx.length; t += 3) {
		const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]);
		parent[b] = a;
		parent[find(c)] = a;
	}
	const map = new Map<number, Comp & { sx: number; sy: number; sz: number; nv: number }>();
	for (let t = 0; t < idx.length / 3; t++) {
		const root = find(idx[t * 3]);
		let e = map.get(root);
		if (!e) {
			e = { tris: 0, prims: new Map(), center: [0, 0, 0], sx: 0, sy: 0, sz: 0, nv: 0 };
			map.set(root, e);
		}
		e.tris++;
		e.prims.set(m.triPrim[t], (e.prims.get(m.triPrim[t]) ?? 0) + 1);
		const v = idx[t * 3];
		e.sx += m.positions[v * 3];
		e.sy += m.positions[v * 3 + 1];
		e.sz += m.positions[v * 3 + 2];
		e.nv++;
	}
	return [...map.values()]
		.map((e) => ({ tris: e.tris, prims: e.prims, center: [e.sx / e.nv, e.sy / e.nv, e.sz / e.nv] as V3 }))
		.sort((a, b) => b.tris - a.tris);
}

function isClosed(m: MeshData): boolean {
	const edges = new Map<number, number>();
	const n = m.positions.length / 3;
	const idx = m.indices;
	for (let t = 0; t < idx.length; t += 3)
		for (let e = 0; e < 3; e++) {
			const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
			const k = a < b ? a * n + b : b * n + a;
			edges.set(k, (edges.get(k) ?? 0) + 1);
		}
	for (const v of edges.values()) if (v !== 2) return false;
	return true;
}

/** Volume centroid of closed meshes (divergence theorem). */
function centerOfMass(meshes: MeshData[]): V3 | null {
	let vol = 0, cx = 0, cy = 0, cz = 0;
	for (const m of meshes) {
		const P = m.positions, I = m.indices;
		for (let t = 0; t < I.length; t += 3) {
			const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
			const ax = P[a], ay = P[a + 1], az = P[a + 2];
			const bx = P[b], by = P[b + 1], bz = P[b + 2];
			const qx = P[c], qy = P[c + 1], qz = P[c + 2];
			const v = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
			vol += v;
			cx += v * (ax + bx + qx) / 4;
			cy += v * (ay + by + qy) / 4;
			cz += v * (az + bz + qz) / 4;
		}
	}
	if (Math.abs(vol) < 1e-12) return null;
	return [cx / vol, cy / vol, cz / vol];
}

function convexHull(pts: [number, number][]): [number, number][] {
	const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (p.length < 3) return p;
	const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const lower: [number, number][] = [];
	for (const q of p) {
		while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
		lower.push(q);
	}
	const upper: [number, number][] = [];
	for (let i = p.length - 1; i >= 0; i--) {
		const q = p[i];
		while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
		upper.push(q);
	}
	upper.pop();
	lower.pop();
	return lower.concat(upper);
}

function pointInHull(q: [number, number], h: [number, number][]): boolean {
	if (h.length < 3) return false;
	for (let i = 0; i < h.length; i++) {
		const a = h[i], b = h[(i + 1) % h.length];
		if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) < -1e-9) return false;
	}
	return true;
}
