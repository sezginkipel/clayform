import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { syncToEngineProject } from '../export/engine-sync.js';
import { getTemplate } from '../templates/index.js';

describe('live game engine sync bridge', () => {
	it('syncs a scene into a Godot 4 project with .glb.import sidecar and -convcolonly hulls', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'clayform-godot-'));
		try {
			const scene = getTemplate('chest')!.scene;
			const build = buildScene(scene, { resolution: 32 });
			const res = await syncToEngineProject(build, {
				projectDir: dir,
				assetName: 'wooden_crate',
				engine: 'godot',
				lods: [0.5]
			});
			expect(res.validation.ok).toBe(true);
			expect(existsSync(res.glbPath)).toBe(true);
			expect(res.sidecarPath).toBeDefined();
			expect(existsSync(res.sidecarPath!)).toBe(true);
			const sidecar = readFileSync(res.sidecarPath!, 'utf8');
			expect(sidecar).toContain('importer="scene"');
			expect(sidecar).toContain('meshes/generate_lods=true');
			expect(res.validation.summary.colliders.some((c) => c.includes('-convcolonly'))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('syncs a scene into an Unreal project with UCX_ colliders and .clayform.json metadata', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'clayform-unreal-'));
		try {
			const scene = getTemplate('barrel')!.scene;
			const build = buildScene(scene, { resolution: 32 });
			const res = await syncToEngineProject(build, {
				projectDir: dir,
				assetName: 'oak_barrel',
				engine: 'unreal',
				lods: [0.5]
			});
			expect(res.validation.ok).toBe(true);
			expect(existsSync(res.glbPath)).toBe(true);
			expect(res.validation.summary.colliders.some((c) => c.startsWith('UCX_'))).toBe(true);
			const meta = JSON.parse(readFileSync(res.sidecarPath!, 'utf8'));
			expect(meta.engine).toBe('unreal');
			expect(meta.asset).toBe('oak_barrel.glb');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
