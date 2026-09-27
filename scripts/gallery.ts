/**
 * Renders every template into one labelled contact sheet (docs/gallery.png).
 * Run: npx tsx scripts/gallery.ts [out.png] [view]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildScene } from '../src/core/build.js';
import { drawText } from '../src/render/font.js';
import { encodePng } from '../src/render/png.js';
import { renderTiles, type View } from '../src/render/views.js';
import { TEMPLATES } from '../src/templates/index.js';

const out = process.argv[2] ?? 'docs/gallery.png';
const view = (process.argv[3] ?? 'three_quarter') as View;
const T = 240, cols = 5, gap = 4;
const rows = Math.ceil(TEMPLATES.length / cols);
const W = cols * T + (cols - 1) * gap, H = rows * T + (rows - 1) * gap;
const buf = new Uint8Array(W * H * 4).fill(255);
TEMPLATES.forEach((t, i) => {
	const b = buildScene(t.scene);
	const { tiles } = renderTiles(b, { views: [view], size: T });
	const tile = tiles[0];
	const ox = (i % cols) * (T + gap), oy = Math.floor(i / cols) * (T + gap);
	for (let y = 0; y < T; y++) buf.set(tile.data.subarray(y * T * 4, (y + 1) * T * 4), ((oy + y) * W + ox) * 4);
	drawText(buf, W, H, ox + 8, oy + 8, t.id, [60, 60, 66], 2);
	process.stdout.write(`${t.id} `);
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(buf, W, H));
console.log(`\n→ ${out}`);
