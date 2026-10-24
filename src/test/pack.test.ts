import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAssetPack } from '../pack.js';
import { Workspace } from '../session.js';

describe('multi-asset world & biome kit generator', () => {
	it('builds a cohesive asset pack with shared atlas, settled layout, and manifest', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'clayform-pack-'));
		try {
			const ws = new Workspace(join(dir, 'ws'));
			const outDir = join(dir, 'out');
			const res = await buildAssetPack(
				ws,
				{
					name: 'Props Mini Pack',
					atlas: 256,
					engine: 'godot',
					assets: [
						{ id: 'chest_a', template: 'chest' },
						{ id: 'barrel_a', template: 'barrel' }
					]
				},
				outDir
			);

			expect(res.assets).toHaveLength(2);
			expect(res.atlasSize).toBe(256);
			expect(res.atlasCoverage).toBeGreaterThan(0);
			expect(existsSync(join(outDir, 'atlas.png'))).toBe(true);
			expect(existsSync(join(outDir, 'pack_preview.png'))).toBe(true);
			expect(existsSync(join(outDir, 'pack.manifest.json'))).toBe(true);
			expect(existsSync(res.layoutGlbPath)).toBe(true);
			for (const a of res.assets) {
				expect(existsSync(a.glbPath)).toBe(true);
				expect(a.ok).toBe(true);
			}
			const manifest = JSON.parse(readFileSync(join(outDir, 'pack.manifest.json'), 'utf8'));
			expect(manifest.assets).toHaveLength(2);
			expect(manifest.engine).toBe('godot');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 20000);
});
