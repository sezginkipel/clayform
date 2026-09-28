import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildScene } from '../core/build.js';
import { migrate, type Migration } from '../core/migrate.js';
import { FORMAT, parseScene } from '../core/schema.js';
import { Style } from '../core/style.js';
import { parseLayout } from '../layout.js';

// Everything Clayform shipped when clayform/1 was frozen. Every later version must still load it.
const corpus = JSON.parse(readFileSync(new URL('./fixtures/clayform-1.0.json', import.meta.url), 'utf8')) as {
	scenes: Record<string, unknown>;
	layouts: Record<string, unknown>;
	styles: Record<string, unknown>;
};

describe('the frozen clayform/1 corpus', () => {
	it('has every 1.0 template, the README goblin, the example layout and style', () => {
		expect(Object.keys(corpus.scenes).length).toBeGreaterThanOrEqual(44);
		expect(corpus.scenes.goblin).toBeDefined();
		expect(corpus.layouts.camp).toBeDefined();
		expect(corpus.styles.toybox).toBeDefined();
	});

	for (const [id, doc] of Object.entries(corpus.scenes))
		it(`scene ${id} still parses and builds`, () => {
			const r = parseScene(doc);
			expect(r.ok, r.ok ? '' : r.error).toBe(true);
			if (!r.ok) return;
			const b = buildScene(r.scene, { resolution: 40 });
			expect(b.stats.triangles).toBeGreaterThan(50);
		});

	it('the example layout and style still parse', () => {
		const l = parseLayout(corpus.layouts.camp);
		expect(l.ok, l.ok ? '' : l.error).toBe(true);
		const s = Style.safeParse(corpus.styles.toybox);
		expect(s.success, s.success ? '' : s.error.message).toBe(true);
	});
});

describe('migrations', () => {
	// a made-up older format, to prove the chain: clayform/0 called parts "pieces"
	const chain: Migration[] = [
		{ from: 'clayform/0', to: 'clayform/0.5', note: 'pieces are called parts', up: (d) => ({ ...d, parts: d.pieces, pieces: undefined }) },
		{ from: 'clayform/0.5', to: FORMAT, note: 'drop the undefined leftover', up: (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) }
	];

	it('walks a document up every step to the current format and says what changed', () => {
		const old = { format: 'clayform/0', name: 'Old', pieces: [{ id: 'ball', shape: { type: 'sphere', radius: 0.3 } }] };
		const m = migrate(old, FORMAT, chain);
		expect(m.ok).toBe(true);
		if (!m.ok) return;
		expect(m.steps).toEqual(['clayform/0 → clayform/0.5: pieces are called parts', `clayform/0.5 → ${FORMAT}: drop the undefined leftover`]);
		const r = parseScene(m.doc);
		expect(r.ok, r.ok ? '' : r.error).toBe(true);
		// the input is not modified
		expect((old as { pieces?: unknown }).pieces).toBeDefined();
	});

	it('refuses a newer format with a way forward, and leaves the current one alone', () => {
		const r = parseScene({ format: 'clayform/9', name: 'Future', parts: [] });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/newer Clayform/);
		const cur = migrate({ format: FORMAT, name: 'x', parts: [] }, FORMAT, chain);
		expect(cur.ok && cur.steps).toEqual([]);
	});

	it('clayform/1 needs no migration today', () => {
		const r = parseScene(corpus.scenes.biped);
		expect(r.ok && r.migrated).toBeUndefined();
	});
});
