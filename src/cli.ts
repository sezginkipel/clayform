#!/usr/bin/env node
/**
 * clayform mcp [--workspace dir]            start the MCP server on stdio
 * clayform serve [--port 8787] [--token T]   MCP over streamable HTTP, one workspace per session
 * clayform templates                        list templates
 * clayform new <template> [-o file]         write a template as a scene file
 * clayform render <scene> [-o png] [--views a,b] [--mode parts] [--size 384]
 * clayform inspect <scene>                  critics + part summary
 * clayform export <scene> [-o out.glb] [--triangles N] [--texture 1024] [--shading flat|toon]
 * clayform kit <scene...> [-o dir] [--atlas 2048]   several models sharing one texture
 * clayform motion <scene> <clip> [-o png] [--view left]
 * clayform effect <scene> <effect> [-o png]
 * clayform view <scene|template|file.glb>    local three.js viewer (plays clips)
 * clayform guide                            print the agent manual
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildRig, critiqueClip, sampleClip } from './anim/rig.js';
import { buildScene } from './core/build.js';
import { buildSceneAsync } from './core/parallel.js';
import { parseScene, type Scene } from './core/schema.js';
import { simplifyBuild } from './core/simplify.js';
import { critique, formatReport } from './critic/critics.js';
import { exportGlb, exportObj } from './export/gltf.js';
import { GUIDE } from './guide.js';
import { renderClipStrip } from './render/motion.js';
import type { RenderMode } from './render/raster.js';
import { renderSheet, type View } from './render/views.js';
import { describe } from './session.js';
import { getTemplate, TEMPLATES } from './templates/index.js';
import { VERSION } from './version.js';
import { bakeEffect, resolveEffect } from './vfx/effects.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = new Map<string, string>();
const pos: string[] = [];
for (let i = 1; i < argv.length; i++) {
	const a = argv[i];
	if (a.startsWith('--')) flags.set(a.slice(2), argv[i + 1]?.startsWith('-') || argv[i + 1] === undefined ? 'true' : argv[++i]);
	else if (a === '-o') flags.set('out', argv[++i]);
	else pos.push(a);
}

function loadScene(path: string | undefined): Scene {
	if (!path) die('missing scene file (a .clay.json) or template id');
	const t = getTemplate(path!);
	if (t) return t.scene;
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path!, 'utf8'));
	} catch (e) {
		die(`cannot read ${path}: ${(e as Error).message}`);
	}
	const r = parseScene(raw);
	if (!r.ok) die(`${path} is not a valid scene:\n${r.error}`);
	return (r as { ok: true; scene: Scene }).scene;
}

function die(m: string): never {
	process.stderr.write(m + '\n');
	process.exit(1);
}

/** Like loadScene but throws instead of exiting (watch mode keeps running). */
function loadSceneSoft(path: string): Scene {
	const t = getTemplate(path);
	if (t) return t.scene;
	const r = parseScene(JSON.parse(readFileSync(path, 'utf8')));
	if (!r.ok) throw new Error(r.error);
	return r.scene;
}

const stem = (p: string) => basename(p).replace(/\.clay\.json$|\.json$/i, '');

/** The look flags shared by export and kit. */
function lookFlags() {
	const shading = flags.get('shading');
	if (shading && !['smooth', 'flat', 'toon'].includes(shading)) die('--shading is smooth, flat or toon');
	const num = (k: string) => (flags.has(k) ? Number(flags.get(k)) : undefined);
	return {
		shading: shading as 'smooth' | 'flat' | 'toon' | undefined,
		bands: num('bands'),
		outline: num('outline'),
		collision: flags.get('collision') as 'parts' | 'hull' | undefined,
		naming: flags.get('engine') as 'godot' | 'unreal' | 'unity' | undefined
	};
}

