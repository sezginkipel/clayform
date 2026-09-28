import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildScene } from '../core/build.js';
import { createServer } from '../mcp/server.js';
import { measureBetween, measurePart, measureRatio, partAtPixel } from '../measure.js';
import { getTemplate } from '../templates/index.js';
import { ball, scene } from './helpers.js';

describe('measure', () => {
	it('distance between two separate parts', () => {
		const b = buildScene(scene([ball('a', 0.2), ball('b', 0.2, { position: [0.5, 0, 0] })]));
		expect(measureBetween(b, 'a', 'b').distance).toBeCloseTo(0.1, 2);
	});

	it('overlap depth of parts that are fused together', () => {
		const b = buildScene(scene([ball('a', 0.2), ball('b', 0.2, { position: [0.3, 0, 0], blend: 0.05 })]));
		const r = measureBetween(b, 'a', 'b');
		expect(r.distance).toBeCloseTo(-0.1, 2);
	});

	it('size, ground contact and ratio of parts', () => {
		const b = buildScene(scene([
			{ id: 'crate', shape: { type: 'box', size: [0.4, 0.2, 0.3] } },
			{ id: 'lid', shape: { type: 'box', size: [0.4, 0.05, 0.3] }, attach: { to: 'crate', side: 'top', embed: 0 } }
		]));
		const crate = measurePart(b, 'crate');
		expect(crate.size[0]).toBeCloseTo(0.4, 1);
		expect(crate.touchesGround).toBe(true);
		expect(measurePart(b, 'lid').touchesGround).toBe(false);
		expect(measureRatio(b, 'lid', 'crate', 'x').ratio).toBeCloseTo(1, 1);
	});

	it('finds the part at a pixel of a render', () => {
		const b = buildScene(getTemplate('snowman')!.scene);
		expect(partAtPixel(b, 'front', 192, 330)).toBe('base');
		expect(partAtPixel(b, 'front', 192, 60)).toBe('head');
		expect(partAtPixel(b, 'front', 5, 5)).toBeNull();
	});
});

describe('MCP measure and compare', () => {
	const dir = mkdtempSync(join(tmpdir(), 'clayform-measure-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it('answers queries and shows what an edit changed', async () => {
		const { server } = createServer(dir);
		const [a, b] = InMemoryTransport.createLinkedPair();
		await server.connect(a);
		const c = new Client({ name: 't', version: '0' });
		await c.connect(b);
		const text = (r: unknown) => ((r as { content: { type: string; text?: string }[] }).content.filter((x) => x.type === 'text').map((x) => x.text).join('\n'));
		await c.callTool({ name: 'new_scene', arguments: { name: 'Bot', template: 'robot' } });
		const none = await c.callTool({ name: 'render', arguments: { scene: 'bot', compare: 'previous' } });
		expect(none.isError).toBe(true);
		await c.callTool({ name: 'edit', arguments: { scene: 'bot', ops: [{ op: 'update_part', id: 'head', set: { scale: 1.3 } }] } });
		const cmp = await c.callTool({ name: 'render', arguments: { scene: 'bot', compare: 'previous', views: ['front'] } });
		expect(text(cmp)).toMatch(/^changed head$/m);
		expect((cmp.content as { type: string }[]).some((x) => x.type === 'image')).toBe(true);
		const m = await c.callTool({ name: 'measure', arguments: { scene: 'bot', queries: [{ part: 'head' }, { ratio: ['head', 'torso'], axis: 'x' }, { between: ['claw', 'leg'] }, { nope: 1 }] } });
		const lines = text(m).split('\n');
		expect(lines[0]).toMatch(/^head: size/);
		expect(lines[1]).toMatch(/head \/ torso along x: \d/);
		expect(lines[2]).toMatch(/claw to leg: [\d.]+ cm apart|overlap/);
		expect(lines[3]).toMatch(/use one of/);
		await c.close();
	}, 60_000);
});
