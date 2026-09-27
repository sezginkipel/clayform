/**
 * Build → binary glTF 2.0 (.glb).
 *
 * One glTF mesh per Clayform mesh (fused body + each separate part), one
 * primitive per material (roughness / metalness / emission), vertex colors in
 * COLOR_0 (linear, optionally with baked ambient occlusion). When the scene
 * has clips the export is skinned: joints are the parts' pivots under a
 * `root` joint and every clip becomes a glTF animation.
 */

import type { Build, MeshData } from '../core/build.js';
import { m4Compose, m4Invert, qIdentity, srgbToLinear, type V3 } from '../core/math.js';
import { buildRig, sampleClip, type Rig, type SampledClip } from '../anim/rig.js';

export interface GlbOptions {
	/** multiply ambient occlusion into vertex colors (default true) */
	bakeAo?: boolean;
	/** force skinning even without clips */
	rig?: boolean;
	/** only these clip ids (default: all) */
	clips?: string[];
}

export interface GlbResult {
	glb: Uint8Array;
	json: Record<string, unknown>;
	stats: { meshes: number; primitives: number; materials: number; triangles: number; joints: number; animations: number; bytes: number };
}

const FLOAT = 5126, USHORT = 5123, UINT = 5125;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

class BinWriter {
	chunks: Uint8Array[] = [];
	length = 0;
	views: Record<string, unknown>[] = [];
	accessors: Record<string, unknown>[] = [];

	private push(bytes: Uint8Array, target?: number): number {
		const pad = (4 - (this.length % 4)) % 4;
		if (pad) {
			this.chunks.push(new Uint8Array(pad));
			this.length += pad;
		}
		const view: Record<string, unknown> = { buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength };
		if (target) view.target = target;
		this.chunks.push(bytes);
		this.length += bytes.byteLength;
		this.views.push(view);
		return this.views.length - 1;
	}

	accessor(data: Float32Array | Uint16Array | Uint32Array, type: string, componentType: number, opts: { target?: number; minmax?: boolean; normalized?: boolean } = {}): number {
		const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type] ?? 1;
		const view = this.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), opts.target);
		const acc: Record<string, unknown> = { bufferView: view, componentType, count: data.length / comps, type };
		if (opts.normalized) acc.normalized = true;
		if (opts.minmax) {
			const min = new Array(comps).fill(Infinity), max = new Array(comps).fill(-Infinity);
			for (let i = 0; i < data.length; i++) {
				const c = i % comps;
				if (data[i] < min[c]) min[c] = data[i];
				if (data[i] > max[c]) max[c] = data[i];
			}
			acc.min = min.map((v) => Math.fround(v));
			acc.max = max.map((v) => Math.fround(v));
		}
		this.accessors.push(acc);
		return this.accessors.length - 1;
	}

	bytes(): Uint8Array {
		const pad = (4 - (this.length % 4)) % 4;
		const out = new Uint8Array(this.length + pad);
		let o = 0;
		for (const c of this.chunks) {
			out.set(c, o);
			o += c.byteLength;
		}
		return out;
	}
}

