/**
 * Edit operations. A batch is atomic: every op is applied to a copy, the
 * result is validated as a whole, and nothing changes if anything fails.
 * Error messages name the op index and say how to fix it.
 */

import { z } from 'zod';
import { Anchor, Clip, Color, Effect, FORMAT, Id as PartId, Part, Scene, Sculpt, Settings, formatZodError, parseScene, type Scene as SceneT } from './schema.js';
import { expandLibraryPart } from '../library/parts.js';

const Id = z.string();
const Patch = z.record(z.string(), z.unknown());

export const Op = z.discriminatedUnion('op', [
	z.strictObject({ op: z.literal('add_part'), part: Part, after: z.string().optional().describe('insert after this part id ("start" for first); default: end') }),
	z.strictObject({
		op: z.literal('add_library_part'),
		name: z.string().describe('library part name from list_parts'),
		id: PartId.describe('id for the root; the others become id_<suffix>'),
		attach: Anchor.partial({ side: true }).describe('where the root goes; side defaults to the usual side of the library part'),
		size: z.number().positive().max(20).optional().describe('scale the whole group (1 = sized for a ~1 m character)'),
		mirror: z.boolean().optional().describe('pairs (eyes, ears, wings) mirror by default'),
		color: Color.optional().describe('root color; parts without a color take the color of the part they attach to'),
		after: z.string().optional()
	}),
	z.strictObject({ op: z.literal('update_part'), id: Id, set: Patch.describe('fields to change; objects merge, arrays replace, null removes a field') }),
	z.strictObject({ op: z.literal('remove_part'), id: Id, cascade: z.boolean().optional().describe('also remove parts attached to it') }),
	z.strictObject({ op: z.literal('rename_part'), id: Id, to: Id }),
	z.strictObject({ op: z.literal('duplicate_part'), id: Id, as: Id, set: Patch.optional() }),
	z.strictObject({ op: z.literal('add_sculpt'), sculpt: Sculpt }),
	z.strictObject({ op: z.literal('update_sculpt'), id: Id, set: Patch }),
	z.strictObject({ op: z.literal('remove_sculpt'), id: Id }),
	z.strictObject({ op: z.literal('add_clip'), clip: Clip }),
	z.strictObject({ op: z.literal('update_clip'), id: Id, set: Patch }),
	z.strictObject({ op: z.literal('remove_clip'), id: Id }),
	z.strictObject({ op: z.literal('add_effect'), effect: Effect }),
	z.strictObject({ op: z.literal('update_effect'), id: Id, set: Patch }),
	z.strictObject({ op: z.literal('remove_effect'), id: Id }),
	z.strictObject({ op: z.literal('set_settings'), set: Settings.partial() }),
	z.strictObject({ op: z.literal('set_palette'), set: z.record(z.string(), z.union([z.string(), z.null()])) }),
	z.strictObject({
		op: z.literal('set_meta'),
		name: z.string().optional(),
		notes: z.string().optional(),
		style: z.union([z.string(), z.null()]).optional().describe('path to a .style.json shared across a pack; null removes it'),
		category: z.union([z.string(), z.null()]).optional().describe('what this is in the pack (character, prop …); null removes it')
	}),
	z.strictObject({ op: z.literal('replace'), scene: z.unknown().describe('a whole scene document') })
]);
export type Op = z.infer<typeof Op>;

export type OpResult = { ok: true; scene: SceneT; changes: string[] } | { ok: false; error: string };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function isObj(x: unknown): x is Record<string, unknown> {
	return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Deep merge: objects merge, arrays/primitives replace, null deletes. A shape with a new type is replaced. */
export function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...base };
	for (const [k, v] of Object.entries(patch)) {
		if (v === null) delete out[k];
		else if (k === 'shape' && isObj(v) && isObj(out[k]) && v.type && v.type !== (out[k] as Record<string, unknown>).type) out[k] = v;
		else if (isObj(v) && isObj(out[k])) out[k] = merge(out[k] as Record<string, unknown>, v);
		else out[k] = v;
	}
	return out;
}

function dependents(s: SceneT, id: string): string[] {
	return s.parts.filter((p) => (p.attach?.to ?? p.parent) === id).map((p) => p.id);
}

