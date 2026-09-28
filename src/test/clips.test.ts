import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { buildRig, critiqueClip, jointMatrices, poseMeshes, sampleClip, type SampledClip } from '../anim/rig.js';
import { buildScene, type Build } from '../core/build.js';
import { applyOps } from '../core/ops.js';
import { parseScene, type Scene } from '../core/schema.js';
import { exportGlb } from '../export/gltf.js';
import { renderClipStrip } from '../render/motion.js';
import { getTemplate } from '../templates/index.js';

const NEW = ['attack', 'jump', 'sit', 'turn', 'die'] as const;

function withClips(id: string, clips: object[]): Scene {
	const r = applyOps(getTemplate(id)!.scene, clips.map((clip) => ({ op: 'add_clip', clip })));
	if (!r.ok) throw new Error(r.error);
	return r.scene;
}

/** Height range of the posed model at a frame. */
function extent(b: Build, clip: SampledClip, f: number) {
	const rig = buildRig(b);
	let lo = Infinity, hi = -Infinity;
	for (const m of poseMeshes(b, rig, clip, f))
		for (let i = 1; i < m.positions.length; i += 3) {
			lo = Math.min(lo, m.positions[i]);
			hi = Math.max(hi, m.positions[i]);
		}
	return { lo, hi };
}

const angleOf = (q: number[]) => 2 * Math.acos(Math.min(1, Math.abs(q[3])));

describe('game action clips', () => {
	for (const id of ['biped', 'quadruped']) {
		const scene = withClips(id, NEW.map((type) => ({ id: type, type })));
		const b = buildScene(scene);
		const rig = buildRig(b);
		const clips = Object.fromEntries(NEW.map((type) => [type, sampleClip(b, rig, scene.clips!.find((c) => c.id === type)!)])) as Record<(typeof NEW)[number], SampledClip>;
		const rest = extent(b, clips.attack, 0);
		const last = (c: SampledClip) => c.times.length - 1;
		const rootRot = (c: SampledClip, f: number) => c.channels.find((ch) => ch.joint === rig.root)?.rot[f] ?? [0, 0, 0, 1];

		for (const type of NEW)
			it(`${id} ${type}: film strip renders and the motion critic is clean`, () => {
				const strip = renderClipStrip(b, type, { frames: 6, view: 'left', size: 160 });
				expect(strip.png.byteLength).toBeGreaterThan(2000);
				expect(strip.times.length).toBe(6);
				expect(clips[type].loop).toBe(false);
				expect(critiqueClip(b, rig, clips[type], true).issues).toEqual([]);
			});

		it(`${id} attack winds up, strikes and comes back to rest`, () => {
			const c = clips.attack;
			const moving = c.channels.filter((ch) => ch.joint !== rig.root);
			const peak = Math.max(...moving.flatMap((ch) => ch.rot.map(angleOf)));
			expect(peak).toBeGreaterThan((id === 'biped' ? 90 : 12) * (Math.PI / 180));
			for (const ch of moving) expect(angleOf(ch.rot[last(c)])).toBeLessThan(2 * (Math.PI / 180));
		});

		it(`${id} jump leaves the ground and lands`, () => {
			const c = clips.jump;
			const lows = c.times.map((_, f) => extent(b, c, f).lo);
			expect(Math.max(...lows)).toBeGreaterThan(rest.hi * 0.25);
			expect(Math.abs(lows[last(c)])).toBeLessThan(b.cell * 2);
		});

		it(`${id} sit ends with the hips down, resting on the ground`, () => {
			const e = extent(b, clips.sit, last(clips.sit));
			expect(Math.abs(e.lo)).toBeLessThan(b.cell * 2);
			// the hip that sits: the biped's leg, the quadruped's back leg
			const hip = rig.byPrim.get(b.compiled.byId.get(id === 'biped' ? 'leg' : 'leg_back')!.index)!;
			const y = (f: number) => jointMatrices(rig, clips.sit, f)[hip][13];
			expect(y(last(clips.sit))).toBeLessThan(y(0) - 0.12);
		});

		it(`${id} turn ends a quarter turn to the left`, () => {
			const q = rootRot(clips.turn, last(clips.turn));
			const yaw = 2 * Math.atan2(q[1], q[3]);
			expect(yaw * (180 / Math.PI)).toBeCloseTo(90, 0);
		});

		it(`${id} die ends lying on its side on the ground`, () => {
			const e = extent(b, clips.die, last(clips.die));
			expect(Math.abs(e.lo)).toBeLessThan(b.cell * 2);
			// lying down it is as tall as it was wide: the biped's big head keeps that near 70% of its standing height
			expect(e.hi - e.lo).toBeLessThan((rest.hi - rest.lo) * (id === 'biped' ? 0.7 : 0.8));
		});
	}

	it('exports every action as a valid glTF animation', async () => {
		const scene = withClips('biped', NEW.map((type) => ({ id: type, type })));
		const r = exportGlb(buildScene(scene));
		const rep = await validator.validateBytes(r.glb);
		expect(rep.issues.numErrors).toBe(0);
		expect((r.json.animations as { name: string }[]).map((a) => a.name)).toEqual(expect.arrayContaining([...NEW]));
	});
});

