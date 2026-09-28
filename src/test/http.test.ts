import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveHttp, type HttpHandle } from '../mcp/http.js';

const TOKEN = 'test-token-7f3a';
let h: HttpHandle;
let base: string;
const outside = join(tmpdir(), `clayform-outside-${process.pid}.clay.json`);

beforeAll(async () => {
	base = mkdtempSync(join(tmpdir(), 'clayform-http-'));
	writeFileSync(outside, JSON.stringify({ format: 'clayform/1', name: 'secret', parts: [] }));
	h = await serveHttp({ port: 0, workspace: base, token: TOKEN });
});
afterAll(async () => {
	await h.close();
	rmSync(base, { recursive: true, force: true });
	rmSync(outside, { force: true });
});

async function connect(token = TOKEN) {
	const client = new Client({ name: 'test', version: '1' });
	const transport = new StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
	await client.connect(transport);
	return { client, transport };
}
/** End the session on the server (close alone only drops the connection). */
async function done(c: { client: Client; transport: StreamableHTTPClientTransport }) {
	await c.transport.terminateSession();
	await c.client.close();
}
const textOf = (r: unknown) => ((r as { content: { type: string; text?: string }[] }).content.find((c) => c.type === 'text')?.text ?? '');

describe('MCP over HTTP', () => {
	it('serves the same tools as stdio', async () => {
		const c = await connect();
		const tools = (await c.client.listTools()).tools.map((t) => t.name);
		expect(tools).toEqual(expect.arrayContaining(['guide', 'new_scene', 'edit', 'render', 'export', 'export_kit']));
		await done(c);
	});

	it('gives every session its own workspace', async () => {
		const a = await connect(), b = await connect();
		await a.client.callTool({ name: 'new_scene', arguments: { name: 'pup', template: 'quadruped' } });
		expect(textOf(await a.client.callTool({ name: 'list_scenes', arguments: {} }))).toMatch(/pup/);
		expect(textOf(await b.client.callTool({ name: 'list_scenes', arguments: {} }))).not.toMatch(/pup/);
		const r = await a.client.callTool({ name: 'render', arguments: { scene: 'pup', size: 160 } });
		expect((r as { content: { type: string }[] }).content.some((c) => c.type === 'image')).toBe(true);
		const out = await a.client.callTool({ name: 'export', arguments: { scene: 'pup', triangles: 2000 } });
		expect(textOf(out)).toMatch(/wrote .*pup\.glb/);
		expect(h.sessions()).toBe(2);
		await done(a);
		await done(b);
		expect(h.sessions()).toBe(0);
	});

	it('keeps every path inside the session workspace', async () => {
		const c = await connect();
		const { client } = c;
		await client.callTool({ name: 'new_scene', arguments: { name: 'ball', template: 'slime' } });
		const tries = [
			{ name: 'export', arguments: { scene: 'ball', path: '../../escaped.glb' } },
			{ name: 'export', arguments: { scene: 'ball', path: join(tmpdir(), 'escaped.glb') } },
			{ name: 'export_kit', arguments: { scenes: ['ball'], dir: '../kit' } },
			{ name: 'import_scene', arguments: { path: outside } },
			{ name: 'compare_reference', arguments: { scene: 'ball', image: '../../../reference.png' } },
			// a mesh source outside the workspace, smuggled in through a scene edit
			{ name: 'edit', arguments: { scene: 'ball', ops: [{ op: 'add_part', part: { id: 'stolen', shape: { type: 'mesh', src: outside.replace(/\.clay\.json$/, '.obj') } } }] } }
		];
		for (const t of tries) {
			const r = (await client.callTool(t)) as { isError?: boolean };
			expect(r.isError, `${t.name} ${JSON.stringify(t.arguments)}`).toBe(true);
			expect(textOf(r), t.name).toMatch(/outside this session's workspace/);
		}
		expect(existsSync(join(tmpdir(), 'escaped.glb'))).toBe(false);
		// a relative path inside the workspace is fine
		expect(textOf(await client.callTool({ name: 'export', arguments: { scene: 'ball', path: 'mine/ball.glb', triangles: 1000 } }))).toMatch(/wrote .*ball\.glb/);
		await done(c);
	});

	it('refuses a missing or wrong token', async () => {
		await expect(connect('nope')).rejects.toThrow();
		const r = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
		expect(r.status).toBe(401);
	});

	it('removes a session folder when the client ends the session', async () => {
		const c = await connect();
		await c.client.callTool({ name: 'new_scene', arguments: { name: 'tmp', template: 'rock' } });
		const before = readdirSync(join(base, 'sessions')).length;
		await done(c);
		expect(readdirSync(join(base, 'sessions')).length).toBe(before - 1);
	});

	it('will not listen on a public address without a token', async () => {
		await expect(serveHttp({ port: 0, host: '0.0.0.0' })).rejects.toThrow(/without a token/);
	});
});