export function exportGlb(b: Build, opts: GlbOptions = {}): GlbResult {
	const scene = b.compiled.scene;
	const prims = b.compiled.prims;
	const bakeAo = opts.bakeAo ?? true;
	const clipDefs = (scene.clips ?? []).filter((c) => !opts.clips || opts.clips.includes(c.id));
	const wantRig = scene.settings?.rig !== 'none' && (opts.rig || clipDefs.length > 0);
	const rig: Rig | null = wantRig ? buildRig(b) : null;
	const w = new BinWriter();

	/* --------------------------------------------------------- materials */
	const materials: Record<string, unknown>[] = [];
	const matIndex = new Map<string, number>();
	let usesEmissiveStrength = false;
	const materialFor = (pi: number): number => {
		const p = prims[pi];
		const key = p
			? `${p.roughness.toFixed(2)}|${p.metalness.toFixed(2)}|${p.emissive ? p.emissive.map((c) => c.toFixed(3)).join(',') : '-'}|${p.emissiveStrength.toFixed(2)}`
			: 'default';
		const hit = matIndex.get(key);
		if (hit !== undefined) return hit;
		const m: Record<string, unknown> = {
			name: p ? (p.emissive ? `glow_${materials.length}` : p.metalness > 0.5 ? `metal_${materials.length}` : `surface_${materials.length}`) : 'surface',
			pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: p?.metalness ?? 0, roughnessFactor: p?.roughness ?? 0.75 }
		};
		if (p?.emissive) {
			m.emissiveFactor = p.emissive.map(srgbToLinear);
			if (p.emissiveStrength > 1) {
				m.extensions = { KHR_materials_emissive_strength: { emissiveStrength: p.emissiveStrength } };
				usesEmissiveStrength = true;
			}
		}
		materials.push(m);
		matIndex.set(key, materials.length - 1);
		return materials.length - 1;
	};

	/* ------------------------------------------------------------ meshes */
	const meshes: Record<string, unknown>[] = [];
	const nodes: Record<string, unknown>[] = [];
	const sceneNodes: number[] = [];
	let triangles = 0, primitiveCount = 0;

	const writeMesh = (m: MeshData) => {
		const n = m.positions.length / 3;
		const col = new Float32Array(n * 4);
		for (let v = 0; v < n; v++) {
			const ao = bakeAo ? m.ao[v] : 1;
			col[v * 4] = srgbToLinear(m.colors[v * 3]) * ao;
			col[v * 4 + 1] = srgbToLinear(m.colors[v * 3 + 1]) * ao;
			col[v * 4 + 2] = srgbToLinear(m.colors[v * 3 + 2]) * ao;
			col[v * 4 + 3] = 1;
		}
		const attrs: Record<string, number> = {
			POSITION: w.accessor(m.positions, 'VEC3', FLOAT, { target: ARRAY_BUFFER, minmax: true }),
			NORMAL: w.accessor(m.normals, 'VEC3', FLOAT, { target: ARRAY_BUFFER }),
			COLOR_0: w.accessor(col, 'VEC4', FLOAT, { target: ARRAY_BUFFER })
		};
		if (rig) {
			const J = new Uint16Array(n * 4), Wt = new Float32Array(n * 4);
			for (let v = 0; v < n; v++) {
				let s = 0;
				for (let k = 0; k < 4; k++) s += m.weights[v * 4 + k];
				for (let k = 0; k < 4; k++) {
					const wt = s > 0 ? m.weights[v * 4 + k] / s : k === 0 ? 1 : 0;
					J[v * 4 + k] = wt > 0 ? rig.byPrim.get(m.joints[v * 4 + k]) ?? 0 : 0;
					Wt[v * 4 + k] = wt;
				}
			}
			attrs.JOINTS_0 = w.accessor(J, 'VEC4', USHORT, { target: ARRAY_BUFFER });
			attrs.WEIGHTS_0 = w.accessor(Wt, 'VEC4', FLOAT, { target: ARRAY_BUFFER });
		}
		// group triangles by material
		const groups = new Map<number, number[]>();
		for (let t = 0; t < m.indices.length / 3; t++) {
			const mi = materialFor(m.triPrim[t]);
			let g = groups.get(mi);
			if (!g) groups.set(mi, (g = []));
			g.push(m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]);
		}
		const primitives = [...groups.entries()].map(([mi, idx]) => {
			primitiveCount++;
			const arr = n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
			return { attributes: attrs, indices: w.accessor(arr, 'SCALAR', n > 65535 ? UINT : USHORT, { target: ELEMENT_ARRAY_BUFFER }), material: mi, mode: 4 };
		});
		triangles += m.indices.length / 3;
		meshes.push({ name: m.name, primitives });
		return meshes.length - 1;
	};

	/* --------------------------------------------------------- skeleton */
	let skinIndex = -1;
	let ibmAcc = -1;
	const jointNode: number[] = [];
	if (rig) {
		rig.joints.forEach((jt) => {
			nodes.push({ name: jt.name, translation: jt.local });
			jointNode.push(nodes.length - 1);
		});
		rig.joints.forEach((jt, i) => {
			const kids = rig.joints.map((k, ki) => (k.parent === i ? jointNode[ki] : -1)).filter((x) => x >= 0);
			if (kids.length) nodes[jointNode[i]].children = kids;
		});
		const ibm = new Float32Array(rig.joints.length * 16);
		rig.joints.forEach((jt, i) => ibm.set(m4Invert(m4Compose(jt.rest, qIdentity())), i * 16));
		ibmAcc = w.accessor(ibm, 'MAT4', FLOAT);
		skinIndex = 0;
		sceneNodes.push(jointNode[0]);
	}

	for (const m of b.meshes) {
		const mesh = writeMesh(m);
		const node: Record<string, unknown> = { name: m.name, mesh };
		if (rig) node.skin = skinIndex;
		nodes.push(node);
		sceneNodes.push(nodes.length - 1);
	}

	/* ------------------------------------------------------- animations */
	const animations: Record<string, unknown>[] = [];
	if (rig) {
		for (const def of clipDefs) {
			const clip: SampledClip = sampleClip(b, rig, def);
			const input = w.accessor(new Float32Array(clip.times), 'SCALAR', FLOAT, { minmax: true });
			const samplers: Record<string, unknown>[] = [];
			const channels: Record<string, unknown>[] = [];
			for (const ch of clip.channels) {
				const node = jointNode[ch.joint];
				const rot = new Float32Array(ch.rot.length * 4);
				ch.rot.forEach((q, i) => rot.set(q, i * 4));
				samplers.push({ input, output: w.accessor(rot, 'VEC4', FLOAT), interpolation: 'LINEAR' });
				channels.push({ sampler: samplers.length - 1, target: { node, path: 'rotation' } });
				if (ch.off.some((o) => o[0] || o[1] || o[2])) {
					const base = rig.joints[ch.joint].local;
					const tr = new Float32Array(ch.off.length * 3);
					ch.off.forEach((o, i) => tr.set([base[0] + o[0], base[1] + o[1], base[2] + o[2]] as V3, i * 3));
					samplers.push({ input, output: w.accessor(tr, 'VEC3', FLOAT), interpolation: 'LINEAR' });
					channels.push({ sampler: samplers.length - 1, target: { node, path: 'translation' } });
				}
				if (ch.scl) {
					const sc = new Float32Array(ch.scl.length * 3);
					ch.scl.forEach((s, i) => sc.set(s, i * 3));
					samplers.push({ input, output: w.accessor(sc, 'VEC3', FLOAT), interpolation: 'LINEAR' });
					channels.push({ sampler: samplers.length - 1, target: { node, path: 'scale' } });
				}
			}
			if (channels.length) animations.push({ name: clip.id, samplers, channels });
		}
	}

	/* -------------------------------------------------------------- json */
	const bin = w.bytes();
	const json: Record<string, unknown> = {
		asset: { version: '2.0', generator: 'Clayform 0.1' },
		scene: 0,
		scenes: [{ name: scene.name, nodes: sceneNodes }],
		nodes,
		meshes,
		materials,
		accessors: w.accessors,
		bufferViews: w.views,
		buffers: [{ byteLength: bin.byteLength }]
	};
	if (rig) {
		json.skins = [{ name: 'rig', joints: jointNode, inverseBindMatrices: ibmAcc, skeleton: jointNode[0] }];
	}
	if (animations.length) json.animations = animations;
	if (usesEmissiveStrength) json.extensionsUsed = ['KHR_materials_emissive_strength'];

	const glb = packGlb(json, bin);
	return {
		glb,
		json,
		stats: {
			meshes: meshes.length,
			primitives: primitiveCount,
			materials: materials.length,
			triangles,
			joints: rig?.joints.length ?? 0,
			animations: animations.length,
			bytes: glb.byteLength
		}
	};
}