describe('blends', () => {
	const scene = withClips('biped', [{ id: 'walk_to_run', type: 'blend', from: 'walk', to: 'run', duration: 0.5 }, { id: 'run', type: 'run' }]);
	const b = buildScene(scene);
	const rig = buildRig(b);
	const get = (id: string) => sampleClip(b, rig, scene.clips!.find((c) => c.id === id)!);
	const blend = get('walk_to_run'), walk = get('walk'), run = get('run');
	const leg = rig.byPrim.get(b.compiled.byId.get('leg')!.index)!;
	const rotOf = (c: SampledClip, f: number) => c.channels.find((ch) => ch.joint === leg)!.rot[f];
	const diff = (q: number[], r: number[]) => 2 * Math.acos(Math.min(1, Math.abs(q[0] * r[0] + q[1] * r[1] + q[2] * r[2] + q[3] * r[3])));

	it('starts on the first clip and ends exactly where the second one starts', () => {
		expect(blend.duration).toBeCloseTo(0.5, 6);
		expect(diff(rotOf(blend, 0), rotOf(walk, 0))).toBeLessThan(1e-3);
		expect(diff(rotOf(blend, blend.times.length - 1), rotOf(run, 0))).toBeLessThan(1e-3);
		expect(blend.loop).toBe(false);
		expect(blend.speed).toBeGreaterThan(Math.min(walk.speed, run.speed) - 1e-9);
	});

	it('changes smoothly in between: no step bigger than the clips it joins take', () => {
		const step = (c: SampledClip) => {
			let w = 0;
			for (let f = 1; f < c.times.length; f++) w = Math.max(w, diff(rotOf(c, f), rotOf(c, f - 1)));
			return w;
		};
		expect(step(blend)).toBeLessThan(Math.max(step(walk), step(run)) * 1.1);
	});

	it('needs two ordinary clips', () => {
		const bad = { ...getTemplate('biped')!.scene, clips: [{ id: 'b', type: 'blend', from: 'walk', to: 'nope' }, { id: 'walk', type: 'walk' }] };
		const r = parseScene(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/no clip "nope" to blend to/);
		const chain = parseScene({ ...getTemplate('biped')!.scene, clips: [{ id: 'walk', type: 'walk' }, { id: 'a', type: 'blend', from: 'walk', to: 'b' }, { id: 'b', type: 'blend', from: 'walk', to: 'walk' }] });
		expect(chain.ok).toBe(false);
		if (!chain.ok) expect(chain.error).toMatch(/is itself a blend/);
	});
});
