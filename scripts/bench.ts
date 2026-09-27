/**
 * Score a folder of Clayform outputs against bench/prompts.json.
 *
 *   npx tsx scripts/bench.ts <dir>        # expects <dir>/<prompt id>.clay.json
 *
 * Writes <dir>/report.md and <dir>/renders/<id>.png (identical views and size
 * for every entry, so they can be paired blind with another tool's renders).
 * This measures what can be measured; which model *looks* better is for the
 * blind human comparison described in bench/README.md.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRig, critiqueClip, sampleClip } from '../src/anim/rig.js';
import { buildScene } from '../src/core/build.js';
import { parseScene } from '../src/core/schema.js';
import { simplifyBuild } from '../src/core/simplify.js';
import { critique } from '../src/critic/critics.js';
import { exportGlb } from '../src/export/gltf.js';
import { renderSheet } from '../src/render/views.js';

interface Prompt { id: string; category: string; prompt: string; expects: { clips?: string[]; effects?: boolean } }
const bench = JSON.parse(readFileSync('bench/prompts.json', 'utf8')) as { prompts: Prompt[]; budget: { triangles: number } };
const dir = process.argv[2];
if (!dir) {
	console.error('usage: npx tsx scripts/bench.ts <dir>');
	process.exit(1);
}
mkdirSync(join(dir, 'renders'), { recursive: true });

const rows: string[] = ['| id | category | present | errors | warnings | triangles (export) | clips ok | effects | notes |', '|---|---|---|---|---|---|---|---|---|'];
let present = 0, clean = 0;
for (const p of bench.prompts) {
	const file = join(dir, `${p.id}.clay.json`);
	if (!existsSync(file)) {
		rows.push(`| ${p.id} | ${p.category} | no | – | – | – | – | – | missing |`);
		continue;
	}
	present++;
	const parsed = parseScene(JSON.parse(readFileSync(file, 'utf8')));
	if (!parsed.ok) {
		rows.push(`| ${p.id} | ${p.category} | invalid | – | – | – | – | – | ${parsed.error.split('\n')[0].replace(/\|/g, '/')} |`);
		continue;
	}
	const s = parsed.scene;
	const b = buildScene(s);
	const rep = critique(b);
	const errors = rep.issues.filter((i) => i.severity === 'error').length;
	const warns = rep.issues.filter((i) => i.severity === 'warn').length;
	if (!errors && !warns) clean++;
	const lo = await simplifyBuild(b, { triangles: bench.budget.triangles });
	exportGlb(lo);
	const types = new Set((s.clips ?? []).map((c) => c.type));
	const clipsOk = (p.expects.clips ?? []).every((t) => types.has(t as never));
	let motion = '';
	if (s.clips?.length) {
		const rig = buildRig(b);
		const bad = s.clips.flatMap((c) => critiqueClip(b, rig, sampleClip(b, rig, c), s.settings?.ground !== 'none').issues);
		motion = bad.join('; ');
	}
	const fx = p.expects.effects ? ((s.effects?.length ?? 0) > 0 ? 'yes' : 'missing') : '–';
	writeFileSync(join(dir, 'renders', `${p.id}.png`), renderSheet(b, { views: ['front', 'three_quarter'], size: 384, labels: false }).png);
	rows.push(`| ${p.id} | ${p.category} | yes | ${errors} | ${warns} | ${lo.stats.triangles} | ${p.expects.clips ? (clipsOk ? 'yes' : 'no') : '–'} | ${fx} | ${[...rep.issues.filter((i) => i.severity !== 'info').map((i) => i.code), motion].filter(Boolean).join(', ').replace(/\|/g, '/')} |`);
	process.stdout.write(`${p.id} `);
}
const md = `# Clayform bench report\n\n${present}/${bench.prompts.length} outputs present · ${clean} without critic errors or warnings\n\n${rows.join('\n')}\n`;
writeFileSync(join(dir, 'report.md'), md);
console.log(`\n→ ${join(dir, 'report.md')}`);
