import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { applyOps } from '../core/ops.js';
import { parseScene, type Scene } from '../core/schema.js';
import { critique } from '../critic/critics.js';
import { ball, scene } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'clayform-style-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const stylePath = join(dir, 'pack.style.json');
const writeStyle = (red: string) =>
	writeFileSync(stylePath, JSON.stringify({ format: 'clayform-style/1', name: 'Pack', palette: { red, dark: '#2b2d33' }, defaults: { blend: 0.02, rounding: 0.03, roughness: 0.6 }, heights: { prop: [0.3, 0.8] } }));

const pack = (): Scene[] => [
	scene([{ id: 'crate', shape: { type: 'box', size: [0.5, 0.5, 0.5] }, position: [0, 0.25, 0], material: { color: 'red' } }], { style: stylePath, category: 'prop' }),
	scene([ball('ball', 0.25, { material: { color: 'red' } })], { style: stylePath, category: 'prop' }),
	scene([{ id: 'drum', shape: { type: 'cylinder', height: 0.5, radius: 0.2 }, material: { color: 'red' } }, ball('lid', 0.1, { attach: { to: 'drum', side: 'top' }, material: { color: 'dark' } })], { style: stylePath, category: 'prop' })
];
const colorOf = (s: Scene) => {
	const m = buildScene(s).meshes[0];
	return [m.colors[0], m.colors[1], m.colors[2]].map((v) => +v.toFixed(2));
};

describe('style sheets', () => {
	it('palette keys resolve from the style and one style edit recolors the whole pack', () => {
		writeStyle('#d64533');
		for (const s of pack()) expect(parseScene(s).ok).toBe(true);
		const before = pack().map(colorOf);
		writeStyle('#3355dd');
		const after = pack().map(colorOf);
		before.forEach((c, i) => expect(after[i]).not.toEqual(c));
		expect(after[0][2]).toBeGreaterThan(after[0][0]);
	});

	it('fills in defaults the scene leaves unset', () => {
		writeStyle('#d64533');
		const b = buildScene(pack()[0]);
		const part = b.compiled.scene.parts[0];
		expect(part.shape).toMatchObject({ rounding: 0.03 });
		expect(part.material?.roughness).toBe(0.6);
	});

	it('flags off-palette colors, overridden style colors and off-scale models', () => {
		writeStyle('#d64533');
		const r = applyOps(pack()[0], [
			{ op: 'add_part', part: { id: 'band', shape: { type: 'box', size: [0.52, 0.05, 0.52] }, attach: { to: 'crate', side: 'center', embed: 1 }, material: { color: '#44aa11' } } },
			{ op: 'set_palette', set: { red: '#ff0000' } },
			{ op: 'update_part', id: 'crate', set: { scale: 2.5 } }
		]);
		expect(r.ok, r.ok ? '' : r.error).toBe(true);
		if (!r.ok) return;
		const codes = critique(buildScene(r.scene)).issues.map((i) => i.code);
		expect(codes).toEqual(expect.arrayContaining(['off-style-color', 'style-override', 'off-style-scale']));
	});

	it('says clearly when the style file is missing', () => {
		const r = parseScene(scene([ball('a', 0.2)], { style: join(dir, 'nope.style.json') }));
		expect(!r.ok && r.error).toMatch(/style file not found/);
	});
});
