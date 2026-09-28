/**
 * Workspace: named scenes on disk, per-scene undo/redo and snapshots, and a
 * small build cache so render → inspect → export do not remesh.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildScene, type Build } from './core/build.js';
import { buildSceneAsync } from './core/parallel.js';
import { compile } from './core/compile.js';
import { applyOps } from './core/ops.js';
import { emptyScene, parseScene, type Scene } from './core/schema.js';
import { getTemplate } from './templates/index.js';
import { buildLayout, parseLayout, type Layout, type LayoutBuild } from './layout.js';

interface Entry {
	scene: Scene;
	undo: Scene[];
	redo: Scene[];
	snapshots: Map<string, Scene>;
}

export class Workspace {
	readonly dir: string;
	private scenes = new Map<string, Entry>();
	private cache: { key: string; build: Build }[] = [];
	private layouts = new Map<string, Layout>();

	constructor(dir = process.env.CLAYFORM_WORKSPACE ?? '.clayform') {
		this.dir = resolve(dir);
		mkdirSync(join(this.dir, 'scenes'), { recursive: true });
		for (const f of readdirSync(join(this.dir, 'scenes'))) {
			if (!f.endsWith('.clay.json')) continue;
			try {
				const r = parseScene(JSON.parse(readFileSync(join(this.dir, 'scenes', f), 'utf8')));
				if (r.ok) this.scenes.set(f.replace(/\.clay\.json$/, ''), { scene: r.scene, undo: [], redo: [], snapshots: new Map() });
			} catch {
				// unreadable file: leave it alone
			}
		}
	}

	list(): { id: string; name: string; parts: number; clips: number; effects: number }[] {
		return [...this.scenes.entries()].map(([id, e]) => ({ id, name: e.scene.name, parts: e.scene.parts.length, clips: e.scene.clips?.length ?? 0, effects: e.scene.effects?.length ?? 0 }));
	}

	private slug(name: string): string {
		const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'scene';
		let id = base, n = 2;
		while (this.scenes.has(id)) id = `${base}_${n++}`;
		return id;
	}

	create(name: string, template?: string): { id: string; scene: Scene } {
		let scene: Scene;
		if (template) {
			const t = getTemplate(template);
			if (!t) throw new Error(`no template "${template}" — call list_templates`);
			scene = JSON.parse(JSON.stringify(t.scene));
			scene.name = name;
		} else scene = emptyScene(name);
		const id = this.slug(name);
		this.scenes.set(id, { scene, undo: [], redo: [], snapshots: new Map() });
		this.save(id);
		return { id, scene };
	}

	import(doc: unknown, name?: string): { id: string; scene: Scene } {
		const r = parseScene(doc);
		if (!r.ok) throw new Error(r.error);
		const scene = r.scene;
		if (name) scene.name = name;
		const id = this.slug(scene.name);
		this.scenes.set(id, { scene, undo: [], redo: [], snapshots: new Map() });
		this.save(id);
		return { id, scene };
	}

	load(path: string): { id: string; scene: Scene } {
		return this.import(JSON.parse(readFileSync(resolve(path), 'utf8')));
	}

	get(id: string): Scene {
		const e = this.scenes.get(id);
		if (!e) throw new Error(`no scene "${id}"${this.scenes.size ? ` — scenes: ${[...this.scenes.keys()].join(', ')}` : ' — create one with new_scene'}`);
		return e.scene;
	}

	edit(id: string, ops: unknown[]) {
		const e = this.scenes.get(id);
		if (!e) throw new Error(`no scene "${id}"`);
		const r = applyOps(e.scene, ops);
		if (!r.ok) return r;
		e.undo.push(e.scene);
		if (e.undo.length > 200) e.undo.shift();
		e.redo = [];
		e.scene = r.scene;
		this.save(id);
		return r;
	}

	undo(id: string): boolean {
		const e = this.scenes.get(id);
		if (!e?.undo.length) return false;
		e.redo.push(e.scene);
		e.scene = e.undo.pop()!;
		this.save(id);
		return true;
	}

	redo(id: string): boolean {
		const e = this.scenes.get(id);
		if (!e?.redo.length) return false;
		e.undo.push(e.scene);
		e.scene = e.redo.pop()!;
		this.save(id);
		return true;
	}

	snapshot(id: string, label: string) {
		const e = this.scenes.get(id);
		if (!e) throw new Error(`no scene "${id}"`);
		e.snapshots.set(label, e.scene);
		const dir = join(this.dir, 'snapshots', id);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `${label.replace(/[^a-zA-Z0-9_-]+/g, '_')}.clay.json`), JSON.stringify(e.scene, null, 2));
	}

	restore(id: string, label: string): boolean {
		const e = this.scenes.get(id);
		const snap = e?.snapshots.get(label);
		if (!e || !snap) return false;
		e.undo.push(e.scene);
		e.redo = [];
		e.scene = snap;
		this.save(id);
		return true;
	}

	snapshots(id: string): string[] {
		return [...(this.scenes.get(id)?.snapshots.keys() ?? [])];
	}

	/** The scene as it was before the last edit, if any. */
	previous(id: string): Scene | null {
		const e = this.scenes.get(id);
		return e?.undo.length ? e.undo[e.undo.length - 1] : null;
	}

	history(id: string) {
		const e = this.scenes.get(id);
		return { undo: e?.undo.length ?? 0, redo: e?.redo.length ?? 0 };
	}

	path(id: string) {
		return join(this.dir, 'scenes', `${id}.clay.json`);
	}

	private save(id: string) {
		const e = this.scenes.get(id);
		if (e) writeFileSync(this.path(id), JSON.stringify(e.scene, null, 2));
	}

	/** Like build(), on worker threads when that helps (same result). */
	async buildAsync(id: string, resolution?: number): Promise<Build> {
		const scene = this.get(id);
		const key = JSON.stringify(scene) + '|' + (resolution ?? '');
		const hit = this.cache.find((c) => c.key === key);
		if (hit) return hit.build;
		const build = await buildSceneAsync(scene, { resolution });
		this.cache.unshift({ key, build });
		this.cache.length = Math.min(this.cache.length, 4);
		return build;
	}

	build(id: string, resolution?: number): Build {
		const scene = this.get(id);
		const key = JSON.stringify(scene) + '|' + (resolution ?? '');
		const hit = this.cache.find((c) => c.key === key);
		if (hit) return hit.build;
		const build = buildScene(scene, { resolution });
		this.cache.unshift({ key, build });
		this.cache.length = Math.min(this.cache.length, 4);
		return build;
	}

	/* ---------------------------------------------------------- layouts */

	/** A scene reference in a layout: a workspace scene id, a template id, or a .clay.json path. */
	resolveScene(ref: string): Scene {
		if (this.scenes.has(ref)) return this.scenes.get(ref)!.scene;
		const t = getTemplate(ref);
		if (t) return t.scene;
		const file = resolve(ref);
		if (existsSync(file)) {
			const r = parseScene(JSON.parse(readFileSync(file, 'utf8')));
			if (!r.ok) throw new Error(`${ref} is not a valid scene:\n${r.error}`);
			return r.scene;
		}
		throw new Error(`layout refers to "${ref}", which is not a scene in this workspace, a template, or a file`);
	}

	setLayout(name: string, doc: unknown): { id: string; layout: Layout } {
		const r = parseLayout(doc);
		if (!r.ok) throw new Error(r.error);
		const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'layout';
		mkdirSync(join(this.dir, 'layouts'), { recursive: true });
		writeFileSync(join(this.dir, 'layouts', `${id}.layout.json`), JSON.stringify(r.layout, null, 2));
		this.layouts.set(id, r.layout);
		return { id, layout: r.layout };
	}

	layout(id: string): Layout {
		const hit = this.layouts.get(id);
		if (hit) return hit;
		const file = join(this.dir, 'layouts', `${id}.layout.json`);
		if (existsSync(file)) {
			const r = parseLayout(JSON.parse(readFileSync(file, 'utf8')));
			if (r.ok) {
				this.layouts.set(id, r.layout);
				return r.layout;
			}
		}
		throw new Error(`no layout "${id}" — create one with set_layout`);
	}

	buildLayout(id: string): LayoutBuild {
		return buildLayout(this.layout(id), (ref) => this.resolveScene(ref));
	}

	exportsDir(): string {
		const d = join(this.dir, 'exports');
		if (!existsSync(d)) mkdirSync(d, { recursive: true });
		return d;
	}
}

