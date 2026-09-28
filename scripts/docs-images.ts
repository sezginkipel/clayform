/**
 * Regenerates the README images from real renders (nothing hand-made).
 * Run: npx tsx scripts/docs-images.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { buildScene } from '../src/core/build.js';
import { applyOps } from '../src/core/ops.js';
import { renderClipStrip } from '../src/render/motion.js';
import { renderSheet } from '../src/render/views.js';
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
