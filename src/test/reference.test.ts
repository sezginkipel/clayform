import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zlibSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildScene } from '../core/build.js';
import { applyOps } from '../core/ops.js';
import { createServer } from '../mcp/server.js';
import { fitReference, silhouettePng } from '../reference.js';
import { encodePng } from '../render/png.js';
import { decodePng } from '../render/pngdecode.js';
import { renderTiles } from '../render/views.js';
import { getTemplate } from '../templates/index.js';

const dir = mkdtempSync(join(tmpdir(), 'clayform-ref-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function chunk(type: string, data: Uint8Array) {
	const out = new Uint8Array(12 + data.length);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	return out; // CRC is not checked by the decoder
}

describe('PNG decoder', () => {
	it('reads back what the encoder writes', () => {
		const px = new Uint8Array(4 * 4 * 4).map((_, i) => (i * 37) & 255);
		const d = decodePng(encodePng(px, 4, 4));
		expect(d.width).toBe(4);
		expect([...d.data]).toEqual([...px]);
	});

	it('undoes sub, up, average and paeth filters on an RGB image', () => {
		const w = 3, h = 4;
		const img = Array.from({ length: w * h * 3 }, (_, i) => (i * 29 + 7) & 255);
		const raw: number[] = [];
		for (let y = 0; y < h; y++) {
			const f = y + 1; // 1..4
			raw.push(f);
			for (let i = 0; i < w * 3; i++) {
				const x = img[y * w * 3 + i];
				const a = i >= 3 ? img[y * w * 3 + i - 3] : 0;
				const b = y ? img[(y - 1) * w * 3 + i] : 0;
				const c = y && i >= 3 ? img[(y - 1) * w * 3 + i - 3] : 0;
				const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
				raw.push((x - pred + 256) & 255);
			}
		}
		const ihdr = new Uint8Array(13);
		new DataView(ihdr.buffer).setUint32(0, w);
		new DataView(ihdr.buffer).setUint32(4, h);
		ihdr[8] = 8;
		ihdr[9] = 2;
		const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(new Uint8Array(raw))), chunk('IEND', new Uint8Array())];
		const bytes = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
		let o = 0;
		for (const p of parts) { bytes.set(p, o); o += p.length; }
		const d = decodePng(bytes);
		for (let i = 0; i < w * h; i++) expect([...d.data.subarray(i * 4, i * 4 + 3)]).toEqual(img.slice(i * 3, i * 3 + 3));
	});

	it('refuses what it cannot read, with a reason', () => {
		expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(/not a PNG/);
	});
});

describe('fit to a reference', () => {
	const base = buildScene(getTemplate('snowman')!.scene);
	const ref = silhouettePng(base, 'front');
	const variant = (scale: number) => {
		const r = applyOps(getTemplate('snowman')!.scene, [{ op: 'update_part', id: 'head', set: { scale } }]);
		if (!r.ok) throw new Error(r.error);
		return buildScene(r.scene);
	};

	it('a model compared with its own silhouette scores above 0.97', () => {
		expect(fitReference(base, ref, 'front').iou).toBeGreaterThan(0.97);
	});

	it('a head 40% too big scores lower and the advice points at the head', () => {
		const f = fitReference(variant(1.4), ref, 'front');
		expect(f.iou).toBeLessThan(0.93);
		expect(f.advice[0]).toMatch(/\(head/);
		expect(f.advice[0]).toMatch(/wider|shape the reference does not/);
		expect(f.advice.join(' ')).not.toMatch(/\(base\)/);
	});

	it('a head 40% too small: the advice says narrower at the head', () => {
		const f = fitReference(variant(0.6), ref, 'front');
		expect(f.advice[0]).toMatch(/\(head/);
		expect(f.advice[0]).toMatch(/narrower|missing/);
	});

	it('works on a shaded picture with a plain background that differs from the object', () => {
		const bird = buildScene(getTemplate('bird')!.scene);
		const { tiles } = renderTiles(bird, { views: ['front'], size: 320, ground: false });
		const picture = encodePng(tiles[0].data, 320, 320);
		expect(fitReference(bird, picture, 'front').iou).toBeGreaterThan(0.9);
	});
});

describe('MCP compare_reference', () => {
	it('returns an overlay and advice', async () => {
		const file = join(dir, 'ref.png');
		writeFileSync(file, silhouettePng(buildScene(getTemplate('snowman')!.scene), 'front'));
		const { server } = createServer(join(dir, 'ws'));
		const [a, b] = InMemoryTransport.createLinkedPair();
		await server.connect(a);
		const c = new Client({ name: 't', version: '0' });
		await c.connect(b);
		await c.callTool({ name: 'new_scene', arguments: { name: 'Snow', template: 'snowman' } });
		await c.callTool({ name: 'edit', arguments: { scene: 'snow', ops: [{ op: 'update_part', id: 'torso', set: { scale: 1.3 } }] } });
		const r = await c.callTool({ name: 'compare_reference', arguments: { scene: 'snow', image: file, view: 'front' } });
		const content = r.content as { type: string; text?: string }[];
		expect(content.some((x) => x.type === 'image')).toBe(true);
		const t = content.find((x) => x.type === 'text')!.text!;
		expect(t).toMatch(/IoU 0\.\d\d/);
		expect(t).toMatch(/torso/);
		await c.close();
	}, 60_000);
});
