/**
 * The Clayform scene document.
 *
 * This is the single source of truth an agent edits. It is deliberately
 * semantic: parts have ids and roles, they attach to each other by side
 * ("the horn sits on the head's top") instead of raw coordinates, sculpting is
 * anchored the same way, and animation is described as intent ("walk") rather
 * than keyframes. Everything else (meshing, rigging, baking) is derived.
 *
 * Conventions: meters, +Y up, the model faces +Z (front), the model's own
 * left is +X. Rotations are Euler degrees applied X, then Y, then Z.
 */

import { z } from 'zod';
import { migrate } from './migrate.js';
import { Style, loadStyle } from './style.js';

export const FORMAT = 'clayform/1';

const num = z.number().finite();
const pos = num.positive();
export const Vec3 = z.tuple([num, num, num]);
export type Vec3 = z.infer<typeof Vec3>;

export const Id = z
	.string()
	.regex(/^[a-z][a-z0-9_]{0,47}$/, 'ids are lowercase snake_case: start with a letter, then letters, digits or _ (max 48)');

export const Color = z
	.string()
	.regex(/^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|[a-z][a-z0-9_]{0,31})$/, 'use #rrggbb, #rgb or a palette key such as "skin"');

/* ------------------------------------------------------------------ shapes */

export const Shape = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('sphere'), radius: pos }),
	z.strictObject({ type: z.literal('ellipsoid'), radii: z.tuple([pos, pos, pos]) }),
	z.strictObject({
		type: z.literal('box'),
		size: z.tuple([pos, pos, pos]).describe('full width, height, depth'),
		rounding: num.min(0).optional().describe('edge radius in meters')
	}),
	z.strictObject({
		type: z.literal('capsule'),
		length: pos.describe('total length along local Y including both caps'),
		radius: pos
	}),
	z.strictObject({
		type: z.literal('cylinder'),
		height: pos.describe('along local Y'),
		radius: pos,
		rounding: num.min(0).optional(),
		sides: z.number().int().min(3).max(16).optional().describe('faceted: 6 = hexagonal prism (crystals, pencils, tiles); default round')
	}),
	z.strictObject({
		type: z.literal('cone'),
		height: pos.describe('along local Y, base at the bottom'),
		radius: pos.describe('base radius'),
		topRadius: num.min(0).optional().describe('0 = pointed (default)'),
		rounding: num.min(0).optional(),
		sides: z.number().int().min(3).max(16).optional().describe('faceted: 4 = pyramid, 6 = crystal point; default round')
	}),
	z.strictObject({
		type: z.literal('torus'),
		radius: pos.describe('ring radius, ring lies in the local XZ plane'),
		tube: pos
	}),
	z.strictObject({
		type: z.literal('prism'),
		size: z.tuple([pos, pos, pos]).describe('triangular cross-section in XY (peak on top), extruded along Z — roofs, blades'),
		rounding: num.min(0).optional()
	}),
	z.strictObject({
		type: z.literal('mesh'),
		src: z.string().min(1).max(500).describe('path to a .glb or .obj (absolute, or relative to where the server runs / the workspace)'),
		size: pos.optional().describe('scale so the longest axis is this many meters; default keeps the file\'s units'),
		resolution: z.number().int().min(16).max(160).optional().describe('distance grid cells on the longest axis (default 64)')
	}),
	z.strictObject({
		type: z.literal('tube'),
		points: z.array(Vec3).min(2).max(64).describe('local points of a smooth swept tube — tails, limbs, horns, tentacles'),
		radius: z.union([pos, z.array(pos).min(2).max(64)]).describe('one radius, or one per point for tapering')
	})
]);
export type Shape = z.infer<typeof Shape>;

/* ------------------------------------------------------------------ anchors */

export const SIDES = ['top', 'bottom', 'front', 'back', 'left', 'right', 'center'] as const;
export const Side = z.enum(SIDES);
export type Side = z.infer<typeof Side>;

export const Anchor = z.strictObject({
	to: Id.describe('id of the part to attach to'),
	side: Side.describe('world direction you look at the target from: top=+Y bottom=-Y front=+Z back=-Z left=+X (the model\'s left) right=-X; center = its center'),
	offset: z
		.tuple([num.min(-1).max(1), num.min(-1).max(1)])
		.optional()
		.describe('slide across that side, -1..1 of the target\'s half size in world axes (top/bottom: [x, z]; front/back: [x, y]; left/right: [z, y])'),
	embed: num.min(-1).max(1.5).optional().describe('how deep this part sinks in: 0 = just touching, 1 = its center sits on the surface, default 0.35, negative = gap'),
	align: z.boolean().optional().describe('rotate this part so its local +Y points along the surface normal (horns, legs, spikes)')
});
export type Anchor = z.infer<typeof Anchor>;

