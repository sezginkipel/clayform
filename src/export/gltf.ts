/**
 * Build → binary glTF 2.0 (.glb).
 *
 * One glTF mesh per Clayform mesh (fused body + each separate part), one
 * primitive per material (roughness / metalness / emission), vertex colors in
 * COLOR_0 (linear, optionally with baked ambient occlusion). When the scene
 * has clips the export is skinned: joints are the parts' pivots under a
 * `root` joint and every clip becomes a glTF animation.
 *
 * With `texture` the colors go into a baked atlas (TEXCOORD_0 + baseColorTexture)
 * instead of COLOR_0, for engines whose default materials ignore vertex colors.
 * `shading` gives faceted (flat) or banded unlit (toon) looks, `outline` adds
 * an inverted-hull rim.
 */

import { boneName, exportLocals, humanoidSkeleton, partsSkeleton, type ExportSkeleton, type SkeletonNaming } from '../anim/humanoid.js';
import type { Build, MeshData } from '../core/build.js';
import { m4Compose, m4Invert, qIdentity, srgbToLinear, type V3 } from '../core/math.js';
import { buildRig, sampleClip, type Rig, type SampledClip } from '../anim/rig.js';
import { VERSION } from '../version.js';
import { convexHull } from './hull.js';
import { bakeAtlas, flatten, outlineMesh, toonColors, type Atlas, type Shading } from './texture.js';

export interface GlbOptions {
	/** multiply ambient occlusion into vertex colors (default true) */
	bakeAo?: boolean;
	/** force skinning even without clips */
	rig?: boolean;
	/** only these clip ids (default: all) */
	clips?: string[];
	/** lower levels of detail (already simplified builds of the same scene), exported as <name>_LOD1, _LOD2 … */
	lods?: Build[];
	/** collision shapes: one convex hull per part (parts), one for the whole model (hull), or none */
	collision?: 'none' | 'parts' | 'hull';
	/** how collision nodes are named for the target engine */
	naming?: 'godot' | 'unreal' | 'unity' | 'plain';
	/** bake the colors into a square texture of this many pixels (e.g. 1024) instead of vertex colors */
	texture?: number;
	/** smooth (default), flat (faceted normals) or toon (banded light baked in, unlit material) */
	shading?: Shading;
	/** light steps for toon shading (default 3) */
	bands?: number;
	/** inverted-hull outline this many meters wide (toon look); 0 = none */
	outline?: number;
	/** bone names: one per part (default), or the standard humanoid set for retargeting (Unity Humanoid, Mixamo, Unreal) */
	skeleton?: SkeletonNaming;
	/** a shared atlas baked from `glbMeshes` of several builds (kits); `first` is this build's first mesh in it */
	atlas?: { atlas: Atlas; first: number; uri?: string };
}

/** The meshes an export writes, in atlas order: every level of detail, each after shading. */
export function glbMeshes(b: Build, opts: Pick<GlbOptions, 'lods' | 'shading' | 'bands' | 'texture' | 'atlas'> = {}): { mesh: MeshData; build: Build }[] {
	const out: { mesh: MeshData; build: Build }[] = [];
	const textured = !!(opts.texture || opts.atlas);
	for (const lb of [b, ...(opts.lods ?? [])])
		for (const m of lb.meshes) {
			let x = opts.shading === 'flat' ? flatten(m) : m;
			// toon without a texture: bands go into the vertex colors (with a texture they are baked per texel)
			if (opts.shading === 'toon' && !textured) x = toonColors(x, opts.bands ?? 3);
			out.push({ mesh: x, build: lb });
		}
	return out;
}

export interface GlbResult {
	glb: Uint8Array;
	json: Record<string, unknown>;
	stats: { meshes: number; primitives: number; materials: number; triangles: number; joints: number; animations: number; bytes: number; lods: number; colliders: number; texture: number; charts: number; outlines: number };
	/** the baked atlas when `texture` was set */
	atlas?: Atlas;
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

