/**
 * Tool handlers shared by the MCP server (and usable programmatically).
 * Each returns MCP content blocks: text for facts, PNG images for eyes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildRig, critiqueClip, sampleClip } from '../anim/rig.js';
import { simplifyBuild } from '../core/simplify.js';
import { critique, formatReport } from '../critic/critics.js';
import { exportGlb, exportObj } from '../export/gltf.js';
import { GUIDE } from '../guide.js';
import { renderClipStrip } from '../render/motion.js';
import { renderSheet, VIEWS, type View } from '../render/views.js';
import type { RenderMode } from '../render/raster.js';
import { describe, Workspace } from '../session.js';
import { TEMPLATES } from '../templates/index.js';
import { bakeEffect, resolveEffect } from '../vfx/effects.js';
import { measureBetween, measurePart, measureRatio, partAtPixel } from '../measure.js';
import { fitReference } from '../reference.js';
import { findLibraryParts } from '../library/parts.js';
import { critiqueLayout, describeLayout, mergeBuilds } from '../layout.js';
import type { Build } from '../core/build.js';
import { resolveAsset } from '../core/meshload.js';
import { buildScene } from '../core/build.js';
import { renderTiles } from '../render/views.js';
import { drawText } from '../render/font.js';
import { encodePng } from '../render/png.js';
import type { Scene as SceneDoc } from '../core/schema.js';
import { z } from 'zod';
import { Scene } from '../core/schema.js';

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface Result {
	content: Content[];
	isError?: boolean;
	[k: string]: unknown;
}

const text = (t: string): Content => ({ type: 'text', text: t });
const png = (b: Uint8Array): Content => ({ type: 'image', data: Buffer.from(b).toString('base64'), mimeType: 'image/png' });
const fail = (m: string): Result => ({ content: [text(m)], isError: true });

function wrap(fn: () => Result | Promise<Result>): Promise<Result> {
	return Promise.resolve()
		.then(fn)
		.catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
}

function parseViews(v: unknown): View[] | undefined {
	if (!Array.isArray(v) || !v.length) return undefined;
	return v.map((x) => {
		if (typeof x === 'string') {
			if (!(VIEWS as readonly string[]).includes(x)) throw new Error(`unknown view "${x}" — use ${VIEWS.join(', ')} or { yaw, pitch }`);
			return x as View;
		}
		if (x && typeof x === 'object' && 'yaw' in x) return { yaw: Number((x as { yaw: number }).yaw), pitch: Number((x as { pitch?: number }).pitch ?? 20) };
		throw new Error('a view is a name or { yaw, pitch }');
	});
}

export class Tools {
	constructor(readonly ws: Workspace) {}

	guide(args: { topic?: string }): Promise<Result> {
		return wrap(() => {
			if (args.topic === 'schema') return { content: [text(JSON.stringify(z.toJSONSchema(Scene), null, 1))] };
			return { content: [text(GUIDE)] };
		});
	}

	listTemplates(): Promise<Result> {
		return wrap(() => ({
			content: [text(TEMPLATES.map((t) => `${t.id} — ${t.title} [${t.tags.join(', ')}]: ${t.description}`).join('\n'))]
		}));
	}

	newScene(args: { name: string; template?: string }): Promise<Result> {
		return wrap(() => {
			const { id, scene } = this.ws.create(args.name, args.template);
			const b = this.ws.build(id);
			return { content: [text(`created scene "${id}"${args.template ? ` from template ${args.template}` : ''}\n\n${describe(scene)}\n\n${formatReport(critique(b))}`)] };
		});
	}

	listParts(args: { query?: string }): Promise<Result> {
		return wrap(() => {
			const list = findLibraryParts(args.query);
			if (!list.length) return { content: [text(`no library part matches "${args.query}" — try eye, ear, tail, wheel, window, hat`)] };
			return { content: [text(list.map((p) => `${p.name} — ${p.description} [${p.tags.join(', ')}] · usual side: ${p.side}${p.pair ? ' · mirrored pair' : ''}`).join('\n') + '\n\nAdd one with edit: {"op":"add_library_part","name":"eye_cartoon","id":"eye","attach":{"to":"head","offset":[0.4,0.1]}}')] };
		});
	}

	listScenes(): Promise<Result> {
		return wrap(() => {
			const l = this.ws.list();
			return { content: [text(l.length ? l.map((s) => `${s.id} — "${s.name}" · ${s.parts} parts · ${s.clips} clips · ${s.effects} effects`).join('\n') : 'no scenes yet — call new_scene (list_templates shows starting points)')] };
		});
	}

	getScene(args: { scene: string; format?: 'summary' | 'json' }): Promise<Result> {
		return wrap(() => {
			const s = this.ws.get(args.scene);
			return { content: [text(args.format === 'json' ? JSON.stringify(s, null, 1) : describe(s))] };
		});
	}

	edit(args: { scene: string; ops: unknown[]; render?: boolean }): Promise<Result> {
		return wrap(() => {
			if (!Array.isArray(args.ops) || !args.ops.length) return fail('ops must be a non-empty array — see guide (Edit ops)');
			const r = this.ws.edit(args.scene, args.ops);
			if (!r.ok) return fail(`nothing was changed:\n${r.error}`);
			const b = this.ws.build(args.scene);
			const rep = critique(b);
			const out: Content[] = [text(`${r.changes.join('\n')}\n\n${formatReport(rep)}`)];
			if (args.render) out.push(png(renderSheet(b, { views: ['three_quarter'], size: 384 }).png));
			return { content: out };
		});
	}

	render(args: { scene: string; views?: unknown; mode?: RenderMode; size?: number; compare?: 'previous' }): Promise<Result> {
		return wrap(() => {
			if (args.compare === 'previous') return this.compare(args);
			const b = this.ws.build(args.scene);
			const views = parseViews(args.views);
			const size = Math.max(128, Math.min(768, Math.round(args.size ?? (views && views.length === 1 ? 512 : 384))));
			const sheet = renderSheet(b, { views, mode: args.mode ?? 'shaded', size });
			const rep = critique(b);
			const lines = [`views: ${sheet.views.join(', ')} (left→right, top→bottom)`];
			if (sheet.legend.length) lines.push(`parts: ${sheet.legend.map((l) => `${l.id}=${l.color}`).join(' ')}`);
			lines.push(formatReport(rep));
			return { content: [png(sheet.png), text(lines.join('\n'))] };
		});
	}

	private compare(args: { scene: string; views?: unknown; mode?: RenderMode; size?: number }): Result {
		const before = this.ws.previous(args.scene);
		if (!before) return fail('there is no earlier version to compare with — this scene has not been edited yet (or the edits were undone)');
		const after = this.ws.get(args.scene);
		const bb = buildScene(before), ba = this.ws.build(args.scene);
		const views = parseViews(args.views) ?? ['front', 'three_quarter'];
		const size = Math.max(128, Math.min(512, Math.round(args.size ?? 300)));
		// one camera for both states
		const bounds = {
			min: [0, 1, 2].map((a) => Math.min(bb.min[a], ba.min[a])) as [number, number, number],
			max: [0, 1, 2].map((a) => Math.max(bb.max[a], ba.max[a])) as [number, number, number]
		};
		const rows = [bb, ba].map((b) => renderTiles(b, { views, size, mode: args.mode ?? 'shaded', bounds }).tiles);
		const gap = 4, W = views.length * size + (views.length - 1) * gap, H = size * 2 + gap;
		const buf = new Uint8Array(W * H * 4).fill(250);
		rows.forEach((tiles, r) =>
			tiles.forEach((t, i) => {
				const ox = i * (size + gap), oy = r * (size + gap);
				for (let y = 0; y < size; y++) buf.set(t.data.subarray(y * size * 4, (y + 1) * size * 4), ((oy + y) * W + ox) * 4);
				drawText(buf, W, H, ox + 8, oy + 8, `${r ? 'after' : 'before'} ${typeof views[i] === 'string' ? views[i] : 'custom'}`, [70, 70, 76], 2);
			})
		);
		for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
		return { content: [png(encodePng(buf, W, H)), text(`top row: before the last edit · bottom row: now\n${changedParts(before, after)}\n${formatReport(critique(ba))}`)] };
	}

	measure(args: { scene: string; queries: unknown[] }): Promise<Result> {
		return wrap(() => {
			if (!Array.isArray(args.queries) || !args.queries.length) return fail('queries must be a non-empty array, e.g. [{"between":["hand","leg"]}]');
			const b = this.ws.build(args.scene);
			const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;
			const lines = args.queries.map((q, i) => {
				const Q = q as Record<string, any>;
				try {
					if (Array.isArray(Q.between)) {
						const r = measureBetween(b, String(Q.between[0]), String(Q.between[1]));
						return r.distance < 0
							? `${r.a} and ${r.b} overlap by ${cm(-r.distance)} (deepest near [${r.pointA.join(', ')}])`
							: `${r.a} to ${r.b}: ${cm(r.distance)} apart, closest points [${r.pointA.join(', ')}] and [${r.pointB.join(', ')}]`;
					}
					if (typeof Q.part === 'string') {
						const r = measurePart(b, Q.part);
						return `${r.id}: size ${r.size.map(cm).join(' × ')}, center [${r.center.join(', ')}], from [${r.min.join(', ')}] to [${r.max.join(', ')}]${r.touchesGround ? ', touches the ground' : ''}${r.visible ? '' : ' — not visible (buried or too small), bounds are its shape'}`;
					}
					if (Array.isArray(Q.ratio)) {
						const axis = (Q.axis ?? 'y') as 'x' | 'y' | 'z' | 'max';
						const r = measureRatio(b, String(Q.ratio[0]), String(Q.ratio[1]), axis);
						return `${Q.ratio[0]} / ${Q.ratio[1]} along ${axis}: ${r.ratio} (${cm(r.a)} / ${cm(r.b)})`;
					}
					if (Q.pixel && typeof Q.pixel === 'object') {
						const view = parseViews([Q.pixel.view ?? 'front'])![0];
						const id = partAtPixel(b, view, Number(Q.pixel.x), Number(Q.pixel.y), Number(Q.pixel.size ?? 384));
						return `pixel (${Q.pixel.x}, ${Q.pixel.y}) in ${Q.pixel.view ?? 'front'} at ${Q.pixel.size ?? 384} px: ${id ?? 'background'}`;
					}
					return `query ${i}: use one of {between: [a, b]}, {part: id}, {ratio: [a, b], axis}, {pixel: {view, x, y, size}}`;
				} catch (e) {
					return `query ${i}: ${e instanceof Error ? e.message : String(e)}`;
				}
			});
			return { content: [text(lines.join('\n'))] };
		});
	}

	compareReference(args: { scene: string; image: string; view?: unknown }): Promise<Result> {
		return wrap(() => {
			const view = parseViews([args.view ?? 'front'])![0];
			const b = this.ws.build(args.scene);
			const fit = fitReference(b, resolveAsset(args.image), view);
			return {
				content: [
					png(fit.overlay),
					text(`fit against ${args.image} (${typeof view === 'string' ? view : 'custom'} view): IoU ${fit.iou.toFixed(2)} — gray both, orange only in the reference, blue only in the model\n${fit.advice.map((a) => '• ' + a).join('\n')}\nFix the biggest difference first, then compare again: the score should go up.`)
				]
			};
		});
	}

	setLayout(args: { name: string; layout: unknown }): Promise<Result> {
		return wrap(() => {
			const { id } = this.ws.setLayout(args.name, args.layout);
			const lb = this.ws.buildLayout(id);
			const issues = critiqueLayout(lb);
			return { content: [text(`saved layout "${id}"\n${describeLayout(lb)}\n${issues.length ? issues.map((i) => `${i.severity.toUpperCase()} [${i.code}] ${i.message}`).join('\n') : 'no overlaps'}`)] };
		});
	}

	renderLayout(args: { layout: string; views?: unknown; size?: number; mode?: 'shaded' | 'parts' | 'clay' }): Promise<Result> {
		return wrap(() => {
			const lb = this.ws.buildLayout(args.layout);
			const views = parseViews(args.views) ?? ['top', 'three_quarter'];
			const sheet = renderSheet(lb.merged, { views, size: Math.max(128, Math.min(768, args.size ?? 420)), mode: args.mode ?? 'shaded' });
			const issues = critiqueLayout(lb);
			return {
				content: [
					png(sheet.png),
					text(`${describeLayout(lb)}\nviews: ${sheet.views.join(', ')}\n${issues.length ? issues.map((i) => `${i.severity.toUpperCase()} [${i.code}] ${i.message}`).join('\n') : 'no overlaps'}`)
				]
			};
		});
	}

	exportLayout(args: { layout: string; path?: string; triangles?: number }): Promise<Result> {
		return wrap(async () => {
			const lb = this.ws.buildLayout(args.layout);
			// simplify each distinct scene once, then rebuild the merged layout from the simplified builds
			const simplified = new Map<string, Build>();
			for (const [ref, b] of lb.builds) simplified.set(ref, await simplifyBuild(b, args.triangles ? { triangles: args.triangles } : {}));
			const merged = mergeBuilds(lb, simplified);
			const out = resolve(args.path ?? `${this.ws.exportsDir()}/${args.layout}.glb`);
			mkdirSync(dirname(out), { recursive: true });
			const r = exportGlb(merged, { rig: false });
			writeFileSync(out, r.glb);
			return { content: [text(`wrote ${out} · ${(r.stats.bytes / 1024).toFixed(0)} KB · ${lb.placed.length} items · ${r.stats.triangles.toLocaleString('en')} triangles`)] };
		});
	}

	inspect(args: { scene: string }): Promise<Result> {
		return wrap(() => {
			const scene = this.ws.get(args.scene);
			const b = this.ws.build(args.scene);
			const rep = critique(b);
			const lines = [describe(scene), '', formatReport(rep)];
			const clips = scene.clips ?? [];
			if (clips.length) {
				const rig = buildRig(b);
				for (const c of clips) {
					const m = critiqueClip(b, rig, sampleClip(b, rig, c), scene.settings?.ground !== 'none');
					lines.push(`clip ${c.id}: lowest point ${(m.minY * 100).toFixed(1)} cm${m.issues.length ? '\n  ' + m.issues.join('\n  ') : ''}`);
				}
			}
			return { content: [text(lines.join('\n'))] };
		});
	}

	previewMotion(args: { scene: string; clip: string; frames?: number; view?: unknown }): Promise<Result> {
		return wrap(() => {
			const b = this.ws.build(args.scene);
			const view = parseViews(args.view ? [args.view] : undefined)?.[0];
			const s = renderClipStrip(b, args.clip, { frames: args.frames ?? 6, view: view ?? 'left', size: 220 });
			const m = critiqueClip(b, s.rig, s.clip, b.compiled.scene.settings?.ground !== 'none');
			const moving = s.clip.channels.map((c) => s.rig.joints[c.joint].name).join(', ');
			return {
				content: [
					png(s.png),
					text(`clip ${args.clip}: ${s.clip.duration.toFixed(2)} s at ${s.clip.fps} fps, frames at ${s.times.map((t) => t.toFixed(2)).join(', ')} s\nmoving: ${moving || 'nothing'}\nlowest point ${(m.minY * 100).toFixed(1)} cm${m.issues.length ? '\n' + m.issues.join('\n') : ''}`)
				]
			};
		});
	}

	previewEffect(args: { scene: string; effect: string }): Promise<Result> {
		return wrap(() => {
			const scene = this.ws.get(args.scene);
			const e = scene.effects?.find((x) => x.id === args.effect);
			if (!e) return fail(`no effect "${args.effect}"${scene.effects?.length ? ` — effects: ${scene.effects.map((x) => x.id).join(', ')}` : ' — add one with add_effect'}`);
			const fb = bakeEffect(resolveEffect(scene, e));
			return { content: [png(fb.preview), text(`${fb.meta.frames} frames, ${fb.meta.fps} fps, ${fb.meta.loop ? 'looping' : 'one-shot'}, ${fb.meta.blend} blend, ${fb.stats.peakAlive} particles at peak, tile covers ${fb.meta.metersPerTile} m`)] };
		});
	}

	exportScene(args: { scene: string; format?: 'glb' | 'obj' | 'json' | 'flipbook'; path?: string; triangles?: number; effect?: string; bakeAo?: boolean; lods?: number[]; collision?: 'none' | 'parts' | 'hull'; engine?: 'godot' | 'unreal' | 'unity' | 'plain' }): Promise<Result> {
		return wrap(async () => {
			const scene = this.ws.get(args.scene);
			const fmt = args.format ?? 'glb';
			const out = resolve(args.path ?? `${this.ws.exportsDir()}/${args.scene}${fmt === 'flipbook' ? `-${args.effect ?? 'effect'}.png` : `.${fmt}`}`);
			mkdirSync(dirname(out), { recursive: true });
			if (fmt === 'json') {
				writeFileSync(out, JSON.stringify(scene, null, 2));
				return { content: [text(`wrote ${out}`)] };
			}
			if (fmt === 'flipbook') {
				const id = args.effect ?? scene.effects?.[0]?.id;
				const e = scene.effects?.find((x) => x.id === id);
				if (!e) return fail('this scene has no effect to export — pass effect: "<id>"');
				const fb = bakeEffect(resolveEffect(scene, e));
				writeFileSync(out, fb.sheet);
				const meta = out.replace(/\.png$/i, '') + '.json';
				writeFileSync(meta, JSON.stringify(fb.meta, null, 2));
				return { content: [text(`wrote ${out} (${fb.meta.columns}×${fb.meta.rows} tiles of ${fb.meta.tile}px) and ${meta}`)] };
			}
			const full = this.ws.build(args.scene);
			const b = await simplifyBuild(full, args.triangles ? { triangles: args.triangles } : {});
			if (fmt === 'obj') {
				writeFileSync(out, exportObj(b));
				return { content: [text(`wrote ${out} · ${b.stats.triangles.toLocaleString('en')} triangles (from ${full.stats.triangles.toLocaleString('en')})`)] };
			}
			const lods = [];
			for (const f of args.lods ?? []) lods.push(await simplifyBuild(full, { triangles: Math.max(100, Math.round(b.stats.triangles * f)) }));
			const r = exportGlb(b, { bakeAo: args.bakeAo, lods, collision: args.collision, naming: args.engine });
			writeFileSync(out, r.glb);
			const s = r.stats;
			return {
				content: [text(`wrote ${out} · ${(s.bytes / 1024).toFixed(0)} KB · ${s.triangles.toLocaleString('en')} triangles (from ${full.stats.triangles.toLocaleString('en')}) · ${s.meshes} meshes · ${s.materials} materials${s.joints ? ` · ${s.joints} joints` : ''}${s.animations ? ` · ${s.animations} animations` : ''}${s.lods > 1 ? ` · ${s.lods} levels of detail (${[b, ...lods].map((x) => x.stats.triangles).join(' / ')} triangles)` : ''}${s.colliders ? ` · ${s.colliders} convex colliders` : ''}`)]
			};
		});
	}

	history(args: { scene: string; action: 'undo' | 'redo' | 'snapshot' | 'restore' | 'list'; label?: string }): Promise<Result> {
		return wrap(() => {
			const id = args.scene;
			switch (args.action) {
				case 'undo':
					return { content: [text(this.ws.undo(id) ? `undone · ${JSON.stringify(this.ws.history(id))}` : 'nothing to undo')] };
				case 'redo':
					return { content: [text(this.ws.redo(id) ? `redone · ${JSON.stringify(this.ws.history(id))}` : 'nothing to redo')] };
				case 'snapshot':
					if (!args.label) return fail('snapshot needs a label');
					this.ws.snapshot(id, args.label);
					return { content: [text(`saved snapshot "${args.label}"`)] };
				case 'restore':
					if (!args.label) return fail('restore needs a label');
					return this.ws.restore(id, args.label) ? { content: [text(`restored "${args.label}" (undo brings back the previous state)`)] } : fail(`no snapshot "${args.label}" — snapshots: ${this.ws.snapshots(id).join(', ') || 'none'}`);
				case 'list':
					return { content: [text(`snapshots: ${this.ws.snapshots(id).join(', ') || 'none'} · ${JSON.stringify(this.ws.history(id))}`)] };
			}
		});
	}

	importScene(args: { path?: string; json?: unknown; name?: string }): Promise<Result> {
		return wrap(() => {
			const r = args.path ? this.ws.load(args.path) : this.ws.import(typeof args.json === 'string' ? JSON.parse(args.json) : args.json, args.name);
			return { content: [text(`imported as "${r.id}"\n\n${describe(r.scene)}`)] };
		});
	}
}

/** JSON with sorted keys, so two equal parts compare equal whatever order their fields were written in. */
function stable(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
	if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
	return JSON.stringify(v);
}

function changedParts(before: SceneDoc, after: SceneDoc): string {
	const b = new Map(before.parts.map((p) => [p.id, stable(p)]));
	const a = new Map(after.parts.map((p) => [p.id, stable(p)]));
	const added = [...a.keys()].filter((k) => !b.has(k));
	const removed = [...b.keys()].filter((k) => !a.has(k));
	const changed = [...a.keys()].filter((k) => b.has(k) && b.get(k) !== a.get(k));
	const other = (['sculpts', 'clips', 'effects', 'palette', 'settings'] as const).filter((k) => stable(before[k] ?? null) !== stable(after[k] ?? null));
	const bits = [
		added.length ? `added ${added.join(', ')}` : '',
		removed.length ? `removed ${removed.join(', ')}` : '',
		changed.length ? `changed ${changed.join(', ')}` : '',
		other.length ? `also changed: ${other.join(', ')}` : ''
	].filter(Boolean);
	return bits.length ? bits.join(' · ') : 'no part changed';
}