export const Point = z.strictObject({ point: Vec3.describe('world position') });
export const Target = z.union([Anchor, Point]);
export type Target = z.infer<typeof Target>;

/* ---------------------------------------------------------------- materials */

export const Material = z.strictObject({
	color: Color.optional().describe('#rrggbb, #rgb or a palette key; default a warm clay'),
	roughness: num.min(0).max(1).optional().describe('0 = mirror, 1 = matte (default 0.75)'),
	metalness: num.min(0).max(1).optional().describe('0 = dielectric (default), 1 = metal'),
	emissive: Color.optional().describe('glow color'),
	emissiveStrength: num.min(0).max(20).optional().describe('glow multiplier (default 1; >1 exports KHR_materials_emissive_strength)')
});
export type Material = z.infer<typeof Material>;

export const Pattern = z.strictObject({
	kind: z.enum(['spots', 'stripes', 'noise', 'gradient']).describe('spots (Worley cells), stripes, noise blotches, gradient along an axis'),
	color: Color.describe('the second color painted by the pattern'),
	scale: pos.optional().describe('feature size in meters (spots/stripes/noise); for gradient the height it fades over'),
	amount: num.min(0).max(1).optional().describe('0..1 how strongly the pattern color shows (default 1)'),
	axis: z.enum(['x', 'y', 'z', 'around']).optional().describe('stripes/gradient direction in the part\'s local axes; around = vertical staves around local Y. default y')
});

export const Detail = z.strictObject({
	amount: num.min(0).max(0.5).describe('surface displacement in meters (rock, bark, lumps)'),
	scale: pos.describe('feature size in meters')
});

export const PIVOTS = ['center', 'top', 'bottom', 'front', 'back', 'left', 'right', 'attach'] as const;

export const Part = z.strictObject({
	id: Id.describe('unique snake_case id; a mirror twin is id + ".m" (exported to glTF as id_mirror)'),
	role: z
		.string()
		.regex(/^[a-z][a-z0-9_]{0,31}$/)
		.optional()
		.describe('semantic role used by animation and critics: body, head, leg, arm, tail, wing, wheel, rotor, eye, ear, horn, prop …'),
	label: z.string().max(80).optional().describe('free text for people'),
	shape: Shape.describe('see Shapes'),
	position: Vec3.optional().describe('relative to parent; with attach it is an extra world offset'),
	rotation: Vec3.optional().describe('Euler degrees XYZ'),
	scale: z.union([pos, z.tuple([pos, pos, pos])]).optional().describe('uniform or per local axis; the easy way to stretch a template part'),
	parent: Id.optional().describe('position/rotation are relative to this part and follow its rotation (ignored when attach is set)'),
	attach: Anchor.optional().describe('place on another part\'s surface; the part keeps its own rotation (use align to point it along the surface normal)'),
	op: z.enum(['add', 'carve', 'intersect']).optional().describe('add (default) merges, carve cuts away, intersect keeps only the overlap'),
	blend: num.min(0).max(1).optional().describe('smooth merge radius in meters with everything before it; 0 = hard seam'),
	material: Material.optional().describe('see Material'),
	pattern: Pattern.optional().describe('see Pattern'),
	detail: Detail.optional().describe('see Detail'),
	mirror: z.boolean().optional().describe('add a mirrored twin across X (id + ".m")'),
	separate: z.boolean().optional().describe('mesh on its own instead of fusing into the body (wheels, props that spin, held items)'),
	pivot: z.union([z.enum(PIVOTS), Vec3]).optional().describe('joint location for animation; default: attach point, else top for legs/arms, else center'),
	hidden: z.boolean().optional().describe('not meshed; still usable as an anchor or joint')
});
export type Part = z.infer<typeof Part>;

/* -------------------------------------------------------------------- sculpt */