	raw(bytes: Uint8Array): number {
		return this.push(bytes);
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
	const wantRig = scene.settings?.rig !== 'none' && (opts.rig || clipDefs.length > 0 || (!!opts.skeleton && opts.skeleton !== 'parts'));
	const rig: Rig | null = wantRig ? buildRig(b) : null;
	const w = new BinWriter();
	const shading = opts.shading ?? 'smooth';
	const toon = shading === 'toon';
	const prepared = glbMeshes(b, opts);
	let atlas: Atlas | undefined = opts.atlas?.atlas;
	const first = opts.atlas?.first ?? 0;
	if (!atlas && opts.texture) atlas = bakeAtlas(prepared, { size: opts.texture, bakeAo, toonBands: toon ? opts.bands ?? 3 : 0 });
	const extensionsUsed = new Set<string>();
	// relief and shine maps travel with the atlas when parts use material presets (toon is unlit: it has no use for them)
	const withMaps = !!(atlas?.normalPng && atlas.ormPng) && !toon;

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
		const pbr: Record<string, unknown> = { baseColorFactor: [1, 1, 1, 1], metallicFactor: toon ? 0 : p?.metalness ?? 0, roughnessFactor: toon ? 1 : p?.roughness ?? 0.75 };
		if (atlas) pbr.baseColorTexture = { index: 0 };
		if (withMaps) {
			// roughness and metalness come from the ORM map (G, B); the factors multiply it, so they are 1
			pbr.metallicFactor = 1;
			pbr.roughnessFactor = 1;
			pbr.metallicRoughnessTexture = { index: 2 };
		}
		const m: Record<string, unknown> = {
			name: p ? (p.emissive ? `glow_${materials.length}` : p.metalness > 0.5 ? `metal_${materials.length}` : `surface_${materials.length}`) : 'surface',
			pbrMetallicRoughness: pbr,
			...(withMaps ? { normalTexture: { index: 1 } } : {})
		};
		const ext: Record<string, unknown> = {};
		if (p?.emissive) {
			m.emissiveFactor = p.emissive.map(srgbToLinear);
			if (p.emissiveStrength > 1 && !toon) {
				ext.KHR_materials_emissive_strength = { emissiveStrength: p.emissiveStrength };
				usesEmissiveStrength = true;
			}
		}
		if (toon) {
			// the light is already in the colors
			ext.KHR_materials_unlit = {};
			extensionsUsed.add('KHR_materials_unlit');
		}
		if (Object.keys(ext).length) m.extensions = ext;
		materials.push(m);
		matIndex.set(key, materials.length - 1);
		return materials.length - 1;
	};

	/* ------------------------------------------------------------ meshes */
	const meshes: Record<string, unknown>[] = [];
	const nodes: Record<string, unknown>[] = [];
	const sceneNodes: number[] = [];
	let triangles = 0, primitiveCount = 0;

	let outlineMaterial = -1;
	const writeMesh = (src: MeshData, am?: { remap: Uint32Array; uv: Float32Array; indices: Uint32Array; tangents: Float32Array }, forceMaterial?: number) => {
		// with an atlas, vertices are split along chart seams
		const m: MeshData = am ? remapMesh(src, am.remap, am.indices) : src;
		const n = m.positions.length / 3;
		const attrs: Record<string, number> = {
			POSITION: w.accessor(m.positions, 'VEC3', FLOAT, { target: ARRAY_BUFFER, minmax: true }),
			NORMAL: w.accessor(m.normals, 'VEC3', FLOAT, { target: ARRAY_BUFFER })
		};
		if (am) attrs.TEXCOORD_0 = w.accessor(am.uv, 'VEC2', FLOAT, { target: ARRAY_BUFFER });
		// our own tangents, matching how the normal map was baked, so no engine has to guess the frame
		if (am && withMaps) attrs.TANGENT = w.accessor(am.tangents, 'VEC4', FLOAT, { target: ARRAY_BUFFER });
		if (!am && forceMaterial === undefined) {
			const col = new Float32Array(n * 4);
			for (let v = 0; v < n; v++) {
				const ao = bakeAo ? m.ao[v] : 1;
				col[v * 4] = srgbToLinear(m.colors[v * 3]) * ao;
				col[v * 4 + 1] = srgbToLinear(m.colors[v * 3 + 1]) * ao;
				col[v * 4 + 2] = srgbToLinear(m.colors[v * 3 + 2]) * ao;
				col[v * 4 + 3] = 1;
			}
			attrs.COLOR_0 = w.accessor(col, 'VEC4', FLOAT, { target: ARRAY_BUFFER });
		}
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
			const mi = forceMaterial ?? materialFor(m.triPrim[t]);
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
		meshes.push({ name: exportName(m.name), primitives });
		return meshes.length - 1;
	};

	// Engines treat "." specially in animation paths (three.js strips it), so twins
	// export as "<id>_mirror"; collisions with a real part id get a number.
	const taken = new Set<string>();
	const safeName = (n: string) => {
		const base = n.replace(/\.m$/, '_mirror').replace(/[^A-Za-z0-9_-]/g, '_');
		let name = base, i = 2;
		while (taken.has(name)) name = `${base}${i++}`;
		taken.add(name);
		return name;
	};
	for (const p of prims) if (!p.twin) taken.add(p.id);
	const nameOf = new Map<string, string>();
	const exportName = (n: string) => {
		if (!nameOf.has(n)) nameOf.set(n, prims.some((p) => p.id === n && !p.twin) || n === 'root' || n === 'body' ? n : safeName(n));
		return nameOf.get(n)!;
	};

