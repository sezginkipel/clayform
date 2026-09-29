import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { applyOps } from '../core/ops.js';
import { emptyScene } from '../core/schema.js';
import { fitCamera, LIGHTING, renderBeauty, renderTurntable } from '../render/beauty.js';
import { decodePng } from '../render/pngdecode.js';
import { rasterize, STUDIO } from '../render/raster.js';
import { shadesOf } from '../render/views.js';
import { getTemplate } from '../templates/index.js';
import { norm } from '../core/math.js';

/** A small cube under a wide plate held up on a post: the cube sits in the plate's shadow. */
function overhang() {
	const r = applyOps(emptyScene('overhang'), [
		{ op: 'add_part', part: { id: 'post', role: 'body', shape: { type: 'box', size: [0.1, 1, 0.1] }, position: [-0.6, 0.5, 0] } },
		{ op: 'add_part', part: { id: 'plate', shape: { type: 'box', size: [1.6, 0.06, 1.6] }, position: [0, 1.03, 0], separate: true } },
		{ op: 'add_part', part: { id: 'cube', shape: { type: 'box', size: [0.3, 0.3, 0.3] }, position: [0.2, 0.15, 0.2], separate: true } }
	]);
	if (!r.ok) throw new Error(r.error);
	return buildScene(r.scene);
}

describe('beauty renders', () => {
	it('the shadow map puts a part in the shadow of what is above it', () => {
		const b = overhang();
		const cam = fitCamera({ min: b.min, max: b.max }, 30, 40);
		const shot = (softShadows: boolean) =>
			rasterize(b.meshes, shadesOf(b), cam, {
				width: 160, height: 160, mode: 'shaded', ground: true, groundY: 0, gridStep: 1, groundRadius: 4, groundCenter: [0, 0],
				shadow: true, ssaa: 1, softShadows, ids: true, light: { ...STUDIO, key: norm([0.3, 1, 0.5]) }
			});
		const lit = shot(false), shaded = shot(true);
		const cube = b.compiled.byId.get('cube')!.index;
		const mean = (img: typeof lit) => {
			let s = 0, n = 0;
			img.ids!.forEach((id, i) => {
				if (id === cube) { s += img.data[i * 4] + img.data[i * 4 + 1] + img.data[i * 4 + 2]; n++; }
			});
			return s / n;
		};
		// the plate is between the cube and the light
		expect(mean(shaded)).toBeLessThan(mean(lit) * 0.85);
	});

	it('a transparent background keeps the model opaque, the shadow partly, and nothing else', () => {
		const b = buildScene(getTemplate('crystal')!.scene);
		const r = renderBeauty(b, { background: 'transparent', size: 160, ssaa: 1 });
		const img = decodePng(r.png);
		const a = (x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
		expect(a(0, 0)).toBe(0);
		expect(a(80, 80)).toBe(255);
		const partial = Array.from({ length: img.width * img.height }, (_, i) => img.data[i * 4 + 3]).filter((v) => v > 0 && v < 255).length;
		expect(partial).toBeGreaterThan(50);
	});

	it('every light preset renders, and they differ', () => {
		const b = buildScene(getTemplate('house')!.scene);
		const sums = Object.keys(LIGHTING).map((light) => {
			const img = decodePng(renderBeauty(b, { light: light as keyof typeof LIGHTING, size: 96, ssaa: 1 }).png);
			return img.data.reduce((s, v, i) => (i % 4 === 3 ? s : s + v), 0);
		});
		expect(new Set(sums).size).toBe(sums.length);
	});

	it('a turntable is a valid animated PNG with one frame per step and a steady framing', () => {
		const b = buildScene(getTemplate('knight')!.scene);
		const n = 8;
		const r = renderTurntable(b, { frames: n, size: 96, ssaa: 1, background: 'transparent' });
		// walk the chunks: signature, IHDR, acTL, then fcTL + IDAT/fdAT per frame, sequence numbers in order, CRCs right
		const buf = r.png, dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
		let o = 8, seq = 0, fc = 0, fd = 0, idat = 0, frames = -1;
		const crcTable = Array.from({ length: 256 }, (_, n2) => {
			let c = n2;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			return c >>> 0;
		});
		const crc = (s: number, e: number) => {
			let c = 0xffffffff;
			for (let i = s; i < e; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
			return (c ^ 0xffffffff) >>> 0;
		};
		while (o < buf.length) {
			const len = dv.getUint32(o), type = String.fromCharCode(...buf.subarray(o + 4, o + 8));
			expect(dv.getUint32(o + 8 + len)).toBe(crc(o + 4, o + 8 + len));
			if (type === 'acTL') frames = dv.getUint32(o + 8);
			if (type === 'fcTL' || type === 'fdAT') expect(dv.getUint32(o + 8)).toBe(seq++);
			if (type === 'fcTL') fc++;
			if (type === 'fdAT') fd++;
			if (type === 'IDAT') idat++;
			o += 12 + len;
		}
		expect([frames, fc, fd, idat]).toEqual([n, n, n - 1, 1]);
		// anything that ignores APNG sees the first frame as a plain PNG
		expect(decodePng(r.png).width).toBe(96);
	});
});
