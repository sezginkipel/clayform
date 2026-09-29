import { describe, expect, it } from 'vitest';
import { buildLayout, critiqueLayout, describeLayout, parseLayout } from '../layout.js';
import { getTemplate } from '../templates/index.js';

function layout(items: object[], settle = true) {
	const r = parseLayout({ format: 'clayform-layout/1', name: 'test', settle, items });
	if (!r.ok) throw new Error(r.error);
	return buildLayout(r.layout, (id) => getTemplate(id)!.scene);
}

const rest = (lb: ReturnType<typeof layout>, id: string) => lb.settled!.find((s) => s.id === id)!;

describe('settling a layout', () => {
	it('drops a cup from above onto the table top, not through it and not onto the floor', () => {
		const lb = layout([{ id: 'table', scene: 'table', position: [0, 0] }, { id: 'cup', scene: 'cup', position: [0.1, 3, 0.05] }]);
		const top = lb.builds.get('table')!.max[1];
		const cup = rest(lb, 'cup');
		expect(cup.on).toBe('table');
		// the cup's lowest point sits on the table's highest one, within a couple of millimetres
		expect(Math.abs(cup.to + lb.builds.get('cup')!.min[1] - top)).toBeLessThan(0.006);
		expect(cup.tips).toBe(false);
	});

	it('something under the table lands on the floor: the first surface below it, not the top', () => {
		const lb = layout([{ id: 'table', scene: 'table', position: [0, 0] }, { id: 'cup', scene: 'cup', position: [0, 0.2, 0] }]);
		expect(rest(lb, 'cup').on).toBe('ground');
		expect(rest(lb, 'cup').to).toBeLessThan(0.01);
	});

	it('stacks items placed inside each other, and nothing passes through anything after', () => {
		const lb = layout([
			{ id: 'a', scene: 'chest', position: [0, 0] },
			{ id: 'b', scene: 'chest', position: [0.05, 0, 0.02], rotation: 20 },
			{ id: 'c', scene: 'chest', position: [0, 0, 0] }
		]);
		const ys = ['a', 'b', 'c'].map((id) => rest(lb, id).to).sort((x, y) => x - y);
		const h = lb.builds.get('chest')!.max[1] - lb.builds.get('chest')!.min[1];
		expect(ys[1] - ys[0]).toBeGreaterThan(h * 0.8);
		expect(ys[2] - ys[1]).toBeGreaterThan(h * 0.8);
		expect(critiqueLayout(lb).filter((i) => i.code === 'items-overlap')).toEqual([]);
		// without settle the same layout does pass through itself
		expect(critiqueLayout(layout([{ id: 'a', scene: 'chest', position: [0, 0] }, { id: 'c', scene: 'chest', position: [0.15, 0, 0.05] }], false)).some((i) => i.code === 'items-overlap')).toBe(true);
	});

	it('says when an item would tip over an edge', () => {
		const lb = layout([{ id: 'table', scene: 'table', position: [0, 0] }, { id: 'barrel', scene: 'barrel', position: [-0.78, 2, 0] }]);
		const half = (lb.builds.get('table')!.max[0] - lb.builds.get('table')!.min[0]) / 2;
		expect(half).toBeLessThan(0.78);
		expect(rest(lb, 'barrel').on).toBe('table');
		expect(rest(lb, 'barrel').tips).toBe(true);
		expect(critiqueLayout(lb).some((i) => i.code === 'item-tips')).toBe(true);
		expect(describeLayout(lb)).toMatch(/would tip: barrel/);
	});

	it('a fixed item stays where it is placed and holds up what lands on it', () => {
		const lb = layout([{ id: 'shelf', scene: 'table', position: [0, 1.2, 0], fixed: true }, { id: 'cup', scene: 'cup', position: [0, 3, 0] }]);
		expect(rest(lb, 'shelf').to).toBe(1.2);
		expect(rest(lb, 'cup').on).toBe('shelf');
		expect(rest(lb, 'cup').to).toBeGreaterThan(1.2 + lb.builds.get('table')!.max[1] - 0.01);
	});

	it('leaves positions alone without settle', () => {
		const lb = layout([{ id: 'cup', scene: 'cup', position: [0, 3, 0] }], false);
		expect(lb.settled).toBeUndefined();
		expect(lb.placed[0].position[1]).toBe(3);
	});
});
