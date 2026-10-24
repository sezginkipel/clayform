import { describe, expect, it } from 'vitest';
import { Local3DProvider, MeshyProvider, TripoProvider } from '../geometry/provider.js';

describe('3D generative providers (Local & BYOK)', () => {
	it('Local3DProvider cost estimate is free', () => {
		const p = new Local3DProvider();
		const cost = p.estimateCost();
		expect(cost.usd).toBe(0);
		expect(cost.note).toMatch(/Free/i);
		expect(p.isConfigured({ endpoint: 'http://127.0.0.1:8000' })).toBe(true);
	});

	it('MeshyProvider cost estimate matches BYOK policy and accepts explicit apiKey', () => {
		const p = new MeshyProvider();
		const cost = p.estimateCost();
		expect(cost.usd).toBeGreaterThan(0);
		expect(cost.note).toMatch(/BYOK/i);
		expect(p.isConfigured({ apiKey: 'user_byok_test_key' })).toBe(true);
	});

	it('MeshyProvider throws clear BYOK error when MESHY_API_KEY is not configured', async () => {
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

	it('TripoProvider throws clear BYOK error when TRIPO_API_KEY is not configured', async () => {
		const prev = process.env.TRIPO_API_KEY;
		delete process.env.TRIPO_API_KEY;
		try {
			const p = new TripoProvider();
			expect(p.isConfigured()).toBe(false);
			expect(p.isConfigured({ apiKey: 'tripo_byok_key' })).toBe(true);
			await expect(p.generate({ prompt: 'crystal sword' })).rejects.toThrow(/TRIPO_API_KEY/i);
		} finally {
			if (prev) process.env.TRIPO_API_KEY = prev;
		}
	});
});
