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

describe('motion critic: parts passing through each other', () => {
	it('catches an arm swung into the body', () => {
		const r = applyOps(getTemplate('biped')!.scene, [
			{ op: 'add_clip', clip: { id: 'hug', type: 'keyframes', duration: 1, tracks: [{ part: 'arm', keys: [{ t: 0, rotation: [0, 0, 0] }, { t: 1, rotation: [0, 0, -75] }] }] } }
		]);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const b = buildScene(r.scene);
		const rig = buildRig(b);
		const m = critiqueClip(b, rig, sampleClip(b, rig, r.scene.clips!.find((c) => c.id === 'hug')!), true);
		expect(m.issues.join(' ')).toMatch(/pass through each other/);
	});

	it('template clips are clean', () => {
		for (const t of TEMPLATES) {
			if (!t.scene.clips?.length) continue;
			const b = buildScene(t.scene);
			const rig = buildRig(b);
			for (const c of t.scene.clips) {
				const m = critiqueClip(b, rig, sampleClip(b, rig, c), t.scene.settings?.ground !== 'none');
				expect(m.issues, `${t.id}/${c.id}`).toEqual([]);
			}
		}
	}, 60_000);
});

