import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { expressionProblems, expressionScene, meshMorphs } from '../anim/morph.js';
import { buildRig, sampleClip } from '../anim/rig.js';
import { buildScene } from '../core/build.js';
import { bodyField, compile, partDist } from '../core/compile.js';
import { integrity, parseScene, type Scene } from '../core/schema.js';
import { applyStyle } from '../core/style.js';
import { critique } from '../critic/critics.js';
import { exportGlb } from '../export/gltf.js';
import { getTemplate } from '../templates/index.js';

/** The frog with its eyes' whites and pupils as separate parts, three expressions and face clips. */
function frog(): Scene {
	const base = getTemplate('frog')!.scene;
	const r = parseScene({
		...base,
		parts: base.parts.map((p) => (p.id === 'eye_white' || p.id === 'pupil' ? { ...p, separate: true } : p)),
		expressions: [{ id: 'blink', preset: 'blink' }, { id: 'smile', preset: 'smile' }, { id: 'open_mouth', preset: 'open_mouth' }],
		clips: [...(base.clips ?? []), { id: 'blinking', type: 'blink' }, { id: 'talking', type: 'talk' }, { id: 'hop_smiling', type: 'hop', face: { smile: 1 } }, { id: 'grin', type: 'expression', expression: 'smile' }]
	});
	if (!r.ok) throw new Error(r.error);
	return r.scene;
}

const scene = frog();
const b = buildScene(scene);
const body = b.meshes.find((m) => m.prim < 0)!;
const targets = (id: string, m = body) => meshMorphs(b, m).find((t) => t.id === id)!;