export const Sculpt = z.strictObject({
	id: Id.describe('unique sculpt id'),
	kind: z.enum(['inflate', 'dent', 'flatten', 'crease', 'noise']).describe('inflate/dent push out/in, flatten cuts a plane, crease cuts a groove from at to to, noise roughens'),
	at: Target.optional().describe('where; required except for a global noise'),
	to: Target.optional().describe('crease end point'),
	radius: pos.describe('area of influence in meters'),
	amount: num.min(0).max(1).describe('meters: push for inflate/dent/noise, groove depth for crease, how deep flatten cuts'),
	normal: Vec3.optional().describe('flatten plane normal; default: the surface normal at `at`'),
	scale: pos.optional().describe('noise feature size'),
	mirror: z.boolean().optional().describe('also apply at the mirrored position across X')
});
export type Sculpt = z.infer<typeof Sculpt>;

/* ----------------------------------------------------------------- animation */

export const CLIP_TYPES = ['idle', 'walk', 'run', 'hop', 'fly', 'swim', 'drive', 'spin', 'hover', 'wave', 'nod', 'attack', 'jump', 'sit', 'turn', 'die', 'blend', 'keyframes'] as const;

export const Key = z.strictObject({
	t: num.min(0).describe('seconds'),
	rotation: Vec3.optional().describe('degrees around the part\'s pivot, world axes'),
	offset: Vec3.optional().describe('meters, added to rest position')
});

export const Track = z.strictObject({ part: z.string().describe('part id (twins: "id.m")'), keys: z.array(Key).min(1).max(256).describe('keys sorted by t; eased in and out') });

export const Clip = z.strictObject({
	id: Id.describe('clip id, becomes the glTF animation name'),
	type: z.enum(CLIP_TYPES).describe('the motion intent; see Clip types'),
	speed: num.min(0.05).max(10).optional().describe('cycle speed multiplier'),
	amplitude: num.min(0).max(4).optional().describe('motion size multiplier'),
	duration: num.min(0.1).max(60).optional().describe('seconds; default one natural cycle'),
	target: Id.optional().describe('part to drive for wave/nod/spin/attack (default: auto)'),
	from: Id.optional().describe('blend: the clip to fade out of'),
	to: Id.optional().describe('blend: the clip to fade into; the blend ends where that clip starts, so play it next'),
	tracks: z.array(Track).max(128).optional().describe('keyframes (type "keyframes") or layered on top of a procedural clip'),
	fps: z.number().int().min(4).max(60).optional().describe('sample rate for export (default 30)'),
	secondary: z.boolean().optional().describe('springy follow-through on tails, ears and antennas, driven by how the body moves (default true)')
});
export type Clip = z.infer<typeof Clip>;

/* ------------------------------------------------------------------- effects */

export const EFFECT_PRESETS = ['fire', 'smoke', 'sparks', 'magic', 'explosion', 'dust', 'snow', 'rain', 'bubbles', 'heal'] as const;

const Range = z.tuple([num, num]);

export const Effect = z.strictObject({
	id: Id.describe('effect id'),
	preset: z.enum(EFFECT_PRESETS).optional().describe('starting parameters; every other field overrides it'),
	count: z.number().int().min(1).max(4000).optional().describe('particles alive at once (approx.)'),
	lifetime: Range.optional().describe('seconds [min, max]'),
	speed: Range.optional().describe('m/s [min, max]'),
	direction: Vec3.optional().describe('main emission direction (default up)'),
	spread: num.min(0).max(180).optional().describe('cone half-angle in degrees'),
	gravity: num.min(-50).max(50).optional().describe('m/s² along -Y (negative floats up)'),
	drag: num.min(0).max(10).optional().describe('linear drag, 1/s'),
	size: Range.optional().describe('particle size in meters [start, end]'),
	colors: z.array(Color).min(1).max(8).optional().describe('color over life'),
	alpha: Range.optional().describe('opacity [start, end]'),
	emitter: z
		.strictObject({ shape: z.enum(['point', 'sphere', 'disc', 'box']), size: num.min(0).optional() })
		.optional()
		.describe('where particles are born: point, sphere, disc (flat, XZ) or box, with a size in meters'),
	blend: z.enum(['additive', 'alpha']).optional().describe('additive for glowing effects, alpha for smoke and dust'),
	burst: z.boolean().optional().describe('emit everything at t=0 instead of continuously'),
	duration: num.min(0.1).max(10).optional().describe('seconds baked'),
	frames: z.number().int().min(1).max(64).optional().describe('flipbook frames (default 16)'),
	tile: z.number().int().min(32).max(512).optional().describe('flipbook tile size in px'),
	seed: z.number().int().optional().describe('change for a different but repeatable variation'),
	at: Target.optional().describe('where it sits on the model (preview only)')
});
export type Effect = z.infer<typeof Effect>;

