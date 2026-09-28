import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildRig, critiqueClip, sampleClip } from '../anim/rig.js';
import { buildScene } from '../core/build.js';
import { applyOps } from '../core/ops.js';
import { parseScene } from '../core/schema.js';
import { simplifyBuild } from '../core/simplify.js';
import { critique } from '../critic/critics.js';
import { exportGlb } from '../export/gltf.js';
import { getTemplate, TEMPLATES } from '../templates/index.js';
import { serveViewer } from '../viewer.js';
import { ball, scene } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'clayform-v02-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const size = (b: { min: number[]; max: number[] }) => b.max.map((v, i) => v - b.min[i]);

describe('imported meshes as parts', () => {
	it('round-trips a Clayform GLB within one grid cell', async () => {
		const src = buildScene(getTemplate('quadruped')!.scene);
		const file = join(dir, 'dog.glb');
		writeFileSync(file, exportGlb(await simplifyBuild(src)).glb);
		const r = parseScene(scene([{ id: 'dog', shape: { type: 'mesh', src: file, resolution: 96 } }], { settings: { resolution: 96 } }));
		expect(r.ok, r.ok ? '' : r.error).toBe(true);
		if (!r.ok) return;
		const b = buildScene(r.scene);
		const cell = Math.max(...size(src)) / 96;
		size(b).forEach((v, a) => expect(Math.abs(v - size(src)[a])).toBeLessThan(cell * 2));
		expect(critique(b).ok).toBe(true);
	}, 60_000);

	it('reads OBJ, scales with size, and behaves like a part', () => {
		const obj = ['v -1 -1 -1', 'v 1 -1 -1', 'v 1 1 -1', 'v -1 1 -1', 'v -1 -1 1', 'v 1 -1 1', 'v 1 1 1', 'v -1 1 1',
			'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8'].join('\n');
		const file = join(dir, 'cube.obj');
		writeFileSync(file, obj);
		const r = parseScene(scene([
			{ id: 'crate', shape: { type: 'mesh', src: file, size: 0.5 } },
			ball('knob', 0.06, { attach: { to: 'crate', side: 'top', embed: 0.3 } })
		]));
		expect(r.ok, r.ok ? '' : r.error).toBe(true);
		if (!r.ok) return;
		const b = buildScene(r.scene);
		expect(size(b)[0]).toBeCloseTo(0.5, 1);
		const rep = critique(b);
		expect(rep.issues.filter((i) => i.severity !== 'info')).toEqual([]);
		expect(b.compiled.byId.get('knob')!.pos[1]).toBeGreaterThan(0.25);
	});

	it('warns that an open mesh is kept as a shell', () => {
		const file = join(dir, 'plane.obj');
		writeFileSync(file, 'v -1 0 -1\nv 1 0 -1\nv 1 0 1\nv -1 0 1\nf 1 2 3 4\n');
		const r = parseScene(scene([{ id: 'sheet', shape: { type: 'mesh', src: file } }]));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(critique(buildScene(r.scene)).issues.map((i) => i.message).join(' ')).toMatch(/not a closed mesh/);
	});

	it('names a missing file clearly', () => {
		const r = parseScene(scene([{ id: 'x', shape: { type: 'mesh', src: join(dir, 'nope.glb') } }]));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(() => buildScene(r.scene)).toThrow(/mesh file not found/);
	});
});

