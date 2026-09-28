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

describe('viewer', () => {
	it('serves the model and a version for live reload', async () => {
		const model = { glb: new Uint8Array([1, 2, 3]), version: 1, error: '' };
		const url = await serveViewer(model, 'test', 5319);
		const fetchText = (p: string) => new Promise<string>((ok, bad) => get(url + p, (res) => { let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => ok(s)); }).on('error', bad));
		expect(JSON.parse(await fetchText('version'))).toEqual({ version: 1, error: '' });
		model.version = 2;
		expect(JSON.parse(await fetchText('version')).version).toBe(2);
		expect(await fetchText('')).toMatch(/<title>test · Clayform<\/title>/);
	});
});