	/* --------------------------------------------------------- skeleton */
	let skinIndex = -1;
	let ibmAcc = -1;
	const jointNode: number[] = [];
	const boneNaming = opts.skeleton ?? 'parts';
	const skel: ExportSkeleton | null = rig ? (boneNaming === 'parts' ? partsSkeleton(rig) : humanoidSkeleton(b, rig)) : null;
	if (skel && boneNaming !== 'parts' && skel.missing.length)
		throw new Error(`a ${boneNaming} skeleton needs a body with a head, two arms, and two legs or a robe to the ground; this model has no place for ${skel.missing.join(', ')} (export with skeleton "parts" instead)`);
	const locals = skel ? exportLocals(skel) : [];
	if (rig && skel) {
		// standard names first, so a part called "Head" does not take the bone's name
		for (const jt of skel.joints) if (jt.bone) taken.add(boneName(jt.bone, boneNaming));
		skel.joints.forEach((jt, i) => {
			const name = jt.bone ? boneName(jt.bone, boneNaming) : jt.joint >= 0 ? exportName(rig.joints[jt.joint].name) : safeName(jt.name ?? 'bone');
			nodes.push({ name, translation: locals[i] });
			jointNode.push(nodes.length - 1);
		});
		skel.joints.forEach((_, i) => {
			const kids = skel.joints.map((k, ki) => (k.parent === i ? jointNode[ki] : -1)).filter((x) => x >= 0);
			if (kids.length) nodes[jointNode[i]].children = kids;
		});
		const ibm = new Float32Array(skel.joints.length * 16);
		skel.joints.forEach((jt, i) => ibm.set(m4Invert(m4Compose(jt.rest, qIdentity())), i * 16));
		ibmAcc = w.accessor(ibm, 'MAT4', FLOAT);
		skinIndex = 0;
		sceneNodes.push(jointNode[0]);
	}

	const levels = [b, ...(opts.lods ?? [])];
	const lodNodes: number[] = [];
	let k = 0, outlines = 0;
	levels.forEach((lb, li) => {
		for (let mi = 0; mi < lb.meshes.length; mi++, k++) {
			const m = prepared[k].mesh;
			const mesh = writeMesh(m, atlas?.meshes[first + k]);
			const base = exportName(m.name) + (rig ? '_mesh' : '');
			const node: Record<string, unknown> = { name: levels.length > 1 ? `${base}_LOD${li}` : base, mesh };
			if (rig) node.skin = skinIndex;
			nodes.push(node);
			lodNodes.push(nodes.length - 1);
			if (opts.outline && opts.outline > 0) {
				if (outlineMaterial < 0) {
					materials.push({ name: 'outline', pbrMetallicRoughness: { baseColorFactor: [0.02, 0.02, 0.025, 1], metallicFactor: 0, roughnessFactor: 1 }, extensions: { KHR_materials_unlit: {} } });
					extensionsUsed.add('KHR_materials_unlit');
					outlineMaterial = materials.length - 1;
				}
				const om = writeMesh(outlineMesh(m, opts.outline), undefined, outlineMaterial);
				const onode: Record<string, unknown> = { name: levels.length > 1 ? `${base}_outline_LOD${li}` : `${base}_outline`, mesh: om };
				if (rig) onode.skin = skinIndex;
				nodes.push(onode);
				lodNodes.push(nodes.length - 1);
				outlines++;
			}
		}
	});
	// static LODs sit under one parent so importers that build LOD groups (Unity) find siblings
	if (levels.length > 1 && !rig) {
		nodes.push({ name: `${exportName(scene.name.replace(/s+/g, '_'))}_LODs`, children: lodNodes });
		sceneNodes.push(nodes.length - 1);
	} else sceneNodes.push(...lodNodes);

