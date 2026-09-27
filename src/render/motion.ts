/**
 * Film strips: a clip rendered as a row of labelled frames from one view, so
 * an agent can see a walk cycle without playing a video.
 */

import { buildRig, poseMeshes, sampleClip, type Rig, type SampledClip } from '../anim/rig.js';
import type { Build } from '../core/build.js';
import type { V3 } from '../core/math.js';
import { drawText } from './font.js';
import { encodePng } from './png.js';
import { renderTiles, type View } from './views.js';

export interface StripOptions {
	frames?: number;
	view?: View;
	size?: number;
}

export interface Strip {
	png: Uint8Array;
	width: number;
	height: number;
	times: number[];
	clip: SampledClip;
	rig: Rig;
}

export function renderClipStrip(b: Build, clipId: string, o: StripOptions = {}): Strip {
	const def = b.compiled.scene.clips?.find((c) => c.id === clipId);
	if (!def) throw new Error(`no clip "${clipId}"${b.compiled.scene.clips?.length ? ` — clips: ${b.compiled.scene.clips.map((c) => c.id).join(', ')}` : ' — add one with add_clip'}`);
	const rig = buildRig(b);
	const clip = sampleClip(b, rig, def);
	const n = Math.max(2, Math.min(12, o.frames ?? 6));
	const frames = Array.from({ length: n }, (_, i) => Math.round((i / (def.type === 'keyframes' || def.duration ? n - 1 : n)) * (clip.times.length - 1)));
	const posed = frames.map((f) => poseMeshes(b, rig, clip, Math.min(f, clip.times.length - 1)));
	// frame all poses with one camera so motion reads as motion
	const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
	for (const ms of posed)
		for (const m of ms)
			for (let i = 0; i < m.positions.length; i += 3)
				for (let a = 0; a < 3; a++) {
					min[a] = Math.min(min[a], m.positions[i + a]);
					max[a] = Math.max(max[a], m.positions[i + a]);
				}
	min[1] = Math.min(min[1], 0);
	const size = o.size ?? 220;
	const gap = 3;
	const W = n * size + (n - 1) * gap;
	const buf = new Uint8Array(W * size * 4).fill(250);
	posed.forEach((ms, i) => {
		const { tiles } = renderTiles(b, { views: [o.view ?? 'left'], size, draws: ms, bounds: { min, max } });
		const t = tiles[0];
		for (let y = 0; y < size; y++) buf.set(t.data.subarray(y * size * 4, (y + 1) * size * 4), (y * W + i * (size + gap)) * 4);
		drawText(buf, W, size, i * (size + gap) + 6, 6, `${clip.times[frames[i]].toFixed(2)}S`, [70, 70, 76], 2);
	});
	for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
	return { png: encodePng(buf, W, size), width: W, height: size, times: frames.map((f) => clip.times[f]), clip, rig };
}
