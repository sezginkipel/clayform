/**
 * Generates the parts of the docs that must never drift from the code:
 *   docs/reference.md          — every scene field, from the zod schema
 *   docs/templates.md          — the template catalog (+ docs/templates/<id>.png)
 *   docs/parts.md              — the part library (+ docs/parts.png)
 *   schema/clayform.schema.json — JSON Schema for editors and other tools
 *
 *   npx tsx scripts/gen-docs.ts          # write
 *   npx tsx scripts/gen-docs.ts --check  # exit 1 if anything is stale (no images)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { partsMarkdown, referenceMarkdown, templatesMarkdown, schemaJson } from '../src/docs-gen.js';
import { buildScene } from '../src/core/build.js';
import { applyOps } from '../src/core/ops.js';
import { FORMAT, type Scene } from '../src/core/schema.js';
import { LIBRARY } from '../src/library/parts.js';
import { drawText } from '../src/render/font.js';
import { renderTiles, type View } from '../src/render/views.js';
import { encodePng } from '../src/render/png.js';
import { TEMPLATES } from '../src/templates/index.js';

const check = process.argv.includes('--check');
const files: [string, string][] = [
	['docs/reference.md', referenceMarkdown()],
	['docs/templates.md', templatesMarkdown()],
	['docs/parts.md', partsMarkdown()],
	['schema/clayform.schema.json', schemaJson()]
];
let stale = 0;
for (const [path, body] of files) {
	const cur = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '';
	if (cur === body) continue;
	stale++;
	if (check) console.error(`stale: ${path}`);
	else {
		mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
		writeFileSync(path, body);
		console.log(`wrote ${path}`);
	}
}
if (check) process.exit(stale ? 1 : 0);

mkdirSync('docs/templates', { recursive: true });
for (const t of TEMPLATES) {
	const { tiles } = renderTiles(buildScene(t.scene), { views: ['three_quarter'], size: 256 });
	writeFileSync(`docs/templates/${t.id}.png`, encodePng(tiles[0].data, tiles[0].width, tiles[0].height));
}
console.log(`rendered ${TEMPLATES.length} template thumbnails`);

// every library part on a plain test body
const T = 200, cols = 7, rows = Math.ceil(LIBRARY.length / cols);
const W = cols * T, H = rows * T;
const buf = new Uint8Array(W * H * 4).fill(255);
LIBRARY.forEach((lp, i) => {
	const base: Scene = { format: FORMAT, name: lp.name, settings: { resolution: 90 }, parts: [{ id: 'body', shape: { type: 'box', size: [0.5, 0.5, 0.5], rounding: 0.12 }, position: [0, 0.25, 0], material: { color: '#c9b8a6' } }] };
	const r = applyOps(base, [{ op: 'add_library_part', name: lp.name, id: 'x', attach: { to: 'body' } }]);
	if (!r.ok) throw new Error(r.error);
	const view: View = lp.side === 'back' ? 'three_quarter_back' : lp.side === 'bottom' ? { yaw: 30, pitch: -10 } : 'three_quarter';
	const t = renderTiles(buildScene(r.scene), { views: [view], size: T }).tiles[0];
	const ox = (i % cols) * T, oy = Math.floor(i / cols) * T;
	for (let y = 0; y < T; y++) buf.set(t.data.subarray(y * T * 4, (y + 1) * T * 4), ((oy + y) * W + ox) * 4);
	drawText(buf, W, H, ox + 4, oy + 4, lp.name, [60, 60, 66], 1);
});
writeFileSync('docs/parts.png', encodePng(buf, W, H));
console.log('rendered the part library sheet');