export function applyOps(scene: SceneT, ops: unknown[]): OpResult {
	let s: SceneT = clone(scene);
	const changes: string[] = [];
	for (let i = 0; i < ops.length; i++) {
		const parsed = Op.safeParse(ops[i]);
		const where = `op ${i}${isObj(ops[i]) && typeof (ops[i] as Record<string, unknown>).op === 'string' ? ` (${(ops[i] as Record<string, unknown>).op})` : ''}`;
		if (!parsed.success) return { ok: false, error: `${where} is malformed:\n${formatZodError(parsed.error)}` };
		const op = parsed.data;
		const fail = (m: string): OpResult => ({ ok: false, error: `${where}: ${m}` });
		const findPart = (id: string) => s.parts.findIndex((p) => p.id === id);
		switch (op.op) {
			case 'add_part': {
				if (findPart(op.part.id) >= 0) return fail(`part "${op.part.id}" already exists — use update_part, or pick another id`);
				if (!op.after) s.parts.push(op.part);
				else if (op.after === 'start') s.parts.unshift(op.part);
				else {
					const j = findPart(op.after);
					if (j < 0) return fail(`no part "${op.after}" to insert after`);
					s.parts.splice(j + 1, 0, op.part);
				}
				changes.push(`+ part ${op.part.id}`);
				break;
			}
			case 'add_library_part': {
				const target = s.parts.find((p) => p.id === op.attach.to);
				if (!target) return fail(`no part "${op.attach.to}" to attach ${op.name} to`);
				let group: SceneT['parts'];
				try {
					group = expandLibraryPart(op.name, op.id, op.attach as never, { size: op.size, mirror: op.mirror, color: op.color });
				} catch (e) {
					return fail(e instanceof Error ? e.message : String(e));
				}
				for (const p of group) {
					if (findPart(p.id) >= 0) return fail(`part "${p.id}" already exists — pick another id for ${op.name}`);
					if (!p.material?.color && target.material?.color) p.material = { ...(p.material ?? {}), color: target.material.color };
				}
				const at = op.after ? findPart(op.after) : -1;
				if (op.after && at < 0) return fail(`no part "${op.after}" to insert after`);
				if (at >= 0) s.parts.splice(at + 1, 0, ...group);
				else s.parts.push(...group);
				changes.push(`+ ${op.name} as ${group.map((p) => p.id).join(', ')}`);
				break;
			}
			case 'update_part': {
				const j = findPart(op.id);
				if (j < 0) return fail(`no part "${op.id}" (parts: ${s.parts.map((p) => p.id).join(', ') || 'none'})`);
				if ('id' in op.set) return fail('use rename_part to change an id');
				s.parts[j] = merge(s.parts[j] as unknown as Record<string, unknown>, op.set) as unknown as SceneT['parts'][number];
				changes.push(`~ part ${op.id}`);
				break;
			}
			case 'remove_part': {
				const j = findPart(op.id);
				if (j < 0) return fail(`no part "${op.id}"`);
				const deps = dependents(s, op.id);
				if (deps.length && !op.cascade) return fail(`${deps.join(', ')} attach to "${op.id}" — pass cascade: true to remove them too, or re-attach them first`);
				const kill = new Set([op.id]);
				if (op.cascade) {
					let grew = true;
					while (grew) {
						grew = false;
						for (const p of s.parts) {
							const ref = p.attach?.to ?? p.parent;
							if (ref && kill.has(ref) && !kill.has(p.id)) {
								kill.add(p.id);
								grew = true;
							}
						}
					}
				}
				s.parts = s.parts.filter((p) => !kill.has(p.id));
				s.sculpts = (s.sculpts ?? []).filter((sc) => !((sc.at && 'to' in sc.at && kill.has(sc.at.to)) || (sc.to && 'to' in sc.to && kill.has(sc.to.to))));
				changes.push(`- part ${[...kill].join(', ')}`);
				break;
			}
			case 'rename_part': {
				const j = findPart(op.id);
				if (j < 0) return fail(`no part "${op.id}"`);
				if (findPart(op.to) >= 0) return fail(`"${op.to}" is taken`);
				s.parts[j].id = op.to;
				for (const p of s.parts) {
					if (p.attach?.to === op.id) p.attach.to = op.to;
					if (p.parent === op.id) p.parent = op.to;
				}
				for (const sc of s.sculpts ?? []) {
					if (sc.at && 'to' in sc.at && sc.at.to === op.id) sc.at.to = op.to;
					if (sc.to && 'to' in sc.to && sc.to.to === op.id) sc.to.to = op.to;
				}
				for (const c of s.clips ?? []) {
					if (c.target === op.id) c.target = op.to;
					for (const t of c.tracks ?? []) if (t.part.replace(/\.m$/, '') === op.id) t.part = t.part.endsWith('.m') ? `${op.to}.m` : op.to;
				}
				for (const e of s.effects ?? []) if (e.at && 'to' in e.at && e.at.to === op.id) e.at.to = op.to;
				changes.push(`~ rename ${op.id} → ${op.to}`);
				break;
			}
			case 'duplicate_part': {
				const j = findPart(op.id);
				if (j < 0) return fail(`no part "${op.id}"`);
				if (findPart(op.as) >= 0) return fail(`"${op.as}" is taken`);
				const copy = merge({ ...clone(s.parts[j]), id: op.as } as unknown as Record<string, unknown>, op.set ?? {});
				s.parts.splice(j + 1, 0, copy as unknown as SceneT['parts'][number]);
				changes.push(`+ part ${op.as} (copy of ${op.id})`);
				break;
			}
			case 'add_sculpt': {
				s.sculpts ??= [];
				if (s.sculpts.some((x) => x.id === op.sculpt.id)) return fail(`sculpt "${op.sculpt.id}" exists`);
				s.sculpts.push(op.sculpt);
				changes.push(`+ sculpt ${op.sculpt.id}`);
				break;
			}
			case 'update_sculpt':
			case 'update_clip':
			case 'update_effect': {
				const key = op.op === 'update_sculpt' ? 'sculpts' : op.op === 'update_clip' ? 'clips' : 'effects';
				const list = (s[key] ?? []) as unknown as Record<string, unknown>[];
				const j = list.findIndex((x) => x.id === op.id);
				if (j < 0) return fail(`no ${key.slice(0, -1)} "${op.id}"`);
				if ('id' in op.set) return fail('ids cannot be changed here');
				list[j] = merge(list[j], op.set);
				(s as unknown as Record<string, unknown>)[key] = list;
				changes.push(`~ ${key.slice(0, -1)} ${op.id}`);
				break;
			}
			case 'remove_sculpt':
			case 'remove_clip':
			case 'remove_effect': {
				const key = op.op === 'remove_sculpt' ? 'sculpts' : op.op === 'remove_clip' ? 'clips' : 'effects';
				const list = (s[key] ?? []) as unknown as { id: string }[];
				if (!list.some((x) => x.id === op.id)) return fail(`no ${key.slice(0, -1)} "${op.id}"`);
				(s as unknown as Record<string, unknown>)[key] = list.filter((x) => x.id !== op.id);
				changes.push(`- ${key.slice(0, -1)} ${op.id}`);
				break;
			}
			case 'add_clip': {
				s.clips ??= [];
				if (s.clips.some((x) => x.id === op.clip.id)) return fail(`clip "${op.clip.id}" exists`);
				s.clips.push(op.clip);
				changes.push(`+ clip ${op.clip.id}`);
				break;
			}
			case 'add_effect': {
				s.effects ??= [];
				if (s.effects.some((x) => x.id === op.effect.id)) return fail(`effect "${op.effect.id}" exists`);
				s.effects.push(op.effect);
				changes.push(`+ effect ${op.effect.id}`);
				break;
			}
			case 'set_settings': {
				s.settings = merge((s.settings ?? {}) as Record<string, unknown>, op.set as Record<string, unknown>) as SceneT['settings'];
				changes.push(`~ settings ${Object.keys(op.set).join(', ')}`);
				break;
			}
			case 'set_palette': {
				const pal: Record<string, string> = { ...(s.palette ?? {}) };
				for (const [k, v] of Object.entries(op.set)) {
					if (v === null) delete pal[k];
					else pal[k] = v;
				}
				s.palette = pal;
				changes.push(`~ palette ${Object.keys(op.set).join(', ')}`);
				break;
			}
			case 'set_meta': {
				if (op.name !== undefined) s.name = op.name;
				if (op.notes !== undefined) s.notes = op.notes;
				if (op.style === null) delete s.style;
				else if (op.style !== undefined) s.style = op.style;
				if (op.category === null) delete s.category;
				else if (op.category !== undefined) s.category = op.category;
				changes.push('~ meta');
				break;
			}
			case 'replace': {
				const r = Scene.safeParse(op.scene);
				if (!r.success) return fail(`scene is invalid:\n${formatZodError(r.error)}`);
				s = r.data;
				changes.push('~ whole scene replaced');
				break;
			}
		}
	}
	if (s.format !== FORMAT) s.format = FORMAT;
	const v = parseScene(s);
	if (!v.ok) return { ok: false, error: `the edited scene would be invalid:\n${v.error}` };
	return { ok: true, scene: v.scene, changes };
}