async function main() {
	switch (cmd) {
		case 'mcp': {
			const { serveStdio } = await import('./mcp/server.js');
			await serveStdio(flags.get('workspace'));
			return;
		}
		case 'serve': {
			const { serveHttp } = await import('./mcp/http.js');
			const num = (k: string) => (flags.has(k) ? Number(flags.get(k)) : undefined);
			const h = await serveHttp({
				port: num('port'),
				host: flags.get('host'),
				workspace: flags.get('workspace'),
				token: flags.get('token') ?? process.env.CLAYFORM_TOKEN,
				maxSessions: num('max-sessions'),
				idleMinutes: num('idle'),
				keep: flags.has('keep')
			});
			console.log(`Clayform MCP over HTTP at ${h.url}${flags.get('token') ?? process.env.CLAYFORM_TOKEN ? ' (bearer token required)' : ''} · one workspace per session`);
			return;
		}
		case 'templates':
			for (const t of TEMPLATES) console.log(`${t.id.padEnd(10)} ${t.title} — ${t.description}`);
			return;
		case 'new': {
			const t = getTemplate(pos[0] ?? '');
			if (!t) die(`unknown template "${pos[0] ?? ''}" — run: clayform templates`);
			const out = flags.get('out') ?? `${t!.id}.clay.json`;
			writeFileSync(out, JSON.stringify(t!.scene, null, 2));
			console.log(`wrote ${out}`);
			return;
		}
		case 'render': {
			const scene = loadScene(pos[0]);
			const b = await buildSceneAsync(scene);
			const views = flags.get('views')?.split(',').map((v) => v.trim()) as View[] | undefined;
			const sheet = renderSheet(b, { views, mode: (flags.get('mode') as RenderMode) ?? 'shaded', size: Number(flags.get('size') ?? 384) });
			const out = flags.get('out') ?? `${stem(pos[0]!)}.png`;
			writeFileSync(out, sheet.png);
			console.log(`wrote ${out} (${sheet.views.join(', ')})`);
			if (sheet.legend.length) console.log(sheet.legend.map((l) => `${l.id}=${l.color}`).join(' '));
			console.log(formatReport(critique(b)));
			return;
		}
		case 'inspect': {
			const scene = loadScene(pos[0]);
			const b = await buildSceneAsync(scene);
			console.log(describe(scene) + '\n\n' + formatReport(critique(b)));
			if (scene.clips?.length) {
				const rig = buildRig(b);
				for (const c of scene.clips) {
					const m = critiqueClip(b, rig, sampleClip(b, rig, c), scene.settings?.ground !== 'none');
					console.log(`clip ${c.id}: lowest ${(m.minY * 100).toFixed(1)} cm ${m.issues.join(' ')}`);
				}
			}
			const r = critique(b);
			process.exitCode = r.ok ? 0 : 2;
			return;
		}
		case 'export': {
			const scene = loadScene(pos[0]);
			const full = await buildSceneAsync(scene);
			const tri = flags.get('triangles');
			const b = await simplifyBuild(full, tri ? { triangles: Number(tri) } : {});
			const out = flags.get('out') ?? `${stem(pos[0]!)}.glb`;
			if (out.toLowerCase().endsWith('.obj')) writeFileSync(out, exportObj(b));
			else {
				const lods = [];
				for (const f of (flags.get('lods') ?? '').split(',').filter(Boolean).map(Number)) lods.push(await simplifyBuild(full, { triangles: Math.max(100, Math.round(b.stats.triangles * f)) }));
				const skeleton = flags.get('skeleton');
				if (skeleton && !['parts', 'humanoid', 'mixamo', 'unreal'].includes(skeleton)) die('--skeleton is parts, humanoid, mixamo or unreal');
				let r;
				try {
					r = exportGlb(b, { lods, texture: flags.has('texture') ? Number(flags.get('texture')) : undefined, skeleton: skeleton as 'parts' | undefined, ...lookFlags() });
				} catch (e) {
					die((e as Error).message);
				}
				writeFileSync(out, r.glb);
				if (r.atlas) console.log(`texture ${r.atlas.size}px · ${r.atlas.charts} charts · ${Math.round(r.atlas.coverage * 100)}% used · ${Math.round(r.atlas.texelsPerMeter)} texels per meter`);
			}
			console.log(`wrote ${out} · ${b.stats.triangles} triangles (from ${full.stats.triangles})`);
			if ((b as { simplified?: { overBudget: boolean } }).simplified?.overBudget) console.log(`over the ${tri}-triangle budget: ${b.meshes.length} meshes cannot go lower without losing parts (each keeps at least 12)`);
			return;
		}
		case 'kit': {
			if (!pos.length) die('usage: clayform kit <scene|template> [more …] [-o dir] [--atlas 2048] [--triangles N] [--embed]');
			const { exportKit } = await import('./export/kit.js');
			const { mkdirSync } = await import('node:fs');
			const dir = flags.get('out') ?? 'kit';
			const tri = flags.get('triangles');
			const items = [];
			for (const ref of pos) {
				const full = await buildSceneAsync(loadScene(ref));
				items.push({ name: stem(ref), build: await simplifyBuild(full, tri ? { triangles: Number(tri) } : {}) });
			}
			const kit = exportKit(items, { atlas: flags.has('atlas') ? Number(flags.get('atlas')) : undefined, embed: flags.has('embed'), ...lookFlags() });
			mkdirSync(dir, { recursive: true });
			if (!flags.has('embed')) writeFileSync(`${dir}/atlas.png`, kit.atlas.png);
			if (!flags.has('embed') && kit.atlas.normalPng) {
				writeFileSync(`${dir}/atlas_normal.png`, kit.atlas.normalPng);
				writeFileSync(`${dir}/atlas_orm.png`, kit.atlas.ormPng!);
			}
			for (const f of kit.files) writeFileSync(`${dir}/${f.name}.glb`, f.result.glb);
			console.log(`wrote ${kit.files.length} models to ${dir}/ · atlas ${kit.atlas.size}px, ${kit.atlas.charts} charts, ${Math.round(kit.atlas.coverage * 100)}% used`);
			return;
		}
		case 'motion': {
			const scene = loadScene(pos[0]);
			const clip = pos[1] ?? scene.clips?.[0]?.id;
			if (!clip) die('this scene has no clips');
			const b = await buildSceneAsync(scene);
			const s = renderClipStrip(b, clip!, { view: (flags.get('view') as View) ?? 'left', frames: Number(flags.get('frames') ?? 6) });
			const out = flags.get('out') ?? `${stem(pos[0]!)}-${clip}.png`;
			writeFileSync(out, s.png);
			console.log(`wrote ${out}`);
			return;
		}
		case 'effect': {
			const scene = loadScene(pos[0]);
			const id = pos[1] ?? scene.effects?.[0]?.id;
			const e = scene.effects?.find((x) => x.id === id);
			if (!e) die('this scene has no such effect');
			const fb = bakeEffect(resolveEffect(scene, e!));
			const out = flags.get('out') ?? `${stem(pos[0]!)}-${id}.png`;
			writeFileSync(out, fb.sheet);
			writeFileSync(out.replace(/\.png$/i, '') + '.json', JSON.stringify(fb.meta, null, 2));
			writeFileSync(out.replace(/\.png$/i, '') + '.preview.png', fb.preview);
			console.log(`wrote ${out}, its .json and .preview.png`);
			return;
		}
		case 'view': {
			const { serveViewer, readGlb } = await import('./viewer.js');
			const target = pos[0];
			if (!target) die('usage: clayform view <scene.clay.json | template | model.glb> [--port 5231] [--watch]');
			const isGlb = target!.toLowerCase().endsWith('.glb');
			const make = async () => {
				if (isGlb) return readGlb(target!);
				const scene = loadSceneSoft(target!);
				const b = await simplifyBuild(await buildSceneAsync(scene), flags.get('triangles') ? { triangles: Number(flags.get('triangles')) } : {});
				return exportGlb(b).glb;
			};
			const model = { glb: await make(), version: 1, error: '' };
			const title = isGlb ? stem(target!) : loadSceneSoft(target!).name;
			const url = await serveViewer(model, title, Number(flags.get('port') ?? 5231));
			console.log(`viewing ${title} at ${url}${flags.has('watch') ? ' — watching for changes' : ''} (Ctrl+C to stop)`);
			if (flags.has('watch') && !getTemplate(target!)) {
				const { watchFile } = await import('node:fs');
				let busy = false;
				watchFile(target!, { interval: 400 }, async () => {
					if (busy) return;
					busy = true;
					try {
						model.glb = await make();
						model.error = '';
						model.version++;
						console.log(`reloaded (${new Date().toLocaleTimeString()})`);
					} catch (e) {
						model.error = e instanceof Error ? e.message.split(/\n/).slice(0, 3).join(' ') : String(e);
						console.log(`kept the last good version: ${model.error}`);
					} finally {
						busy = false;
					}
				});
			}
			return;
		}
		case 'compare': {
			const { fitReference } = await import('./reference.js');
			const scene = loadScene(pos[0]);
			if (!pos[1]) die('usage: clayform compare <scene|template> <reference.png> [--view front] [-o overlay.png]');
			const fit = fitReference(await buildSceneAsync(scene), pos[1], (flags.get('view') as View) ?? 'front');
			const out = flags.get('out') ?? `${stem(pos[0]!)}-fit.png`;
			writeFileSync(out, fit.overlay);
			console.log(`IoU ${fit.iou.toFixed(2)} · overlay ${out}\n${fit.advice.map((a) => '• ' + a).join('\n')}`);
			return;
		}
		case 'layout': {
			const { buildLayout, critiqueLayout, describeLayout, mergeBuilds, parseLayout } = await import('./layout.js');
			if (!pos[0]) die('usage: clayform layout <file.layout.json> [--render out.png] [--export out.glb] [--triangles N]');
			const parsed = parseLayout(JSON.parse(readFileSync(pos[0]!, 'utf8')));
			if (!parsed.ok) die(parsed.error);
			const resolveRef = (ref: string) => loadSceneSoft(ref);
			const lb = buildLayout((parsed as { ok: true; layout: import('./layout.js').Layout }).layout, resolveRef);
			console.log(describeLayout(lb));
			for (const i of critiqueLayout(lb)) console.log(`${i.severity.toUpperCase()} [${i.code}] ${i.message}`);
			if (flags.get('render')) {
				writeFileSync(flags.get('render')!, renderSheet(lb.merged, { views: ['top', 'three_quarter'], size: 420 }).png);
				console.log(`wrote ${flags.get('render')}`);
			}
			if (flags.get('export')) {
				const simplified = new Map();
				for (const [ref, b] of lb.builds) simplified.set(ref, await simplifyBuild(b, flags.get('triangles') ? { triangles: Number(flags.get('triangles')) } : {}));
				writeFileSync(flags.get('export')!, exportGlb(mergeBuilds(lb, simplified), { rig: false }).glb);
				console.log(`wrote ${flags.get('export')}`);
			}
			return;
		}
		case 'migrate': {
			if (!pos[0]) die('usage: clayform migrate <scene.clay.json> [-o out.clay.json]');
			let raw: unknown;
			try {
				raw = JSON.parse(readFileSync(pos[0]!, 'utf8'));
			} catch (e) {
				die(`cannot read ${pos[0]}: ${(e as Error).message}`);
			}
			const r = parseScene(raw);
			if (!r.ok) die(`${pos[0]} cannot be upgraded:\n${r.error}`);
			const ok = r as { ok: true; scene: Scene; migrated?: string[] };
			if (!ok.migrated) {
				console.log(`${pos[0]} is already ${ok.scene.format}; nothing to do`);
				return;
			}
			const out = flags.get('out') ?? pos[0]!;
			writeFileSync(out, JSON.stringify(ok.scene, null, 2));
			console.log(`wrote ${out}\n${ok.migrated.map((m) => '• ' + m).join('\n')}`);
			return;
		}
		case 'guide':
			console.log(GUIDE);
			return;
		case '--version':
		case '-v':
		case 'version':
			console.log(VERSION);
			return;
		default:
			console.log(`clayform ${VERSION} — agent-native 3D workshop

  clayform mcp [--workspace dir]        start the MCP server (stdio)
  clayform serve [--port 8787] [--host 127.0.0.1] [--token T] [--workspace dir] [--max-sessions 16] [--idle 30] [--keep]
                                        MCP over streamable HTTP, a sandboxed workspace per session
  clayform templates                    list templates
  clayform new <template> [-o file]     write a template as a .clay.json
  clayform render <scene|template> [-o out.png] [--views front,left] [--mode parts] [--size 384]
  clayform inspect <scene|template>     part summary + critics (exit 2 on errors)
  clayform export <scene|template> [-o out.glb|.obj] [--triangles N] [--lods 0.5,0.2] [--collision parts|hull] [--engine godot|unreal|unity]
                 [--texture 1024] [--shading flat|toon] [--bands 3] [--outline 0.01] [--skeleton humanoid|mixamo|unreal]
  clayform kit <scene|template> [more …] [-o dir] [--atlas 2048] [--embed]   one shared texture atlas
  clayform motion <scene> [clip] [-o out.png] [--view left]
  clayform effect <scene> [effect] [-o out.png]
  clayform view <scene|template|file.glb> [--port 5231] [--watch]   three.js viewer, live reload
  clayform compare <scene> <ref.png> [--view front] [-o overlay.png]   fit to a reference image
  clayform layout <file.layout.json> [--render out.png] [--export out.glb]   place many objects
  clayform migrate <scene.clay.json> [-o out]   upgrade a file written in an older format
  clayform guide                        the manual agents read`);
	}
}

main().catch((e) => die(e instanceof Error ? e.stack ?? e.message : String(e)));
