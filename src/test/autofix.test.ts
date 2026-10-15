import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { critique, extractFixes } from '../critic/critics.js';
import { applyOps } from '../core/ops.js';
import { ball, scene } from './helpers.js';

describe('self-healing critics and extractFixes', () => {
	it('suggests separate: true for cloth parts fused into body', () => {
		const s = scene([
			ball('body', 0.4),
			{ id: 'ribbon', shape: { type: 'box', size: [0.06, 0.4, 0.02] }, cloth: { wind: 5 }, attach: { to: 'body', side: 'back' } }
		]);
		const r = critique(buildScene(s));
		const clothIssue = r.issues.find((i) => i.code === 'cloth');
		expect(clothIssue).toBeDefined();
		expect(clothIssue?.suggested_ops).toEqual([
			{ op: 'update_part', id: 'ribbon', set: { separate: true } }
		]);

		const fixes = extractFixes(r);
		expect(fixes).toContainEqual({ op: 'update_part', id: 'ribbon', set: { separate: true } });

		const fixedRes = applyOps(s, fixes);
		expect(fixedRes.ok).toBe(true);
		if (fixedRes.ok) {
			const fixedReport = critique(buildScene(fixedRes.scene));
			expect(fixedReport.issues.find((i) => i.code === 'cloth')).toBeUndefined();
		}
	});

	it('suggests remove_part for completely buried parts without attach', () => {
		const s = scene([
			ball('body', 0.4),
			ball('pea', 0.1, { position: [0, 0, 0] })
		]);
		const r = critique(buildScene(s));
		const buried = r.issues.find((i) => i.code === 'buried');
		expect(buried).toBeDefined();
		expect(buried?.suggested_ops).toEqual([
			{ op: 'remove_part', id: 'pea' }
		]);

		const fixes = extractFixes(r);
		const fixedRes = applyOps(s, fixes);
		expect(fixedRes.ok).toBe(true);
		if (fixedRes.ok) {
			const fixedReport = critique(buildScene(fixedRes.scene));
			expect(fixedReport.issues.find((i) => i.code === 'buried')).toBeUndefined();
		}
	});

	it('suggests separate: true for parts too small for the resolution', () => {
		const s = scene(
			[ball('body', 0.5), ball('dot', 0.004, { attach: { to: 'body', side: 'front' } })],
			{ settings: { resolution: 32 } }
		);
		const r = critique(buildScene(s));
		const tooSmall = r.issues.find((i) => i.code === 'too-small');
		expect(tooSmall).toBeDefined();
		expect(tooSmall?.suggested_ops).toEqual([
			{ op: 'update_part', id: 'dot', set: { separate: true } }
		]);
	});

	it('suggests resolution reduction when triangle count exceeds budget', () => {
		const s = scene([ball('body', 0.5)], { settings: { resolution: 64, budget: 600 } });
		const r = critique(buildScene(s));
		const overBudget = r.issues.find((i) => i.code === 'over-budget');
		expect(overBudget).toBeDefined();
		expect(overBudget?.suggested_ops?.[0]).toMatchObject({
			op: 'set_settings',
			set: { resolution: expect.any(Number) }
		});

		const fixes = extractFixes(r);
		const fixedRes = applyOps(s, fixes);
		expect(fixedRes.ok).toBe(true);
		if (fixedRes.ok) {
			expect(fixedRes.scene.settings?.resolution).toBeLessThan(64);
		}
	});

	it('extractFixes deduplicates operations on the same part', () => {
		const r = {
			ok: false,
			issues: [
				{
					severity: 'error' as const,
					code: 'buried',
					message: 'buried part',
					parts: ['gem'],
					suggested_ops: [{ op: 'update_part' as const, id: 'gem', set: { separate: true } }]
				},
				{
					severity: 'error' as const,
					code: 'buried',
					message: 'buried part again',
					parts: ['gem'],
					suggested_ops: [{ op: 'update_part' as const, id: 'gem', set: { blend: 0 } }]
				}
			],
			stats: {} as any
		};
		const fixes = extractFixes(r);
		expect(fixes.length).toBe(1);
		expect(fixes[0]).toEqual({ op: 'update_part', id: 'gem', set: { separate: true } });
	});
});
