/**
 * A kit: several models exported side by side, all painted from one texture
 * atlas. Engines load the atlas once and can batch every piece of the kit
 * with a single material.
 */

import type { Build } from '../core/build.js';
import { exportGlb, glbMeshes, type GlbOptions, type GlbResult } from './gltf.js';
import { bakeAtlas, type Atlas } from './texture.js';

export interface KitItem {
	name: string;
	build: Build;
	lods?: Build[];
}

export interface KitOptions extends Omit<GlbOptions, 'texture' | 'atlas' | 'lods'> {
	/** atlas size in pixels (default 2048) */
	atlas?: number;
	/** embed the atlas in every GLB instead of pointing at a shared file */
	embed?: boolean;
	/** file name the GLBs point at (default atlas.png) */
	uri?: string;
}

export interface KitResult {
	atlas: Atlas;
	files: { name: string; result: GlbResult }[];
}

export function exportKit(items: KitItem[], opts: KitOptions = {}): KitResult {
	if (!items.length) throw new Error('a kit needs at least one scene');
	const toon = opts.shading === 'toon';
	const lists = items.map((it) => glbMeshes(it.build, { lods: it.lods, shading: opts.shading, bands: opts.bands, texture: 1 }));
	const atlas = bakeAtlas(lists.flat(), { size: opts.atlas ?? 2048, bakeAo: opts.bakeAo, toonBands: toon ? opts.bands ?? 3 : 0 });
	let first = 0;
	const files = items.map((it, i) => {
		const result = exportGlb(it.build, { ...opts, lods: it.lods, atlas: { atlas, first, uri: opts.embed ? undefined : opts.uri ?? 'atlas.png' } });
		first += lists[i].length;
		return { name: it.name, result };
	});
	return { atlas, files };
}
