/**
 * Style sheets: what keeps ten assets looking like one game. A scene points
 * at a style (a path, or inline). The style's palette, material defaults and
 * settings apply to every scene that uses it, so one edit to the style
 * restyles the pack, and critics flag scenes that drift from it.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { resolveAsset } from './meshload.js';
import { hexToRgb } from './math.js';
import type { Scene } from './schema.js';

const hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'style colors are #rrggbb or #rgb');

export const Style = z.strictObject({
	format: z.literal('clayform-style/1').describe('style document version'),
	name: z.string().min(1).max(80),
	palette: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), hex).optional().describe('the pack\'s colors; scenes use these keys'),
	defaults: z
		.strictObject({
			blend: z.number().min(0).max(1).optional().describe('blend for parts that do not set one'),
			rounding: z.number().min(0).max(0.5).optional().describe('edge rounding for boxes, cylinders, cones and prisms that do not set one'),
			roughness: z.number().min(0).max(1).optional(),
			metalness: z.number().min(0).max(1).optional()
		})
		.optional(),
	settings: z
		.strictObject({
			resolution: z.number().int().min(16).max(256).optional(),
			edges: z.enum(['soft', 'sharp']).optional(),
			screenHeight: z.number().int().min(16).max(2048).optional()
		})
		.optional()
		.describe('defaults for scene settings'),
	heights: z.record(z.string(), z.tuple([z.number().positive(), z.number().positive()])).optional().describe('allowed height range in meters per category, e.g. { "character": [1.0, 1.4] }')
});
export type Style = z.infer<typeof Style>;

const cache = new Map<string, Style>();

export function loadStyle(ref: string | Style): Style {
	if (typeof ref !== 'string') return ref;
	const file = resolveAsset(ref);
	if (!existsSync(file)) throw new Error(`style file not found: ${ref} (looked in ${file})`);
	const key = `${file}|${statSync(file).mtimeMs}`;
	const hit = cache.get(key);
	if (hit) return hit;
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, 'utf8'));
	} catch (e) {
		throw new Error(`style ${ref} is not valid JSON: ${(e as Error).message}`);
	}
	const r = Style.safeParse(raw);
	if (!r.success) throw new Error(`style ${ref} is invalid: ${r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
	cache.set(key, r.data);
	return r.data;
}

const ROUNDABLE = new Set(['box', 'cylinder', 'cone', 'prism']);

/** The scene as it builds: style palette under the scene's, defaults filled in. */
export function applyStyle(scene: Scene): Scene {
	if (!scene.style) return scene;
	const st = loadStyle(scene.style as string | Style);
	const d = st.defaults ?? {};
	return {
		...scene,
		palette: { ...(st.palette ?? {}), ...(scene.palette ?? {}) },
		settings: { ...(st.settings ?? {}), ...(scene.settings ?? {}) },
		parts: scene.parts.map((p) => {
			const q = { ...p };
			if (d.blend !== undefined && q.blend === undefined && (q.op ?? 'add') === 'add') q.blend = d.blend;
			if (d.rounding !== undefined && ROUNDABLE.has(q.shape.type) && !('rounding' in q.shape && q.shape.rounding !== undefined))
				q.shape = { ...q.shape, rounding: d.rounding } as typeof q.shape;
			if (d.roughness !== undefined || d.metalness !== undefined) {
				q.material = { ...(q.material ?? {}) };
				if (d.roughness !== undefined && q.material.roughness === undefined) q.material.roughness = d.roughness;
				if (d.metalness !== undefined && q.material.metalness === undefined) q.material.metalness = d.metalness;
			}
			return q;
		})
	};
}

export interface Drift {
	code: string;
	message: string;
	parts?: string[];
}

/** Where a scene departs from its style. `height` is the built model's height. */
export function styleDrift(scene: Scene, height: number): Drift[] {
	if (!scene.style) return [];
	const st = loadStyle(scene.style as string | Style);
	const out: Drift[] = [];
	const pal = st.palette ?? {};
	const inPalette = new Set(Object.values(pal).map((h) => hexToRgb(h).map((c) => Math.round(c * 255)).join(',')));
	const off = new Map<string, string[]>();
	for (const p of scene.parts)
		for (const c of [p.material?.color, p.material?.emissive, p.pattern?.color]) {
			if (!c || !c.startsWith('#')) continue;
			if (inPalette.has(hexToRgb(c).map((x) => Math.round(x * 255)).join(','))) continue;
			off.set(c, [...(off.get(c) ?? []), p.id]);
		}
	for (const [c, ids] of off)
		out.push({ code: 'off-style-color', message: `${ids.slice(0, 4).join(', ')} use ${c}, which is not in the ${st.name} palette — use a palette key (${Object.keys(pal).slice(0, 6).join(', ')}) so the pack stays consistent`, parts: ids });
	for (const [k, v] of Object.entries(scene.palette ?? {}))
		if (pal[k] && pal[k].toLowerCase() !== v.toLowerCase())
			out.push({ code: 'style-override', message: `the scene redefines "${k}" as ${v} while the ${st.name} style says ${pal[k]} — remove it from the scene palette, or change the style for the whole pack` });
	const cat = scene.category;
	const range = cat ? st.heights?.[cat] : undefined;
	if (cat && st.heights && !range) out.push({ code: 'style-category', message: `the ${st.name} style has no height range for category "${cat}" (it has ${Object.keys(st.heights).join(', ')})` });
	if (range && (height < range[0] * 0.98 || height > range[1] * 1.02))
		out.push({ code: 'off-style-scale', message: `this ${cat} is ${height.toFixed(2)} m tall; the ${st.name} style keeps ${cat}s between ${range[0]} and ${range[1]} m — scale it (a top-level scale on the root part, or resize the parts) so the pack matches` });
	return out;
}
