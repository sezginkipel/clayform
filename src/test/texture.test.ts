import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { buildScene } from '../core/build.js';
import { simplifyBuild } from '../core/simplify.js';
import { exportGlb } from '../export/gltf.js';
import { exportKit } from '../export/kit.js';
import { bakeAtlas, flatten, toonLevel } from '../export/texture.js';
import { getTemplate } from '../templates/index.js';

const build = (id: string) => buildScene(getTemplate(id)!.scene);

describe('texture atlas', () => {
	it('paints each vertex its own color at its UV, with charts that fit the atlas', () => {
		const b = build('car');
		const a = bakeAtlas(b.meshes.map((mesh) => ({ mesh, build: b })), { size: 512 });
		expect(a.coverage).toBeGreaterThan(0.45);
		const errs: number[] = [];
		a.meshes.forEach((am, i) => {
			const m = b.meshes[i];
			expect(am.indices.length).toBe(m.indices.length);
			for (let v = 0; v < am.remap.length; v++) {
				const u = am.uv[v * 2], w = am.uv[v * 2 + 1];
				expect(u).toBeGreaterThan(0);
				expect(u).toBeLessThan(1);
				expect(w).toBeGreaterThan(0);
				expect(w).toBeLessThan(1);
				const o = (Math.floor(w * a.size) * a.size + Math.floor(u * a.size)) * 4, s = am.remap[v];
				let e = 0;
				for (let c = 0; c < 3; c++) e = Math.max(e, Math.abs(a.rgba[o + c] / 255 - m.colors[s * 3 + c] * m.ao[s]));
				errs.push(e);
			}
		});
		errs.sort((x, y) => x - y);
		expect(errs[errs.length >> 1]).toBeLessThan(0.02);
		expect(errs[Math.floor(errs.length * 0.95)]).toBeLessThan(0.06);
	});

	it('fills the gutters so filtering never reaches the grey background next to a chart', () => {
		const b = build('mushroom');
		const a = bakeAtlas(b.meshes.map((mesh) => ({ mesh, build: b })), { size: 256, padding: 2 });
		// every texel within 2 of a UV vertex is painted (not the 128 grey fill)
		let grey = 0, n = 0;
		for (const am of a.meshes)
			for (let v = 0; v < am.remap.length; v += 7) {
				const x = Math.floor(am.uv[v * 2] * a.size), y = Math.floor(am.uv[v * 2 + 1] * a.size);
				for (let dy = -2; dy <= 2; dy++)
					for (let dx = -2; dx <= 2; dx++) {
						const o = ((y + dy) * a.size + x + dx) * 4;
						n++;
						if (a.rgba[o] === 128 && a.rgba[o + 1] === 128 && a.rgba[o + 2] === 128) grey++;
					}
			}
		expect(grey / n).toBeLessThan(0.001);
	});
});

describe('shading', () => {
	it('flat gives every triangle its own vertices with the face normal', () => {
		const m = flatten(build('crystal').meshes[0]);
		expect(m.positions.length / 3).toBe(m.indices.length);
		for (let t = 0; t < 50; t++) {
			const a = t * 9;
			expect(m.normals[a]).toBeCloseTo(m.normals[a + 3], 5);
			expect(m.normals[a + 1]).toBeCloseTo(m.normals[a + 7], 5);
		}
	});

	it('toon light comes in the asked number of steps', () => {
		const levels = new Set<number>();
		for (let i = 0; i <= 200; i++) {
			const t = (i / 200) * Math.PI;
			levels.add(toonLevel(Math.cos(t), Math.sin(t), 0, 1, 3));
		}
		expect(levels.size).toBe(3);
	});
});

describe('textured glTF', () => {
	const check = async (glb: Uint8Array, external?: Record<string, Uint8Array>) => {
		const rep = await validator.validateBytes(glb, { externalResourceFunction: (uri: string) => (external?.[uri] ? Promise.resolve(external[uri]) : Promise.reject(new Error(`missing ${uri}`))) });
		expect(rep.issues.numErrors, JSON.stringify(rep.issues.messages.slice(0, 3))).toBe(0);
		expect(rep.issues.numWarnings, JSON.stringify(rep.issues.messages.slice(0, 3))).toBe(0);
		return rep;
	};

	it('exports UVs and an embedded texture instead of vertex colors', async () => {
		const b = await simplifyBuild(build('chest'), { triangles: 4000 });
		const r = exportGlb(b, { texture: 512 });
		await check(r.glb);
		const prim = (r.json.meshes as { primitives: { attributes: Record<string, number> }[] }[])[0].primitives[0];
		expect(prim.attributes.TEXCOORD_0).toBeTypeOf('number');
		expect(prim.attributes.COLOR_0).toBeUndefined();
		expect((r.json.images as unknown[]).length).toBe(1);
		expect(r.stats.texture).toBe(512);
	});

	it('toon export is unlit, banded and outlined, and still skinned', async () => {
		const b = await simplifyBuild(build('biped'), { triangles: 6000 });
		const r = exportGlb(b, { texture: 512, shading: 'toon', outline: 0.01 });
		await check(r.glb);
		expect(r.json.extensionsUsed).toContain('KHR_materials_unlit');
		expect(r.stats.outlines).toBe(b.meshes.length);
		const nodes = r.json.nodes as { name: string; skin?: number }[];
		const outline = nodes.filter((n) => n.name.endsWith('_outline'));
		expect(outline.length).toBe(b.meshes.length);
		expect(outline.every((n) => n.skin === 0)).toBe(true);
	});

	it('flat and toon without a texture keep vertex colors and validate', async () => {
		const b = await simplifyBuild(build('robot'), { triangles: 5000 });
		for (const shading of ['flat', 'toon'] as const) await check(exportGlb(b, { shading }).glb);
	});

	it('a kit shares one atlas between separate GLBs', async () => {
		const items = await Promise.all(['barrel', 'chest', 'torch'].map(async (id) => ({ name: id, build: await simplifyBuild(build(id), { triangles: 3000 }) })));
		const kit = exportKit(items, { atlas: 512 });
		expect(kit.files.map((f) => f.name)).toEqual(['barrel', 'chest', 'torch']);
		for (const f of kit.files) {
			await check(f.result.glb, { 'atlas.png': kit.atlas.png });
			expect((f.result.json.images as { uri: string }[])[0].uri).toBe('atlas.png');
		}
		// the models' charts sit in different places of the one atlas: no texel is claimed by two models
		const owner = new Int8Array(kit.atlas.size * kit.atlas.size).fill(-1);
		let clash = 0;
		let first = 0;
		items.forEach((it, i) => {
			for (let k = 0; k < it.build.meshes.length; k++) {
				const am = kit.atlas.meshes[first + k];
				for (let v = 0; v < am.remap.length; v++) {
					const o = Math.floor(am.uv[v * 2 + 1] * kit.atlas.size) * kit.atlas.size + Math.floor(am.uv[v * 2] * kit.atlas.size);
					if (owner[o] >= 0 && owner[o] !== i) clash++;
					owner[o] = i;
				}
			}
			first += it.build.meshes.length;
		});
		expect(clash).toBe(0);
		expect(kit.atlas.charts).toBeGreaterThan(20);
	});
});
