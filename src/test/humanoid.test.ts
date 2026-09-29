import { describe, expect, it } from 'vitest';
// @ts-expect-error — the validator ships without types
import validator from 'gltf-validator';
import { boneName, humanoidSkeleton, REQUIRED_BONES } from '../anim/humanoid.js';
import { buildRig } from '../anim/rig.js';
import { buildScene } from '../core/build.js';
import { exportGlb } from '../export/gltf.js';
import { getTemplate } from '../templates/index.js';

type Node = { name: string; translation?: number[]; children?: number[] };

/** World rest position of every node, from the translations alone (rest rotations are identity). */
function worldRest(nodes: Node[], root: number) {
	const out = new Map<number, number[]>();
	const walk = (i: number, at: number[]) => {
		const t = nodes[i].translation ?? [0, 0, 0];
		const p = [at[0] + t[0], at[1] + t[1], at[2] + t[2]];
		out.set(i, p);
		for (const c of nodes[i].children ?? []) walk(c, p);
	};
	walk(root, [0, 0, 0]);
	return out;
}

const HUMANS = ['biped', 'knight', 'robot', 'teddy', 'wizard', 'snowman'];

describe('humanoid skeletons', () => {
	for (const id of HUMANS)
		it(`${id}: every required bone, in a valid file, rest pose unchanged`, async () => {
			const b = buildScene(getTemplate(id)!.scene);
			const r = exportGlb(b, { skeleton: 'humanoid' });
			const rep = await validator.validateBytes(r.glb);
			expect(rep.issues.numErrors).toBe(0);
			const nodes = r.json.nodes as Node[];
			const skin = (r.json.skins as { joints: number[] }[])[0];
			const names = skin.joints.map((j) => nodes[j].name);
			for (const bone of REQUIRED_BONES) expect(names).toContain(bone);
			expect(new Set(names).size).toBe(names.length);

			// the chain goes the way a retargeter walks it
			const parentOf = new Map<number, number>();
			nodes.forEach((n, i) => n.children?.forEach((c) => parentOf.set(c, i)));
			const byName = new Map(nodes.map((n, i) => [n.name, i]));
			const under = (child: string, anc: string) => {
				for (let k = byName.get(child); k !== undefined; k = parentOf.get(k)) if (nodes[k].name === anc) return true;
				return false;
			};
			for (const S of ['Left', 'Right']) {
				expect(under(`${S}Hand`, `${S}LowerArm`)).toBe(true);
				expect(under(`${S}LowerArm`, `${S}UpperArm`)).toBe(true);
				expect(under(`${S}UpperArm`, 'Spine')).toBe(true);
				expect(under(`${S}Foot`, `${S}LowerLeg`)).toBe(true);
				expect(under(`${S}LowerLeg`, `${S}UpperLeg`)).toBe(true);
				expect(under(`${S}UpperLeg`, 'Hips')).toBe(true);
				expect(under(`${S}UpperLeg`, 'Spine')).toBe(false);
			}
			expect(under('Head', 'Spine')).toBe(true);
			expect(under('Spine', 'Hips')).toBe(true);

			// left is the character's left: +X, since models face +Z
			const world = worldRest(nodes, skin.joints[0]);
			expect(world.get(byName.get('LeftUpperArm')!)![0]).toBeGreaterThan(0);
			expect(world.get(byName.get('RightUpperLeg')!)![0]).toBeLessThan(0);

			// re-parenting moved no joint: each rig joint sits where the part-named export puts it
			const plain = exportGlb(b, { rig: true });
			const pn = plain.json.nodes as Node[];
			const ps = (plain.json.skins as { joints: number[] }[])[0].joints;
			const pw = worldRest(pn, ps[0]);
			const rig = buildRig(b);
			rig.joints.forEach((_, i) => {
				const a = world.get(skin.joints[i])!, c = pw.get(ps[i])!;
				for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(c[k], 5);
			});
		});

	it('mixamo and unreal names', () => {
		const b = buildScene(getTemplate('knight')!.scene);
		for (const [naming, want] of [
			['mixamo', ['mixamorig:Hips', 'mixamorig:LeftForeArm', 'mixamorig:RightUpLeg', 'mixamorig:Spine']],
			['unreal', ['pelvis', 'lowerarm_l', 'thigh_r', 'spine_01', 'head']]
		] as const) {
			const r = exportGlb(b, { skeleton: naming });
			const names = (r.json.nodes as Node[]).map((n) => n.name);
			for (const w of want) expect(names).toContain(w);
			expect(boneName('LeftHand', naming)).toBe(naming === 'mixamo' ? 'mixamorig:LeftHand' : 'hand_l');
		}
	});

	it('animation still plays on the renamed joints', async () => {
		const b = buildScene(getTemplate('biped')!.scene);
		const r = exportGlb(b, { skeleton: 'mixamo' });
		expect(await validator.validateBytes(r.glb).then((x: { issues: { numErrors: number } }) => x.issues.numErrors)).toBe(0);
		const anims = r.json.animations as { channels: { target: { node: number } }[] }[];
		expect(anims.length).toBeGreaterThan(0);
		const nodes = r.json.nodes as Node[];
		const targets = new Set(anims.flatMap((a) => a.channels.map((c) => nodes[c.target.node].name)));
		expect(targets).toContain('mixamorig:LeftUpLeg');
	});

	it('a robe hides its legs: leg bones where they would be, bound to nothing', () => {
		const b = buildScene(getTemplate('wizard')!.scene);
		const s = humanoidSkeleton(b, buildRig(b));
		expect(s.missing).toEqual([]);
		const foot = s.joints[s.bones.LeftFoot!];
		expect(foot.joint).toBe(-1);
		expect(foot.rest[1]).toBeLessThan(0.1);
	});

	it('refuses what is not a humanoid, and says what is missing', () => {
		const b = buildScene(getTemplate('quadruped')!.scene);
		expect(() => exportGlb(b, { skeleton: 'humanoid' })).toThrow(/LeftUpperArm/);
		expect(() => exportGlb(b, { skeleton: 'parts', rig: true })).not.toThrow();
	});
});
