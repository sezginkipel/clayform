/**
 * Regenerates the README images from real renders (nothing hand-made).
 * Run: npx tsx scripts/docs-images.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildScene } from '../src/core/build.js';
import { applyOps } from '../src/core/ops.js';
import { drawText } from '../src/render/font.js';
import { renderClipStrip } from '../src/render/motion.js';
import { encodePng } from '../src/render/png.js';
import { decodePng } from '../src/render/pngdecode.js';
import { renderSheet, renderTiles } from '../src/render/views.js';
import { FORMAT } from '../src/core/schema.js';
import { getTemplate } from '../src/templates/index.js';
import { bakeEffect, resolveEffect } from '../src/vfx/effects.js';

mkdirSync('docs', { recursive: true });

// The goblin from the README walkthrough: the biped template + four edits.
const r = applyOps(getTemplate('biped')!.scene, [
	{ op: 'set_meta', name: 'Goblin' },
	{ op: 'set_palette', set: { skin: '#7fb04a', shirt: '#6b4a2b', pants: '#3d3322' } },
	{ op: 'update_part', id: 'hair', set: { hidden: true } },
	{ op: 'add_part', part: { id: 'ear', role: 'ear', shape: { type: 'cone', height: 0.16, radius: 0.045 }, attach: { to: 'head', side: 'left', offset: [0, 0.2], align: true, embed: 0.2 }, rotation: [0, 0, -25], mirror: true, blend: 0.02, material: { color: 'skin' } } },
	{ op: 'update_part', id: 'nose', set: { shape: { type: 'cone', height: 0.09, radius: 0.03 }, attach: { to: 'head', side: 'front', offset: [0, -0.1], align: true, embed: 0.2 } } }
]);
if (!r.ok) throw new Error(r.error);
writeFileSync('docs/goblin.clay.json', JSON.stringify(r.scene, null, 2));
const goblin = buildScene(r.scene);
writeFileSync('docs/goblin.png', renderSheet(goblin, { views: ['front', 'three_quarter'], size: 360 }).png);
writeFileSync('docs/goblin-parts.png', renderSheet(goblin, { views: ['front', 'three_quarter'], size: 360, mode: 'parts' }).png);
writeFileSync('docs/goblin-walk.png', renderClipStrip(goblin, 'walk', { frames: 6, view: 'three_quarter', size: 200 }).png);

const torch = getTemplate('torch')!.scene;
writeFileSync('docs/fire.png', bakeEffect(resolveEffect(torch, torch.effects![0])).preview);
console.log('docs/goblin.png goblin-parts.png goblin-walk.png fire.png goblin.clay.json');

// Presentation renders: the house at sunset, the knight on a transparent background (shown on a light card), and a turntable.
{
	const { renderBeauty, renderTurntable } = await import('../src/render/beauty.js');
	const { decodePng } = await import('../src/render/pngdecode.js');
	const T = 520, W = T * 2 + 8, buf = new Uint8Array(W * T * 4).fill(255);
	const tiles = [
		decodePng(renderBeauty(buildScene(getTemplate('house')!.scene), { light: 'sunset', size: T }).png),
		decodePng(renderBeauty(buildScene(getTemplate('knight')!.scene), { background: 'transparent', size: T }).png)
	];
	tiles.forEach((img, i) => {
		for (let y = 0; y < T; y++)
			for (let x = 0; x < T; x++) {
				const s = (y * T + x) * 4, d = (y * W + i * (T + 8) + x) * 4, a = img.data[s + 3] / 255;
				// the transparent one over a light card, so the page shows what the alpha does
				const card = [238, 240, 244];
				for (let c = 0; c < 3; c++) buf[d + c] = Math.round(img.data[s + c] * a + card[c] * (1 - a));
				buf[d + 3] = 255;
			}
	});
	writeFileSync('docs/beauty.png', encodePng(buf, W, T));
	writeFileSync('docs/turntable.png', renderTurntable(buildScene(getTemplate('robot')!.scene), { size: 320, frames: 30, seconds: 4 }).png);
	console.log('docs/beauty.png, docs/turntable.png');
}

// Every material preset on a cube or a log.
{
	const { PRESETS } = await import('../src/core/materials.js');
	const base: Record<string, string> = { wood: '#a8743f', planks: '#9a6a3f', brick: '#a8452f', stone: '#8f8a84', cobbles: '#7d7872', tiles: '#e8e2d6', metal: '#9aa0a8', rust: '#8a8f99', fabric: '#3b5f9a', leather: '#6b3f26', grass: '#5a9a3a', bark: '#6f4a2e', marble: '#ecebe6', sand: '#d8c28a' };
	const T = 200, cols = 7, rows = Math.ceil(PRESETS.length / cols);
	const W = cols * T, H = rows * T, buf = new Uint8Array(W * H * 4).fill(255);
	PRESETS.forEach((kind, i) => {
		const round = kind === 'wood' || kind === 'bark' || kind === 'marble';
		const shape = round ? { type: 'cylinder', height: 0.8, radius: 0.3 } : { type: 'box', size: [0.7, 0.7, 0.7] };
		const s = applyOps({ format: FORMAT, name: kind, settings: { resolution: 160, edges: 'sharp' }, parts: [] }, [{ op: 'add_part', part: { id: 'a', shape, material: { color: base[kind], preset: { kind } } } }]);
		if (!s.ok) throw new Error(s.error);
		const tile = renderTiles(buildScene(s.scene), { views: ['three_quarter'], size: T }).tiles[0];
		const ox = (i % cols) * T, oy = Math.floor(i / cols) * T;
		for (let y = 0; y < T; y++) buf.set(tile.data.subarray(y * T * 4, (y + 1) * T * 4), ((oy + y) * W + ox) * 4);
		drawText(buf, W, H, ox + 6, oy + 6, kind, [60, 60, 66], 2);
	});
	writeFileSync('docs/presets.png', encodePng(buf, W, H));
	console.log('docs/presets.png');
}

// The game actions on the biped, one strip per clip, stacked.
{
	const types = ['attack', 'jump', 'sit', 'turn', 'die'];
	const r2 = applyOps(getTemplate('biped')!.scene, types.map((type) => ({ op: 'add_clip', clip: { id: type, type } })));
	if (!r2.ok) throw new Error(r2.error);
	const bb = buildScene(r2.scene);
	const strips = types.map((type) => decodePng(renderClipStrip(bb, type, { frames: 6, view: type === 'attack' || type === 'sit' ? 'left' : 'three_quarter', size: 150 }).png));
	const W = strips[0].width, H = strips.reduce((s, x) => s + x.height, 0);
	const buf = new Uint8Array(W * H * 4);
	let y = 0;
	strips.forEach((st, i) => {
		buf.set(st.data, y * W * 4);
		drawText(buf, W, H, W - types[i].length * 12 - 8, y + st.height - 22, types[i], [60, 60, 66], 2);
		y += st.height;
	});
	writeFileSync('docs/actions.png', encodePng(buf, W, H));
	console.log('docs/actions.png');
}

// The example camp layout.
{
	const { buildLayout, parseLayout } = await import('../src/layout.js');
	const parsed = parseLayout(JSON.parse(readFileSync('docs/examples/camp.layout.json', 'utf8')));
	if (!parsed.ok) throw new Error(parsed.error);
	const lb = buildLayout(parsed.layout, (ref) => getTemplate(ref)!.scene);
	writeFileSync('docs/camp.png', renderSheet(lb.merged, { views: ['three_quarter', 'top'], size: 420, labels: false }).png);
	console.log('docs/camp.png');
}

// Fitting a reference: the snowman's own silhouette as the reference, and a head 40% too big.
{
	const { fitReference, silhouettePng } = await import('../src/reference.js');
	const snow = getTemplate('snowman')!.scene;
	const ref = silhouettePng(buildScene(snow), 'front');
	writeFileSync('docs/reference-snowman.png', ref);
	const big = applyOps(snow, [{ op: 'update_part', id: 'head', set: { scale: 1.4 } }]);
	if (!big.ok) throw new Error(big.error);
	const fit = fitReference(buildScene(big.scene), ref, 'front');
	writeFileSync('docs/fit-bigger-head.png', fit.overlay);
	console.log(`IoU ${fit.iou.toFixed(2)}`, fit.advice);
	console.log('docs/reference-snowman.png fit-bigger-head.png');
}