/* ----------------------------------------------------------- summaries */

const f2 = (n: number) => (Math.abs(n) < 5e-4 ? '0' : n.toFixed(3).replace(/\.?0+$/, ''));
const v = (a: number[]) => `[${a.map(f2).join(', ')}]`;

function shapeText(p: Scene['parts'][number]): string {
	const s = p.shape;
	switch (s.type) {
		case 'sphere': return `sphere r${f2(s.radius)}`;
		case 'ellipsoid': return `ellipsoid ${v(s.radii)}`;
		case 'box': return `box ${v(s.size)}${s.rounding ? ` round ${f2(s.rounding)}` : ''}`;
		case 'capsule': return `capsule L${f2(s.length)} r${f2(s.radius)}`;
		case 'cylinder': return `cylinder h${f2(s.height)} r${f2(s.radius)}`;
		case 'cone': return `cone h${f2(s.height)} r${f2(s.radius)}${s.topRadius ? `→${f2(s.topRadius)}` : ''}`;
		case 'torus': return `torus R${f2(s.radius)} t${f2(s.tube)}`;
		case 'prism': return `prism ${v(s.size)}`;
		case 'tube': return `tube ${s.points.length} pts`;
		case 'mesh': return `mesh ${s.src}${s.size ? ` (${f2(s.size)} m)` : ''}`;
	}
}

