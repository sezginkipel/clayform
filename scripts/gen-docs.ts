/**
 * Generates the parts of the docs that must never drift from the code:
 *   docs/reference.md          — every scene field, from the zod schema
 *   docs/templates.md          — the template catalog (+ docs/templates/<id>.png)
 *   schema/clayform.schema.json — JSON Schema for editors and other tools
 *
 *   npx tsx scripts/gen-docs.ts          # write
 *   npx tsx scripts/gen-docs.ts --check  # exit 1 if anything is stale (no images)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { referenceMarkdown, templatesMarkdown, schemaJson } from '../src/docs-gen.js';
import { buildScene } from '../src/core/build.js';
import { renderTiles } from '../src/render/views.js';
import { encodePng } from '../src/render/png.js';
import { TEMPLATES } from '../src/templates/index.js';

const check = process.argv.includes('--check');
const files: [string, string][] = [
	['docs/reference.md', referenceMarkdown()],
	['docs/templates.md', templatesMarkdown()],
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