function packGlb(json: Record<string, unknown>, bin: Uint8Array): Uint8Array {
	let text = new TextEncoder().encode(JSON.stringify(json));
	const jpad = (4 - (text.length % 4)) % 4;
	if (jpad) {
		const t = new Uint8Array(text.length + jpad);
		t.set(text);
		t.fill(0x20, text.length);
		text = t;
	}
	const total = 12 + 8 + text.length + 8 + bin.length;
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, 0x46546c67, true);
	dv.setUint32(4, 2, true);
	dv.setUint32(8, total, true);
	dv.setUint32(12, text.length, true);
	dv.setUint32(16, 0x4e4f534a, true);
	out.set(text, 20);
	dv.setUint32(20 + text.length, bin.length, true);
	dv.setUint32(24 + text.length, 0x004e4942, true);
	out.set(bin, 28 + text.length);
	return out;
}

/** Wavefront OBJ with per-vertex colors (static geometry only). */
export function exportObj(b: Build): string {
	const lines = [`# Clayform — ${b.compiled.scene.name}`];
	let base = 1;
	for (const m of b.meshes) {
		lines.push(`o ${m.name}`);
		const n = m.positions.length / 3;
		for (let v = 0; v < n; v++)
			lines.push(`v ${m.positions[v * 3].toFixed(5)} ${m.positions[v * 3 + 1].toFixed(5)} ${m.positions[v * 3 + 2].toFixed(5)} ${m.colors[v * 3].toFixed(4)} ${m.colors[v * 3 + 1].toFixed(4)} ${m.colors[v * 3 + 2].toFixed(4)}`);
		for (let v = 0; v < n; v++) lines.push(`vn ${m.normals[v * 3].toFixed(4)} ${m.normals[v * 3 + 1].toFixed(4)} ${m.normals[v * 3 + 2].toFixed(4)}`);
		for (let t = 0; t < m.indices.length; t += 3) {
			const a = m.indices[t] + base, c = m.indices[t + 1] + base, d = m.indices[t + 2] + base;
			lines.push(`f ${a}//${a} ${c}//${c} ${d}//${d}`);
		}
		base += n;
	}
	return lines.join('\n') + '\n';
}
