import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../mcp/server.js';

const dir = mkdtempSync(join(tmpdir(), 'clayform-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function connect() {
	const { server } = createServer(dir);
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	const client = new Client({ name: 'test', version: '0' });
	await client.connect(b);
	return client;
}

type Block = { type: string; text?: string; data?: string };
const blocks = (r: unknown) => ((r as { content?: Block[] }).content ?? []);
const texts = (r: unknown) => blocks(r).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

describe('MCP server', () => {
	it('drives the full agent loop', async () => {
		const c = await connect();
		const { tools } = await c.listTools();
		expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['guide', 'new_scene', 'edit', 'render', 'inspect', 'export']));

		const created = await c.callTool({ name: 'new_scene', arguments: { name: 'Pup', template: 'quadruped' } });
		expect(texts(created)).toMatch(/created scene "pup"/);

		const bad = await c.callTool({ name: 'edit', arguments: { scene: 'pup', ops: [{ op: 'update_part', id: 'tail', set: { shape: { radius: 0.05 } } }, { op: 'remove_part', id: 'nope' }] } });
		expect(bad.isError).toBe(true);
		expect(texts(bad)).toMatch(/nothing was changed/);

		const ok = await c.callTool({ name: 'edit', arguments: { scene: 'pup', ops: [{ op: 'set_palette', set: { fur: '#555555' } }] } });
		expect(ok.isError).toBeFalsy();
		expect(texts(ok)).toMatch(/palette fur/);

		const r = await c.callTool({ name: 'render', arguments: { scene: 'pup', views: ['front'], size: 160 } });
		const img = blocks(r).find((b) => b.type === 'image');
		expect(img?.data && Buffer.from(img.data, 'base64').subarray(1, 4).toString()).toBe('PNG');

		const undo = await c.callTool({ name: 'history', arguments: { scene: 'pup', action: 'undo' } });
		expect(texts(undo)).toMatch(/undone/);

		const ex = await c.callTool({ name: 'export', arguments: { scene: 'pup', triangles: 1500 } });
		expect(texts(ex)).toMatch(/wrote .*pup\.glb .* 1,?5\d\d triangles|wrote .*pup\.glb .* 1,?[0-4]\d\d triangles/);
		await c.close();
	}, 60_000);
});