/* --------------------------------------------------------------------- scene */

export const Settings = z.strictObject({
	resolution: z.number().int().min(16).max(256).optional().describe('cells along the longest axis (detail vs. triangles), default 96'),
	ground: z.enum(['auto', 'none']).optional().describe('auto lifts/drops the model so it stands on y=0 (default)'),
	symmetry: z.enum(['x', 'none']).optional().describe('declare mirror symmetry so critics check it'),
	budget: z.number().int().min(100).max(2_000_000).optional().describe('triangle budget for critics'),
	screenHeight: z.number().int().min(16).max(2048).optional().describe('how tall the model appears in the game, in pixels; critics flag details a player cannot see at that size'),
	ao: z.boolean().optional().describe('compute ambient occlusion into vertex shading (default true)'),
	edges: z.enum(['soft', 'sharp']).optional().describe('soft (default) rounds edges to the cell size, good for organic shapes; sharp keeps real corners and edges (crates, blades, buildings, robots)'),
	rig: z.enum(['auto', 'none']).optional().describe('auto: skeleton from parts when clips exist')
});
export type Settings = z.infer<typeof Settings>;

export const Scene = z.strictObject({
	format: z.literal(FORMAT).describe('document version'),
	name: z.string().min(1).max(80).describe('display name; also the glTF scene name'),
	notes: z.string().max(2000).optional().describe('free text: intent, constraints, what to keep'),
	palette: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'palette names are lowercase snake_case, like skin or wood_dark'), z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'palette colors are #rrggbb or #rgb')).optional().describe('named colors parts refer to — recolor a model by editing one entry'),
	style: z.union([z.string().min(1).max(500), Style]).optional().describe('a style sheet (path to a .style.json, or inline) shared across a pack: palette, material defaults, settings, height ranges'),
	category: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).optional().describe('what this is in the pack (character, prop, building …); the style checks its height'),
	settings: Settings.optional().describe('see Settings'),
	parts: z.array(Part).max(256).describe('in blend order: blend and carve act on the parts listed before them'),
	sculpts: z.array(Sculpt).max(128).optional().describe('applied in order after all parts'),
	clips: z.array(Clip).max(32).optional().describe('animations; the rig is built automatically'),
	effects: z.array(Effect).max(16).optional().describe('particle effects baked to flipbooks')
});
export type Scene = z.infer<typeof Scene>;

/* ---------------------------------------------------------------- integrity */

export interface Problem {
	path: string;
	message: string;
}

/**
 * Cross-reference checks zod cannot express: unique ids, references that
 * exist, no parent/attach cycles, palette keys that resolve.
 */
