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

	render(args: { scene: string; views?: unknown; mode?: RenderMode; size?: number }): Promise<Result> {
		return wrap(() => {
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

	exportScene(args: { scene: string; format?: 'glb' | 'obj' | 'json' | 'flipbook'; path?: string; triangles?: number; effect?: string; bakeAo?: boolean }): Promise<Result> {
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
			const r = exportGlb(b, { bakeAo: args.bakeAo });
			writeFileSync(out, r.glb);
			const s = r.stats;
			return {
				content: [text(`wrote ${out} · ${(s.bytes / 1024).toFixed(0)} KB · ${s.triangles.toLocaleString('en')} triangles (from ${full.stats.triangles.toLocaleString('en')}) · ${s.meshes} meshes · ${s.materials} materials${s.joints ? ` · ${s.joints} joints` : ''}${s.animations ? ` · ${s.animations} animations` : ''}`)]
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