	/* --------------------------------------------------------- collision */
	let colliders = 0;
	if (opts.collision && opts.collision !== 'none') {
		const groups = new Map<string, [number, number, number][]>();
		for (const m of b.meshes)
			for (let v = 0; v < m.positions.length / 3; v++) {
				const owner = opts.collision === 'hull' ? 'model' : m.prim >= 0 ? prims[m.prim].id : prims[m.vertPrim[v]]?.id ?? 'body';
				const list = groups.get(owner) ?? [];
				list.push([m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]);
				groups.set(owner, list);
			}
		const naming = opts.naming ?? 'plain';
		let n = 0;
		for (const [owner, pts] of groups) {
			// engines cap convex colliders at 255 vertices; coarsen until it fits
			let hull = convexHull(pts);
			for (const cells of [10, 7, 5]) if (hull && hull.positions.length / 3 > 255) hull = convexHull(pts, cells);
			if (!hull) continue;
			const pos = w.accessor(hull.positions, 'VEC3', FLOAT, { target: ARRAY_BUFFER, minmax: true });
			const idx = hull.positions.length / 3 > 65535 ? new Uint32Array(hull.indices) : new Uint16Array(hull.indices);
			const ind = w.accessor(idx, 'SCALAR', idx instanceof Uint32Array ? UINT : USHORT, { target: ELEMENT_ARRAY_BUFFER });
			const nm = exportName(owner);
			const name =
				naming === 'godot' ? `${nm}-convcolonly`
				: naming === 'unreal' ? `UCX_body_${String(n).padStart(2, '0')}`
				: naming === 'unity' ? `${nm}_collider`
				: `${nm}_collision`;
			meshes.push({ name, primitives: [{ attributes: { POSITION: pos }, indices: ind, mode: 4 }] });
			nodes.push({ name, mesh: meshes.length - 1 });
			sceneNodes.push(nodes.length - 1);
			n++;
		}
		colliders = n;
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
					const base = locals[ch.joint];
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
			// planted gaits walk at a set speed: an engine moving the character at it keeps the feet from sliding
			if (channels.length) animations.push({ name: clip.id, samplers, channels, ...(clip.speed > 0 ? { extras: { speed: Number(clip.speed.toFixed(4)) } } : {}) });
		}
	}

	/* ----------------------------------------------------------- texture */
	let images: Record<string, unknown>[] | undefined;
	if (atlas) {
		const img = (png: Uint8Array, name: string, uri?: string) => (uri ? { uri, name } : { bufferView: w.raw(png), mimeType: 'image/png', name });
		const uri = opts.atlas?.uri;
		images = [img(atlas.png, 'atlas', uri)];
		if (withMaps) images.push(img(atlas.normalPng!, 'atlas_normal', uri && mapUri(uri, 'normal')), img(atlas.ormPng!, 'atlas_orm', uri && mapUri(uri, 'orm')));
	}

	/* -------------------------------------------------------------- json */
	const bin = w.bytes();
	const json: Record<string, unknown> = {
		asset: { version: '2.0', generator: `Clayform ${VERSION}` },
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
	if (images) {
		json.images = images;
		// clamp: charts sit right at the edge of the atlas in places
		json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
		json.textures = images.map((_, i) => ({ source: i, sampler: 0 }));
	}
	if (usesEmissiveStrength) extensionsUsed.add('KHR_materials_emissive_strength');
	if (extensionsUsed.size) json.extensionsUsed = [...extensionsUsed];

	const glb = packGlb(json, bin);
	return {
		glb,
		json,
		stats: {
			meshes: meshes.length,
			primitives: primitiveCount,
			materials: materials.length,
			triangles,
			joints: skel?.joints.length ?? 0,
			animations: animations.length,
			bytes: glb.byteLength,
			lods: levels.length,
			colliders,
			texture: atlas?.size ?? 0,
			charts: atlas && !opts.atlas ? atlas.charts : 0,
			outlines
		},
		atlas: opts.atlas ? undefined : atlas
	};
}

/** Where a kit's normal or ORM map lives next to its atlas: atlas.png → atlas_normal.png. */
export function mapUri(uri: string, kind: 'normal' | 'orm'): string {
	return uri.replace(/(\.png)?$/i, `_${kind}.png`);
}

function remapMesh(m: MeshData, remap: Uint32Array, indices: Uint32Array): MeshData {
	const n = remap.length;
	const pick = <T extends Float32Array | Uint16Array | Int32Array>(src: T, stride: number, make: (n: number) => T): T => {
		const out = make(n * stride);
		for (let v = 0; v < n; v++) for (let k = 0; k < stride; k++) out[v * stride + k] = src[remap[v] * stride + k];
		return out;
	};
	return {
		...m,
		positions: pick(m.positions, 3, (x) => new Float32Array(x)),
		normals: pick(m.normals, 3, (x) => new Float32Array(x)),
		colors: pick(m.colors, 3, (x) => new Float32Array(x)),
		ao: pick(m.ao, 1, (x) => new Float32Array(x)),
		vertPrim: pick(m.vertPrim, 1, (x) => new Int32Array(x)),
		joints: pick(m.joints, 4, (x) => new Uint16Array(x)),
		weights: pick(m.weights, 4, (x) => new Float32Array(x)),
		indices
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
