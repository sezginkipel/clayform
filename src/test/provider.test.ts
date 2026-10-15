import { describe, expect, it } from 'vitest';
import { Local3DProvider, MeshyProvider } from '../geometry/provider.js';

describe('3D generative providers', () => {
	it('Local3DProvider cost estimate is free', () => {
		const p = new Local3DProvider();
		const cost = p.estimateCost();
		expect(cost.usd).toBe(0);
		expect(cost.note).toMatch(/Free/i);
	});

	it('MeshyProvider cost estimate matches expected API costs', () => {
		const p = new MeshyProvider();
		const cost = p.estimateCost();
		expect(cost.usd).toBeGreaterThan(0);
		expect(cost.note).toMatch(/Meshy/i);
	});

	it('MeshyProvider throws clear error when MESHY_API_KEY is not configured', async () => {
		const prev = process.env.MESHY_API_KEY;
		delete process.env.MESHY_API_KEY;
		try {
			const p = new MeshyProvider();
			expect(p.isConfigured()).toBe(false);
			await expect(p.generate({ prompt: 'wooden crate' })).rejects.toThrow(/MESHY_API_KEY/i);
		} finally {
			if (prev) process.env.MESHY_API_KEY = prev;
		}
	});
});
