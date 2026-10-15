import { describe, expect, it } from 'vitest';
import { evaluateScene, evaluateTemplates, formatEvalReport } from '../eval.js';
import { ball, scene } from './helpers.js';

describe('evaluation harness', () => {
	it('evaluates a valid scene successfully', async () => {
		const s = scene([ball('body', 0.4)]);
		const res = await evaluateScene('test_model', s);
		expect(res.ok).toBe(true);
		expect(res.critics.ok).toBe(true);
		expect(res.critics.errors).toBe(0);
		expect(res.triangles).toBeGreaterThan(0);
		expect(res.engine.ok).toBe(true);
	});

	it('detects missing clips when expected', async () => {
		const s = scene([ball('body', 0.4)]);
		const res = await evaluateScene('test_model', s, { clips: ['walk'] });
		expect(res.ok).toBe(false);
		expect(res.clips.ok).toBe(false);
		expect(res.clips.missing).toContain('walk');
	});

	it('evaluates template subset and generates markdown report', async () => {
		const summary = await evaluateTemplates('godot', ['sword', 'chest']);
		expect(summary.total).toBe(2);
		expect(summary.passed).toBe(2);
		expect(summary.passRate).toBe(1);

		const md = formatEvalReport(summary);
		expect(md).toContain('# Clayform Evaluation Report');
		expect(md).toContain('sword');
		expect(md).toContain('chest');
		expect(md).toContain('PASS');
	});
});
