import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { exportGlb } from '../export/gltf.js';
import { parseGlbJson } from '../export/validate-engine.js';
import { parseScene } from '../core/schema.js';
import { ball, scene } from './helpers.js';

describe('engine attachment sockets', () => {
	it('validates socket name schema', () => {
		const valid = scene([
			ball('body', 0.4),
			ball('hand_r', 0.1, { socket: 'hand_r', position: [0.3, 0, 0] })
		]);
		expect(parseScene(valid).ok).toBe(true);

		const invalid = scene([
			ball('body', 0.4),
			ball('hand_r', 0.1, { socket: 'Hand Socket!', position: [0.3, 0, 0] })
		]);
		expect(parseScene(invalid).ok).toBe(false);
	});

	it('exports SOCKET_<name> node in glTF', () => {
		const s = scene([
			ball('body', 0.4),
			ball('hand_r', 0.1, { socket: 'hand_r', position: [0.3, 0.2, 0] })
		]);
		const b = buildScene(s);
		const { glb } = exportGlb(b);
		const json = parseGlbJson(glb);

		const nodeNames = json.nodes.map((n: any) => n.name);
		expect(nodeNames).toContain('SOCKET_hand_r');

		const socketNode = json.nodes.find((n: any) => n.name === 'SOCKET_hand_r');
		expect(socketNode).toBeDefined();
		expect(socketNode.translation[0]).toBeCloseTo(0.3, 1);
		expect(socketNode.translation[1]).toBeCloseTo(0.2, 1);
	});

	it('creates _l or _mirror socket for mirrored twin parts', () => {
		const s = scene([
			ball('body', 0.4),
			ball('hand_r', 0.1, { socket: 'hand_r', position: [0.3, 0.2, 0], mirror: true })
		]);
		const b = buildScene(s);
		const { glb } = exportGlb(b);
		const json = parseGlbJson(glb);

		const nodeNames = json.nodes.map((n: any) => n.name);
		expect(nodeNames).toContain('SOCKET_hand_r');
		expect(nodeNames).toContain('SOCKET_hand_l');
	});
});