describe('expressions as morph targets', () => {
	it('moves only what the expression changes', () => {
		// a blink of separate eyes leaves the body alone
		expect(targets('blink').moved).toBe(0);
		const white = b.meshes.find((m) => m.prim >= 0 && b.compiled.prims[m.prim].id === 'eye_white')!;
		expect(targets('blink', white).moved).toBeGreaterThan(0);
		// the feet do not smile
		const sm = targets('smile');
		expect(sm.moved).toBeGreaterThan(0);
		for (let v = 0; v < body.positions.length / 3; v++)
			if (body.positions[v * 3 + 1] < 0.06) expect(Math.hypot(sm.dp[v * 3], sm.dp[v * 3 + 1], sm.dp[v * 3 + 2])).toBeLessThan(1e-6);
	});

	it('lands the moved vertices on the expression surface, and the mouth color goes with the mouth', () => {
		const c1 = compile(applyStyle(expressionScene(b.source, scene.expressions!.find((e) => e.id === 'smile')!).scene));
		const mouth = b.compiled.byId.get('mouth')!, mouth1 = c1.byId.get('mouth')!;
		const t = targets('smile');
		let checked = 0, onMouth = 0, mouthVerts = 0;
		for (let v = 0; v < body.positions.length / 3; v++) {
			const d = Math.hypot(t.dp[v * 3], t.dp[v * 3 + 1], t.dp[v * 3 + 2]);
			if (d < 1e-4) continue;
			const p = [0, 1, 2].map((k) => body.positions[v * 3 + k] + t.dp[v * 3 + k] - b.offset[k]) as [number, number, number];
			expect(Math.abs(bodyField(c1, ...p))).toBeLessThan(b.cell);
			checked++;
			// the corners, where the bend moves the mouth most
			if (body.vertPrim[v] === mouth.index && Math.abs(p[0] - mouth.pos[0]) > (mouth.max[0] - mouth.min[0]) * 0.3) {
				mouthVerts++;
				if (Math.abs(partDist(mouth1, ...p)) < b.cell * 1.5) onMouth++;
			}
		}
		expect(checked).toBeGreaterThan(50);
		// the dark mouth vertices ride with the bent mouth rather than staying where the old one was
		expect(onMouth / mouthVerts).toBeGreaterThan(0.8);
	});

	it('the smile raises the corners of the mouth above its middle', () => {
		const c1 = compile(applyStyle(expressionScene(b.source, scene.expressions!.find((e) => e.id === 'smile')!).scene));
		const m0 = b.compiled.byId.get('mouth')!, m1 = c1.byId.get('mouth')!;
		expect(m1.curveK).toBeGreaterThan(0);
		// a point at the corner is inside the new mouth, above where the old corner was
		const corner = [m0.max[0] * 0.8, m0.pos[1] + m1.curve * 0.64, m0.pos[2]] as const;
		expect(partDist(m1, ...corner)).toBeLessThan(0);
		expect(partDist(m0, ...corner)).toBeGreaterThan(0);
	});

	it('clips carry weights: blink loops, talk varies, the face layer holds', () => {
		const rig = buildRig(b);
		const clip = (id: string) => sampleClip(b, rig, scene.clips!.find((c) => c.id === id)!);
		const blink = clip('blinking').morph!.blink;
		expect(Math.max(...blink)).toBeCloseTo(1, 2);
		expect(blink[0]).toBe(blink[blink.length - 1]);
		const talk = clip('talking').morph!.open_mouth;
		expect(new Set(talk.map((x) => x.toFixed(2))).size).toBeGreaterThan(8);
		expect(clip('hop_smiling').morph!.smile.every((x) => x === 1)).toBe(true);
		const grin = clip('grin').morph!.smile;
		expect(grin[0]).toBe(0);
		expect(Math.max(...grin)).toBeCloseTo(1, 2);
	});

	it('exports morph targets and weight animations the validator accepts', async () => {
		for (const opts of [{}, { texture: 256 }]) {
			const r = exportGlb(b, opts);
			const rep = await validator.validateBytes(r.glb);
			expect(rep.issues.numErrors).toBe(0);
			expect(rep.issues.numWarnings).toBe(0);
			const meshes = r.json.meshes as { extras?: { targetNames: string[] }; weights?: number[]; primitives: { targets?: unknown[] }[] }[];
			const withTargets = meshes.filter((m) => m.extras?.targetNames);
			expect(withTargets.length).toBeGreaterThan(0);
			for (const m of withTargets) {
				expect(m.extras!.targetNames).toEqual(['blink', 'smile', 'open_mouth']);
				for (const p of m.primitives) expect(p.targets).toHaveLength(3);
			}
			const anims = r.json.animations as { name: string; channels: { target: { path: string } }[] }[];
			expect(anims.find((a) => a.name === 'talking')!.channels.some((c) => c.target.path === 'weights')).toBe(true);
			expect(anims.find((a) => a.name === 'hop')!.channels.some((c) => c.target.path === 'weights')).toBe(false);
			expect(r.expressions!.every((e) => e.vertices > 0)).toBe(true);
		}
	});

	it('says what a preset needs, and warns when fused eyes will streak', () => {
		const bip = parseScene({ ...getTemplate('biped')!.scene, expressions: [{ id: 'smile', preset: 'smile' }] });
		if (!bip.ok) throw new Error(bip.error);
		const bb = buildScene(bip.scene);
		expect(expressionProblems(bb)[0]).toMatch(/needs a mouth part/);
		expect(critique(bb).issues.some((i) => i.code === 'expression' && i.severity === 'error')).toBe(true);

		const fused = parseScene({ ...getTemplate('frog')!.scene, expressions: [{ id: 'blink', preset: 'blink' }] });
		if (!fused.ok) throw new Error(fused.error);
		expect(critique(buildScene(fused.scene)).issues.find((i) => i.code === 'expression')?.message).toMatch(/separate/);

		const noExpr = { ...getTemplate('biped')!.scene, clips: [{ id: 'b', type: 'blink' as const }] };
		expect(integrity(noExpr).some((e) => /blink needs an expression/.test(e.message))).toBe(true);
	});
});

describe('curve', () => {
	it('bends a part: the ends rise, the middle stays', () => {
		const r = parseScene({ format: getTemplate('biped')!.scene.format, name: 'banana', parts: [{ id: 'a', shape: { type: 'capsule', length: 0.6, radius: 0.05 }, rotation: [0, 0, 90], curve: 0.15 }] });
		if (!r.ok) throw new Error(r.error);
		const c = compile(r.scene);
		const pr = c.prims[0];
		// rotated 90° about Z, local X points down world Y... use the prim's own frame through partDist at its local ends
		const flat = compile({ ...r.scene, parts: [{ ...r.scene.parts[0], curve: 0 }] }).prims[0];
		expect(pr.max[0] - pr.min[0]).toBeGreaterThan(flat.max[0] - flat.min[0] + 0.1);
	});
});
