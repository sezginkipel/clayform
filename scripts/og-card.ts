/**
 * Renders the 1200×630 OpenGraph social preview card (site/static/og-card.png)
 * using Clayform's own software renderer and signature templates.
 *
 * Run: npx tsx scripts/og-card.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildScene } from '../src/core/build.js';
import { drawText } from '../src/render/font.js';
import { encodePng } from '../src/render/png.js';
import { renderTiles } from '../src/render/views.js';
import { getTemplate } from '../src/templates/index.js';

const W = 1200;
const H = 630;
const buf = new Uint8Array(W * H * 4);

function fillRect(x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) {
	for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
		for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
			const o = (y * W + x) * 4;
			buf[o] = rgb[0];
			buf[o + 1] = rgb[1];
			buf[o + 2] = rgb[2];
			buf[o + 3] = 255;
		}
	}
}

// Paper background (#f4f6f8) with deep ink blue accent bar on left and top
fillRect(0, 0, W, H, [244, 246, 248]);
fillRect(0, 0, 14, H, [28, 63, 148]);
fillRect(56, 54, 420, 480, [255, 255, 255]);
// Subtle border around left card
fillRect(56, 54, 420, 2, [201, 208, 215]);
fillRect(56, 532, 420, 2, [201, 208, 215]);
fillRect(56, 54, 2, 480, [201, 208, 215]);
fillRect(474, 54, 2, 480, [201, 208, 215]);

// Brand badge
fillRect(88, 92, 204, 28, [28, 63, 148]);
drawText(buf, W, H, 100, 99, 'OPEN SOURCE MCP', [255, 255, 255], 2);

// Title & Copy
drawText(buf, W, H, 88, 152, 'CLAYFORM', [17, 20, 24], 7);
drawText(buf, W, H, 88, 226, '3D WORKSHOP FOR', [28, 63, 148], 3);
drawText(buf, W, H, 88, 258, 'AI AGENTS', [28, 63, 148], 3);

drawText(buf, W, H, 88, 316, 'MODEL, SCULPT, RIG', [59, 66, 74], 2);
drawText(buf, W, H, 88, 340, 'AND ANIMATE IN 3D.', [59, 66, 74], 2);
drawText(buf, W, H, 88, 364, 'EXPORT GAME-READY GLTF.', [59, 66, 74], 2);
drawText(buf, W, H, 88, 388, 'NO BLENDER. NO GPU.', [59, 66, 74], 2);

// Install box
fillRect(88, 436, 356, 62, [237, 241, 250]);
fillRect(88, 436, 4, 62, [28, 63, 148]);
drawText(buf, W, H, 104, 448, 'NPX -Y @S1444/CLAYFORM', [28, 63, 148], 2);
drawText(buf, W, H, 104, 474, 'CLAYFORM.SADELABS.SITE', [92, 100, 109], 2);

// 3x2 grid of real rendered templates on the right
const picks = ['knight', 'dragon', 'house', 'truck', 'spaceship', 'tree'];
const T = 216;
const gap = 14;
const startX = 506;
const startY = 54;

picks.forEach((id, i) => {
	const t = getTemplate(id)!;
	const b = buildScene(t.scene);
	const { tiles } = renderTiles(b, { views: ['three_quarter'], size: T });
	const tile = tiles[0];
	const col = i % 3;
	const row = Math.floor(i / 3);
	const ox = startX + col * (T + gap);
	const oy = startY + row * (T + gap);
	// Frame border
	fillRect(ox - 2, oy - 2, T + 4, T + 4, [201, 208, 215]);
	for (let y = 0; y < T; y++) {
		buf.set(tile.data.subarray(y * T * 4, (y + 1) * T * 4), ((oy + y) * W + ox) * 4);
	}
	fillRect(ox + 6, oy + T - 24, id.length * 12 + 12, 18, [255, 255, 255]);
	drawText(buf, W, H, ox + 12, oy + T - 21, id, [28, 63, 148], 2);
});

// Bottom bar below the 3x2 grid
fillRect(startX, startY + 2 * (T + gap) + 4, 3 * T + 2 * gap, 32, [232, 243, 236]);
drawText(buf, W, H, startX + 18, startY + 2 * (T + gap) + 13, '47 TEMPLATES . CRITICS . GODOT / UNITY / UNREAL', [23, 83, 47], 2);

const out = 'site/static/og-card.png';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(buf, W, H));
console.log(`wrote ${out} (${W}x${H})`);
