import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { anchorSurface, compile, primDist } from '../core/compile.js';
import { applyOps } from '../core/ops.js';
import { parseScene } from '../core/schema.js';
import { TEMPLATES } from '../templates/index.js';
import { ball, scene } from './helpers.js';

describe('schema', () => {
	it('every template is a valid scene', () => {
		for (const t of TEMPLATES) {
			const r = parseScene(t.scene);
			expect(r.ok, `${t.id}: ${!r.ok ? r.error : ''}`).toBe(true);
		}
	});

	it('rejects unknown fields instead of silently dropping them', () => {
		const r = parseScene({ ...scene([ball('a', 0.2)]), parts: [{ ...ball('a', 0.2), colour: 'red' }] });
		expect(r.ok).toBe(false);
	});

	it('catches cross-reference mistakes with a fix hint', () => {
		const dup = parseScene(scene([ball('a', 0.1), ball('a', 0.2)]));
		expect(!dup.ok && dup.error).toMatch(/duplicate part id "a"/);
		const ref = parseScene(scene([ball('a', 0.1, { attach: { to: 'nope', side: 'top' } })]));
		expect(!ref.ok && ref.error).toMatch(/unknown part "nope"/);
		const cyc = parseScene(scene([ball('a', 0.1, { attach: { to: 'b', side: 'top' } }), ball('b', 0.1, { attach: { to: 'a', side: 'top' } })]));
		expect(!cyc.ok && cyc.error).toMatch(/cycle/);
		const cap = parseScene(scene([{ id: 'c', shape: { type: 'capsule', length: 0.1, radius: 0.1 } }]));
		expect(!cap.ok && cap.error).toMatch(/at least 2 × radius/);
		const pal = parseScene(scene([ball('a', 0.1, { material: { color: 'skin' } })]));
		expect(!pal.ok && pal.error).toMatch(/palette has no color "skin"/);
	});
});

describe('edit ops', () => {
	const base = scene([ball('body', 0.3), ball('head', 0.15, { attach: { to: 'body', side: 'top' } })]);

	it('is atomic: a failing op leaves the scene untouched', () => {
		const r = applyOps(base, [
			{ op: 'update_part', id: 'head', set: { shape: { radius: 0.2 } } },
			{ op: 'update_part', id: 'ghost', set: { blend: 0.1 } }
		]);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.error).toMatch(/op 1 \(update_part\): no part "ghost"/);
		expect((base.parts[1].shape as { radius: number }).radius).toBe(0.15);
	});

	it('merges objects, replaces a shape when its type changes, null removes', () => {
		const r = applyOps(base, [
			{ op: 'update_part', id: 'head', set: { shape: { radius: 0.2 }, attach: { embed: 0.5 } } },
			{ op: 'update_part', id: 'body', set: { shape: { type: 'box', size: [0.4, 0.4, 0.4] } } },
			{ op: 'update_part', id: 'head', set: { attach: { embed: null } } }
		]);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.scene.parts[1].shape).toEqual({ type: 'sphere', radius: 0.2 });
		expect(r.scene.parts[1].attach).toEqual({ to: 'body', side: 'top' });
		expect(r.scene.parts[0].shape).toEqual({ type: 'box', size: [0.4, 0.4, 0.4] });
	});

	it('refuses to orphan parts unless cascading, and rename follows references', () => {
		const r = applyOps(base, [{ op: 'remove_part', id: 'body' }]);
		expect(!r.ok && r.error).toMatch(/head attach to "body"/);
		const c = applyOps(base, [{ op: 'remove_part', id: 'body', cascade: true }]);
		expect(c.ok && c.scene.parts.length).toBe(0);
		const n = applyOps(base, [{ op: 'rename_part', id: 'body', to: 'torso' }]);
		expect(n.ok && n.scene.parts[1].attach?.to).toBe('torso');
	});
});

