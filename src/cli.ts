#!/usr/bin/env node
/**
 * clayform mcp [--workspace dir]            start the MCP server on stdio
 * clayform templates                        list templates
 * clayform new <template> [-o file]         write a template as a scene file
 * clayform render <scene> [-o png] [--views a,b] [--mode parts] [--size 384]
 * clayform inspect <scene>                  critics + part summary
 * clayform export <scene> [-o out.glb] [--triangles N]
 * clayform motion <scene> <clip> [-o png] [--view left]
 * clayform effect <scene> <effect> [-o png]
 * clayform view <scene|template|file.glb>    local three.js viewer (plays clips)
 * clayform guide                            print the agent manual
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildRig, critiqueClip, sampleClip } from './anim/rig.js';
import { buildScene } from './core/build.js';
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

const stem = (p: string) => basename(p).replace(/\.clay\.json$|\.json$/i, '');

async function main() {
	switch (cmd) {
		case 'mcp': {
			const { serveStdio } = await import('./mcp/server.js');
			await serveStdio(flags.get('workspace'));
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
			const b = buildScene(scene);
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
			const b = buildScene(scene);
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
			const full = buildScene(scene);
			const tri = flags.get('triangles');
			const b = await simplifyBuild(full, tri ? { triangles: Number(tri) } : {});
			const out = flags.get('out') ?? `${stem(pos[0]!)}.glb`;
			if (out.toLowerCase().endsWith('.obj')) writeFileSync(out, exportObj(b));
			else writeFileSync(out, exportGlb(b).glb);
			console.log(`wrote ${out} · ${b.stats.triangles} triangles (from ${full.stats.triangles})`);
			return;
		}
		case 'motion': {
			const scene = loadScene(pos[0]);
			const clip = pos[1] ?? scene.clips?.[0]?.id;
			if (!clip) die('this scene has no clips');
			const b = buildScene(scene);
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
			if (!target) die('usage: clayform view <scene.clay.json | template | model.glb> [--port 5231]');
			let glb: Uint8Array;
			let title = stem(target!);
			if (target!.toLowerCase().endsWith('.glb')) glb = readGlb(target!);
			else {
				const scene = loadScene(target);
				title = scene.name;
				const b = await simplifyBuild(buildScene(scene), flags.get('triangles') ? { triangles: Number(flags.get('triangles')) } : {});
				glb = exportGlb(b).glb;
			}
			const url = await serveViewer(glb, title, Number(flags.get('port') ?? 5231));
			console.log(`viewing ${title} at ${url} (Ctrl+C to stop)`);
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
  clayform templates                    list templates
  clayform new <template> [-o file]     write a template as a .clay.json
  clayform render <scene|template> [-o out.png] [--views front,left] [--mode parts] [--size 384]
  clayform inspect <scene|template>     part summary + critics (exit 2 on errors)
  clayform export <scene|template> [-o out.glb|.obj] [--triangles N]
  clayform motion <scene> [clip] [-o out.png] [--view left]
  clayform effect <scene> [effect] [-o out.png]
  clayform view <scene|template|file.glb> [--port 5231]   open a three.js viewer
  clayform guide                        the manual agents read`);
	}
}

main().catch((e) => die(e instanceof Error ? e.stack ?? e.message : String(e)));
