import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { exportGlb } from '../export/gltf.js';
import { parseGlbJson, validateEngineGlb } from '../export/validate-engine.js';
import { ball, scene } from './helpers.js';

describe('engine export validator', () => {
	it('throws on non-glTF binary data', () => {
		const dummy = new Uint8Array([0, 1, 2, 3, 4]);
		expect(() => parseGlbJson(dummy)).toThrow(/too small/i);

		const fakeMagic = new Uint8Array(24);
		expect(() => parseGlbJson(fakeMagic)).toThrow(/not a gltf binary/i);
	});

	it('validates a standard model for Godot with collision hulls', () => {
		const s = scene([
			ball('body', 0.4),
			ball('hand_r', 0.1, { socket: 'hand_r', position: [0.3, 0, 0] })
		]);
		const b = buildScene(s);
		const { glb } = exportGlb(b, { naming: 'godot', collision: 'parts' });

		const res = validateEngineGlb(glb, 'godot');
		expect(res.ok).toBe(true);
		expect(res.summary.sockets).toContain('SOCKET_hand_r');
		expect(res.summary.colliders.some((c) => c.endsWith('-convcolonly'))).toBe(true);
		expect(res.checks.every((c) => c.passed)).toBe(true);
	});

	it('validates a standard model for Unreal Engine with UCX collision hulls', () => {
		const s = scene([
			ball('body', 0.4),
			ball('sword', 0.1, { socket: 'weapon', position: [0.3, 0, 0] })
		]);
		const b = buildScene(s);
		const { glb } = exportGlb(b, { naming: 'unreal', collision: 'parts' });

		const res = validateEngineGlb(glb, 'unreal');
		expect(res.ok).toBe(true);
		expect(res.summary.sockets).toContain('SOCKET_weapon');
		expect(res.summary.colliders.some((c) => c.startsWith('UCX_'))).toBe(true);
	});
});