export function integrity(s: Scene): Problem[] {
	const out: Problem[] = [];
	const ids = new Set<string>();
	s.parts.forEach((p, i) => {
		if (ids.has(p.id)) out.push({ path: `parts[${i}].id`, message: `duplicate part id "${p.id}"` });
		ids.add(p.id);
	});
	let stylePalette: Record<string, string> = {};
	if (s.style) {
		try {
			stylePalette = loadStyle(s.style).palette ?? {};
		} catch (e) {
			out.push({ path: 'style', message: e instanceof Error ? e.message : String(e) });
		}
	}
	const colorOk = (c: string | undefined) => !c || c.startsWith('#') || (s.palette && c in s.palette) || c in stylePalette;
	s.parts.forEach((p, i) => {
		const ref = p.attach?.to ?? p.parent;
		if (ref && !ids.has(ref)) out.push({ path: `parts[${i}]`, message: `"${p.id}" refers to unknown part "${ref}"` });
		if (ref === p.id) out.push({ path: `parts[${i}]`, message: `"${p.id}" cannot attach to itself` });
		for (const c of [p.material?.color, p.material?.emissive, p.pattern?.color])
			if (!colorOk(c)) out.push({ path: `parts[${i}].material`, message: `palette has no color "${c}" — add it to palette or use #rrggbb` });
		if (p.shape.type === 'tube' && Array.isArray(p.shape.radius) && p.shape.radius.length !== p.shape.points.length)
			out.push({ path: `parts[${i}].shape.radius`, message: `tube has ${p.shape.points.length} points but ${p.shape.radius.length} radii` });
		if (p.shape.type === 'capsule' && p.shape.length < p.shape.radius * 2)
			out.push({ path: `parts[${i}].shape.length`, message: `capsule length must be at least 2 × radius (${(p.shape.radius * 2).toFixed(3)})` });
	});
	// cycles
	const byId = new Map(s.parts.map((p) => [p.id, p]));
	for (const p of s.parts) {
		const seen = new Set<string>();
		let cur: Part | undefined = p;
		while (cur) {
			if (seen.has(cur.id)) {
				out.push({ path: 'parts', message: `attach/parent cycle through "${p.id}"` });
				break;
			}
			seen.add(cur.id);
			const next: string | undefined = cur.attach?.to ?? cur.parent;
			cur = next ? byId.get(next) : undefined;
		}
	}
	const refTarget = (t: Target | undefined, path: string) => {
		if (t && 'to' in t && !ids.has(t.to)) out.push({ path, message: `unknown part "${t.to}"` });
	};
	const sids = new Set<string>();
	(s.sculpts ?? []).forEach((sc, i) => {
		if (sids.has(sc.id)) out.push({ path: `sculpts[${i}].id`, message: `duplicate sculpt id "${sc.id}"` });
		sids.add(sc.id);
		refTarget(sc.at, `sculpts[${i}].at`);
		refTarget(sc.to, `sculpts[${i}].to`);
		if (!sc.at && sc.kind !== 'noise') out.push({ path: `sculpts[${i}].at`, message: `${sc.kind} needs "at"` });
		if (sc.kind === 'crease' && !sc.to) out.push({ path: `sculpts[${i}].to`, message: 'crease needs "to" (end point)' });
	});
	const cids = new Set<string>();
	(s.clips ?? []).forEach((c, i) => {
		if (cids.has(c.id)) out.push({ path: `clips[${i}].id`, message: `duplicate clip id "${c.id}"` });
		cids.add(c.id);
		if (c.target && !ids.has(c.target)) out.push({ path: `clips[${i}].target`, message: `unknown part "${c.target}"` });
		c.tracks?.forEach((t, j) => {
			if (!ids.has(t.part.replace(/\.m$/, ''))) out.push({ path: `clips[${i}].tracks[${j}]`, message: `unknown part "${t.part}"` });
		});
		if (c.type === 'keyframes' && !c.tracks?.length) out.push({ path: `clips[${i}]`, message: 'keyframes clip needs tracks' });
		if (c.type === 'blend') {
			for (const k of ['from', 'to'] as const) {
				const ref = c[k];
				const other = (s.clips ?? []).find((x) => x.id === ref);
				if (!ref) out.push({ path: `clips[${i}].${k}`, message: `blend needs "${k}" — the id of another clip` });
				else if (!other) out.push({ path: `clips[${i}].${k}`, message: `no clip "${ref}" to blend ${k}` });
				else if (other.type === 'blend') out.push({ path: `clips[${i}].${k}`, message: `"${ref}" is itself a blend — blend between two ordinary clips` });
			}
		}
	});
	const eids = new Set<string>();
	(s.effects ?? []).forEach((e, i) => {
		if (eids.has(e.id)) out.push({ path: `effects[${i}].id`, message: `duplicate effect id "${e.id}"` });
		eids.add(e.id);
		refTarget(e.at, `effects[${i}].at`);
		e.colors?.forEach((c) => {
			if (!colorOk(c)) out.push({ path: `effects[${i}].colors`, message: `palette has no color "${c}"` });
		});
	});
	return out;
}

export function formatZodError(err: z.ZodError): string {
	return err.issues
		.slice(0, 12)
		.map((i) => `• ${i.path.join('.') || '(root)'}: ${i.message}`)
		.join('\n');
}

/** `migrated` lists the upgrades applied when the document was written in an older format. */
export type ParseResult = { ok: true; scene: Scene; migrated?: string[] } | { ok: false; error: string };

export function parseScene(input: unknown): ParseResult {
	const m = migrate(input, FORMAT);
	if (!m.ok) return { ok: false, error: m.error };
	const r = Scene.safeParse(m.doc);
	if (!r.success) return { ok: false, error: formatZodError(r.error) };
	const probs = integrity(r.data);
	if (probs.length) return { ok: false, error: probs.map((p) => `• ${p.path}: ${p.message}`).join('\n') };
	return m.steps.length ? { ok: true, scene: r.data, migrated: m.steps } : { ok: true, scene: r.data };
}

export function emptyScene(name: string): Scene {
	return { format: FORMAT, name, settings: {}, parts: [], sculpts: [], clips: [], effects: [] };
}