/** Compact, model-friendly description of a scene with resolved world positions. */
export function describe(scene: Scene): string {
	const c = compile(scene);
	const lines: string[] = [];
	const st = scene.settings ?? {};
	lines.push(`scene "${scene.name}" — ${scene.parts.length} parts, ${scene.sculpts?.length ?? 0} sculpts, ${scene.clips?.length ?? 0} clips, ${scene.effects?.length ?? 0} effects`);
	lines.push(`settings: resolution ${st.resolution ?? 96}, ground ${st.ground ?? 'auto'}${st.symmetry === 'x' ? ', symmetry x' : ''}${st.budget ? `, budget ${st.budget}` : ''}`);
	if (scene.palette && Object.keys(scene.palette).length) lines.push(`palette: ${Object.entries(scene.palette).map(([k, x]) => `${k}=${x}`).join(' ')}`);
	lines.push('parts (world center before grounding · size):');
	for (const p of scene.parts) {
		const pr = c.byId.get(p.id);
		const center = pr ? [(pr.min[0] + pr.max[0]) / 2, (pr.min[1] + pr.max[1]) / 2, (pr.min[2] + pr.max[2]) / 2] : [0, 0, 0];
		const size = pr ? [pr.max[0] - pr.min[0], pr.max[1] - pr.min[1], pr.max[2] - pr.min[2]] : [0, 0, 0];
		const bits = [
			`${p.id}${p.role ? ` [${p.role}]` : ''}`,
			shapeText(p),
			p.attach ? `on ${p.attach.to}.${p.attach.side}${p.attach.offset ? ` ${v(p.attach.offset)}` : ''}${p.attach.align ? ' aligned' : ''}` : p.parent ? `child of ${p.parent}` : '',
			`@ ${v(center)} · ${v(size)}`,
			p.op && p.op !== 'add' ? p.op : '',
			p.blend ? `blend ${f2(p.blend)}` : '',
			p.material?.color ? `color ${p.material.color}` : '',
			p.mirror || (pr && pr.twinIndex >= 0) ? 'mirrored' : '',
			p.separate ? 'separate' : '',
			p.hidden ? 'hidden' : ''
		].filter(Boolean);
		lines.push('  ' + bits.join(' · '));
	}
	for (const s of scene.sculpts ?? [])
		lines.push(`sculpt ${s.id}: ${s.kind} r${f2(s.radius)} amount ${f2(s.amount)}${s.at ? ` at ${'to' in s.at ? `${s.at.to}.${s.at.side}` : v(s.at.point)}` : ' (global)'}${s.mirror ? ' mirrored' : ''}`);
	for (const k of scene.clips ?? []) lines.push(`clip ${k.id}: ${k.type}${k.speed ? ` ×${k.speed}` : ''}${k.tracks?.length ? `, ${k.tracks.length} tracks` : ''}`);
	for (const e of scene.effects ?? []) lines.push(`effect ${e.id}: ${e.preset ?? 'custom'}${e.count ? `, ${e.count} particles` : ''}`);
	if (c.warnings.length) lines.push(...c.warnings.map((w) => `note: ${w}`));
	return lines.join('\n');
}
