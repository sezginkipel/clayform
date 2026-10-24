/**
 * Multi-Asset World & Biome Kit Generator (`create_asset_pack` / `clayform pack`).
 * Builds a cohesive set of 3D game assets sharing a unified style sheet, auto-fixes
 * critic defects, bakes a single shared PBR texture atlas, and exports both individual
 * engine-ready GLBs and a settled showcase layout.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Build } from './core/build.js';
import { userPath } from './core/files.js';
import { applyOps } from './core/ops.js';
import { buildSceneAsync } from './core/parallel.js';
import { emptyScene, type Scene } from './core/schema.js';
import { simplifyBuild } from './core/simplify.js';
import type { Style } from './core/style.js';
import { critique, extractFixes, type Report } from './critic/critics.js';
import { exportGlb } from './export/gltf.js';
import { exportKit } from './export/kit.js';
import type { Shading } from './export/texture.js';
import { buildLayout, mergeBuilds, type Layout } from './layout.js';
import { renderSheet } from './render/views.js';
import type { Workspace } from './session.js';
import { getTemplate } from './templates/index.js';

export interface PackAssetEntry {
	id: string;
	template?: string;
	scene?: string;
	category?: string;
	ops?: unknown[];
}

export interface AssetPackSpec {
	name: string;
	style?: Style | string;
	assets: PackAssetEntry[];
	atlas?: number;
	triangles?: number;
	shading?: Shading;
	bands?: number;
	outline?: number;
	collision?: 'none' | 'parts' | 'hull';
	engine?: 'godot' | 'unity' | 'unreal' | 'plain';
	embed?: boolean;
	autoFix?: boolean;
}

export interface AssetPackSummary {
	name: string;
	dir: string;
	atlasSize: number;
	atlasCoverage: number;
	previewPng: Uint8Array;
	assets: {
		id: string;
		glbPath: string;
		triangles: number;
		bytes: number;
		ok: boolean;
		autoFixed: number;
		issues: string[];
	}[];
	layoutGlbPath: string;
}

export async function buildAssetPack(ws: Workspace, spec: AssetPackSpec, outDir?: string): Promise<AssetPackSummary> {
	if (!spec.assets?.length) throw new Error('asset pack needs at least one asset in assets[]');
	const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'pack';
	const dir = outDir ? userPath(outDir) : resolve(ws.exportsDir(), slug);
	mkdirSync(dir, { recursive: true });

	const resolvedScenes = new Map<string, Scene>();
	const fullBuilds = new Map<string, Build>();
	const simplifiedBuilds = new Map<string, Build>();
	const reports = new Map<string, { report: Report; autoFixed: number }>();

	for (const entry of spec.assets) {
		const id = entry.id.replace(/[^a-zA-Z0-9_-]+/g, '_');
		let doc: Scene;
		if (entry.template) {
			const t = getTemplate(entry.template);
			if (!t) throw new Error(`unknown template "${entry.template}" in asset "${entry.id}"`);
			doc = JSON.parse(JSON.stringify(t.scene));
			doc.name = entry.id;
		} else if (entry.scene) {
			doc = JSON.parse(JSON.stringify(ws.get(entry.scene)));
			doc.name = entry.id;
		} else {
			try {
				doc = JSON.parse(JSON.stringify(ws.get(entry.id)));
			} catch {
				doc = emptyScene(entry.id);
			}
		}

		if (spec.style) doc.style = spec.style;
		if (entry.category) doc.category = entry.category;

		if (entry.ops?.length) {
			const edited = applyOps(doc, entry.ops);
			if (!edited.ok) throw new Error(`failed applying ops to "${entry.id}": ${edited.error}`);
			doc = edited.scene;
		}

		let build = await buildSceneAsync(doc);
		let rep = critique(build);
		let autoFixedCount = 0;

		if (spec.autoFix !== false) {
			const fixes = extractFixes(rep);
			if (fixes.length > 0) {
				const fixed = applyOps(doc, fixes);
				if (fixed.ok) {
					doc = fixed.scene;
					build = await buildSceneAsync(doc);
					rep = critique(build);
					autoFixedCount = fixes.length;
				}
			}
		}

		ws.import(doc, entry.id);
		resolvedScenes.set(id, doc);
		fullBuilds.set(id, build);
		reports.set(id, { report: rep, autoFixed: autoFixedCount });
		simplifiedBuilds.set(id, await simplifyBuild(build, spec.triangles ? { triangles: spec.triangles } : {}));
	}

	const kitItems = [...simplifiedBuilds.entries()].map(([name, build]) => ({ name, build }));
	const kit = exportKit(kitItems, {
		atlas: spec.atlas ?? 1024,
		embed: spec.embed,
		shading: spec.shading,
		bands: spec.bands,
		outline: spec.outline,
		collision: spec.collision ?? 'parts',
		naming: spec.engine ?? 'plain'
	});

	if (!spec.embed) {
		writeFileSync(join(dir, 'atlas.png'), kit.atlas.png);
		if (kit.atlas.normalPng) writeFileSync(join(dir, 'atlas_normal.png'), kit.atlas.normalPng);
		if (kit.atlas.ormPng) writeFileSync(join(dir, 'atlas_orm.png'), kit.atlas.ormPng);
	}

	const assetResults: AssetPackSummary['assets'] = [];
	for (const f of kit.files) {
		const glbPath = join(dir, `${f.name}.glb`);
		writeFileSync(glbPath, f.result.glb);
		const meta = reports.get(f.name)!;
		assetResults.push({
			id: f.name,
			glbPath,
			triangles: f.result.stats.triangles,
			bytes: f.result.stats.bytes,
			ok: meta.report.ok,
			autoFixed: meta.autoFixed,
			issues: meta.report.issues.filter((i) => i.severity !== 'info').map((i) => `${i.severity.toUpperCase()} [${i.code}] ${i.message}`)
		});
	}

	// Arrange all pack assets in a neat grid layout and settle them
	const cols = Math.max(1, Math.ceil(Math.sqrt(kitItems.length)));
	const spacing = 2.6;
	const layoutDoc: Layout = {
		format: 'clayform-layout/1',
		name: spec.name,
		settle: true,
		items: kitItems.map((it, idx) => {
			const row = Math.floor(idx / cols);
			const col = idx % cols;
			const x = (col - (cols - 1) / 2) * spacing;
			const z = (row - (Math.ceil(kitItems.length / cols) - 1) / 2) * spacing;
			return {
				id: `${it.name}_item`,
				scene: it.name,
				position: [x, z] as [number, number]
			};
		})
	};

	const lb = buildLayout(layoutDoc, (ref) => resolvedScenes.get(ref) ?? ws.resolveScene(ref));
	const merged = mergeBuilds(lb, simplifiedBuilds);
	const previewPng = renderSheet(merged, { views: ['three_quarter', 'top'], size: 420 }).png;
	writeFileSync(join(dir, 'pack_preview.png'), previewPng);

	const layoutGlbPath = join(dir, `${slug}_layout.glb`);
	writeFileSync(layoutGlbPath, exportGlb(merged, { rig: false }).glb);

	const manifest = {
		name: spec.name,
		engine: spec.engine ?? 'plain',
		atlas: {
			size: kit.atlas.size,
			charts: kit.atlas.charts,
			coverage: +(kit.atlas.coverage * 100).toFixed(1),
			texelsPerMeter: Math.round(kit.atlas.texelsPerMeter)
		},
		assets: assetResults,
		layoutGlb: `${slug}_layout.glb`
	};
	writeFileSync(join(dir, 'pack.manifest.json'), JSON.stringify(manifest, null, 2));

	return {
		name: spec.name,
		dir,
		atlasSize: kit.atlas.size,
		atlasCoverage: kit.atlas.coverage,
		previewPng,
		assets: assetResults,
		layoutGlbPath
	};
}
