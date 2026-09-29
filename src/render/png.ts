/** Minimal RGBA8 PNG encoder (zlib via fflate). */

import { zlibSync } from 'fflate';

const CRC = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf: Uint8Array, start: number, end: number): number {
	let c = 0xffffffff;
	for (let i = start; i < end; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
	return out;
}

export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
	const raw = new Uint8Array((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (width * 4 + 1)] = 0;
		raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
	}
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, width);
	dv.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
	const total = parts.reduce((s, p) => s + p.length, 0);
	const out = new Uint8Array(total);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

/**
 * Animated PNG: every browser plays it, it keeps full color and alpha, and it
 * is a plain PNG (the first frame) to anything that does not know APNG.
 * `delay` is milliseconds per frame; it loops forever.
 */
export function encodeApng(frames: Uint8Array[], width: number, height: number, delay: number): Uint8Array {
	const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdr = new Uint8Array(13);
	const hv = new DataView(ihdr.buffer);
	hv.setUint32(0, width);
	hv.setUint32(4, height);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const actl = new Uint8Array(8);
	new DataView(actl.buffer).setUint32(0, frames.length);
	const parts: Uint8Array[] = [sig, chunk('IHDR', ihdr), chunk('acTL', actl)];
	let seq = 0;
	frames.forEach((rgba, i) => {
		const fc = new Uint8Array(26);
		const dv = new DataView(fc.buffer);
		dv.setUint32(0, seq++);
		dv.setUint32(4, width);
		dv.setUint32(8, height);
		dv.setUint32(12, 0);
		dv.setUint32(16, 0);
		dv.setUint16(20, Math.max(1, Math.round(delay)));
		dv.setUint16(22, 1000);
		fc[24] = 0; // dispose: none
		fc[25] = 0; // blend: source (frames are whole images)
		parts.push(chunk('fcTL', fc));
		const raw = new Uint8Array((width * 4 + 1) * height);
		for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
		const z = zlibSync(raw, { level: 6 });
		if (i === 0) parts.push(chunk('IDAT', z));
		else {
			const fd = new Uint8Array(4 + z.length);
			new DataView(fd.buffer).setUint32(0, seq++);
			fd.set(z, 4);
			parts.push(chunk('fdAT', fd));
		}
	});
	parts.push(chunk('IEND', new Uint8Array(0)));
	const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}
