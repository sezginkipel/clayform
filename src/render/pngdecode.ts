/**
 * PNG decoder for reference images: 8-bit gray, gray+alpha, RGB, RGBA and
 * palette images, non-interlaced. Returns RGBA.
 */

import { unzlibSync } from 'fflate';

export interface Rgba {
	width: number;
	height: number;
	data: Uint8Array;
}

export function decodePng(bytes: Uint8Array): Rgba {
	const sig = [137, 80, 78, 71, 13, 10, 26, 10];
	if (bytes.length < 8 || sig.some((v, i) => bytes[i] !== v)) throw new Error('not a PNG file — save the reference as PNG');
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let off = 8;
	let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
	let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
	const idat: Uint8Array[] = [];
	while (off + 8 <= bytes.length) {
		const len = dv.getUint32(off);
		const name = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
		const body = bytes.subarray(off + 8, off + 8 + len);
		if (name === 'IHDR') {
			width = dv.getUint32(off + 8);
			height = dv.getUint32(off + 12);
			depth = body[8];
			type = body[9];
			interlace = body[12];
		} else if (name === 'PLTE') palette = body;
		else if (name === 'tRNS') trns = body;
		else if (name === 'IDAT') idat.push(body);
		else if (name === 'IEND') break;
		off += 12 + len;
	}
	if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported — save it as 8-bit`);
	if (interlace) throw new Error('interlaced PNGs are not supported — save it without interlacing');
	const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6];
	if (!channels) throw new Error(`PNG color type ${type} is not supported`);
	const total = idat.reduce((s, c) => s + c.length, 0);
	const z = new Uint8Array(total);
	let o = 0;
	for (const c of idat) {
		z.set(c, o);
		o += c.length;
	}
	const raw = unzlibSync(z);
	const stride = width * channels;
	const px = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const f = raw[y * (stride + 1)];
		const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const cur = px.subarray(y * stride, (y + 1) * stride);
		const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
		for (let i = 0; i < stride; i++) {
			const a = i >= channels ? cur[i - channels] : 0;
			const b = prev ? prev[i] : 0;
			const c = prev && i >= channels ? prev[i - channels] : 0;
			let v = src[i];
			if (f === 1) v += a;
			else if (f === 2) v += b;
			else if (f === 3) v += (a + b) >> 1;
			else if (f === 4) {
				const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			cur[i] = v & 255;
		}
	}
	const out = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		const s = i * channels, d = i * 4;
		if (type === 6) out.set(px.subarray(s, s + 4), d);
		else if (type === 2) {
			out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = 255;
		} else if (type === 0 || type === 4) {
			out[d] = out[d + 1] = out[d + 2] = px[s];
			out[d + 3] = type === 4 ? px[s + 1] : 255;
		} else {
			const k = px[s];
			if (!palette) throw new Error('palette PNG without a palette');
			out[d] = palette[k * 3]; out[d + 1] = palette[k * 3 + 1]; out[d + 2] = palette[k * 3 + 2];
			out[d + 3] = trns && k < trns.length ? trns[k] : 255;
		}
	}
	return { width, height, data: out };
}