describe('placement', () => {
	it('an attached part touches its target with embed 0', () => {
		const c = compile(scene([ball('body', 0.3), ball('head', 0.15, { attach: { to: 'body', side: 'top', embed: 0 } })]));
		const head = c.byId.get('head')!;
		expect(head.pos[1]).toBeCloseTo(0.45, 2);
		expect(head.pos[0]).toBeCloseTo(0, 3);
	});

	it('sides are world directions even on a rotated target', () => {
		const c = compile(scene([
			{ id: 'log', shape: { type: 'capsule', length: 1, radius: 0.1 }, rotation: [90, 0, 0] },
			ball('cap', 0.05, { attach: { to: 'log', side: 'front', embed: 0 } })
		]));
		const cap = c.byId.get('cap')!;
		expect(cap.pos[2]).toBeGreaterThan(0.5);
		expect(Math.abs(cap.pos[1])).toBeLessThan(0.01);
	});

	it('without offset, "bottom" of a tilted part is its lowest tip', () => {
		const c = compile(scene([
			{ id: 'arm', shape: { type: 'capsule', length: 0.4, radius: 0.04 }, rotation: [0, 0, 30] },
			ball('hand', 0.05, { attach: { to: 'arm', side: 'bottom', embed: 0.5 } })
		]));
		const hand = c.byId.get('hand')!;
		// capsule tip after a +30° roll moves toward +X and down
		expect(hand.pos[0]).toBeGreaterThan(0.06);
		expect(hand.pos[1]).toBeLessThan(-0.15);
	});

	it('mirror twins are exact reflections and inherit to attached children', () => {
		const c = compile(scene([
			ball('body', 0.3),
			{ id: 'arm', shape: { type: 'capsule', length: 0.3, radius: 0.04 }, attach: { to: 'body', side: 'left', embed: 0.5 }, rotation: [0, 0, 20], mirror: true },
			ball('hand', 0.05, { attach: { to: 'arm', side: 'bottom' } })
		]));
		const arm = c.byId.get('arm')!, twin = c.byId.get('arm.m')!;
		expect(twin.pos[0]).toBeCloseTo(-arm.pos[0], 6);
		expect(c.byId.get('hand.m')).toBeDefined();
		const p: [number, number, number] = [0.31, 0.02, 0.01];
		expect(primDist(twin, -p[0], p[1], p[2])).toBeCloseTo(primDist(arm, p[0], p[1], p[2]), 6);
	});

	it('anchor offsets slide across the side', () => {
		const c = compile(scene([{ id: 'box', shape: { type: 'box', size: [1, 1, 1] } }]));
		const a = anchorSurface(c.byId.get('box')!, { side: 'top', offset: [0.5, 0] });
		expect(a.p[0]).toBeCloseTo(0.25, 2);
		expect(a.p[1]).toBeCloseTo(0.5, 2);
	});
});

describe('meshing', () => {
	it('a sphere is closed, accurate and stands on the ground', () => {
		const b = buildScene(scene([ball('s', 0.5)]), { resolution: 48 });
		const m = b.meshes[0];
		let maxErr = 0;
		for (let i = 0; i < m.positions.length; i += 3) {
			const r = Math.hypot(m.positions[i], m.positions[i + 1] - 0.5, m.positions[i + 2]);
			maxErr = Math.max(maxErr, Math.abs(r - 0.5));
		}
		expect(maxErr).toBeLessThan(b.cell * 0.6);
		expect(b.min[1]).toBeCloseTo(0, 6);
		const edges = new Map<string, number>();
		for (let t = 0; t < m.indices.length; t += 3)
			for (let e = 0; e < 3; e++) {
				const a = m.indices[t + e], c = m.indices[t + ((e + 1) % 3)];
				const k = a < c ? `${a},${c}` : `${c},${a}`;
				edges.set(k, (edges.get(k) ?? 0) + 1);
			}
		expect([...edges.values()].every((v) => v === 2)).toBe(true);
	});

	it('carve removes material and paints the cavity', () => {
		const b = buildScene(scene([
			{ id: 'box', shape: { type: 'box', size: [1, 1, 1] }, material: { color: '#ff0000' } },
			ball('hole', 0.3, { position: [0, 0, 0.5], op: 'carve', material: { color: '#0000ff' } })
		]), { resolution: 48 });
		const m = b.meshes[0];
		let blue = 0;
		for (let v = 0; v < m.colors.length / 3; v++) if (m.colors[v * 3 + 2] > 0.8 && m.colors[v * 3] < 0.3) blue++;
		expect(blue).toBeGreaterThan(50);
	});
});
