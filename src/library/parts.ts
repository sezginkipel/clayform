/**
 * Reusable parts. A library part is a small group of parts with one root:
 * the root is placed with the anchor you give, the rest hang off it. Sizes
 * suit a ~1 m character; `size` scales the whole group.
 */

import type { Anchor, Part } from '../core/schema.js';

export interface LibraryPart {
	name: string;
	tags: string[];
	description: string;
	/** a good default anchor side on a body or head */
	side: Anchor['side'];
	/** true when it usually comes in pairs (eyes, ears, wings) */
	pair: boolean;
	/** parts; the first is the root. Ids are suffixes; "" is the root itself. */
	parts: (Omit<Part, 'id' | 'attach' | 'parent'> & { id: string; attach?: Omit<Anchor, 'to'> & { to: string }; parent?: string })[];
	/** where a pair sits when no offset is given (so the mirror twin does not land on top of it) */
	pairOffset?: [number, number];
}

const P = (lp: LibraryPart) => lp;

export const LIBRARY: LibraryPart[] = [
	P({
		name: 'eye_cartoon', tags: ['eye', 'face', 'character', 'cartoon'], side: 'front', pair: true, pairOffset: [0.38, 0.15],
		description: 'Big cartoon eye: white, dark pupil and a highlight.',
		parts: [
			{ id: '', role: 'eye', shape: { type: 'sphere', radius: 0.045 }, material: { color: '#fbfbf8', roughness: 0.25 } },
			{ id: 'pupil', shape: { type: 'sphere', radius: 0.024 }, attach: { to: '', side: 'front', embed: 0.55 }, material: { color: '#1b1a1f', roughness: 0.15 } },
			{ id: 'shine', shape: { type: 'sphere', radius: 0.012 }, attach: { to: 'pupil', side: 'front', offset: [0.4, 0.4], embed: 0.4 }, material: { color: '#ffffff', emissive: '#ffffff', emissiveStrength: 0.4 } }
		]
	}),
	P({
		name: 'eye_dot', tags: ['eye', 'face', 'simple'], side: 'front', pair: true, pairOffset: [0.36, 0.15],
		description: 'Small glossy dot eye, for stylized animals and toys.',
		parts: [{ id: '', role: 'eye', shape: { type: 'ellipsoid', radii: [0.022, 0.03, 0.016] }, material: { color: '#1b1a1f', roughness: 0.15 } }]
	}),
	P({
		name: 'eye_glow', tags: ['eye', 'robot', 'sci-fi', 'monster'], side: 'front', pair: true, pairOffset: [0.4, 0.15],
		description: 'Glowing lens eye in a dark socket.',
		parts: [
			{ id: '', role: 'eye', shape: { type: 'cylinder', height: 0.03, radius: 0.035, rounding: 0.01 }, rotation: [90, 0, 0], material: { color: '#26282e', metalness: 0.5, roughness: 0.4 } },
			{ id: 'lens', shape: { type: 'sphere', radius: 0.022 }, attach: { to: '', side: 'front', embed: 0.6 }, material: { color: '#5ff0c8', emissive: '#5ff0c8', emissiveStrength: 2.5 } }
		]
	}),
	P({
		name: 'brow', tags: ['face', 'expression', 'character'], side: 'front', pair: true, pairOffset: [0.38, 0.45],
		description: 'A short eyebrow capsule; tilt it with rotation for anger or worry.',
		parts: [{ id: '', shape: { type: 'capsule', length: 0.07, radius: 0.009 }, rotation: [0, 0, 80], material: { color: '#3a2a20' } }]
	}),
	P({
		name: 'nose_round', tags: ['nose', 'face', 'character'], side: 'front', pair: false,
		description: 'Soft round nose that blends into the face.',
		parts: [{ id: '', shape: { type: 'ellipsoid', radii: [0.03, 0.026, 0.028] }, blend: 0.015 }]
	}),
	P({
		name: 'nose_pointy', tags: ['nose', 'face', 'goblin', 'witch'], side: 'front', pair: false,
		description: 'Long pointed nose along the surface normal.',
		parts: [{ id: '', shape: { type: 'cone', height: 0.1, radius: 0.028 }, attach: { to: '', side: 'front', align: true, embed: 0.15 }, blend: 0.01 }]
	}),
	P({
		name: 'snout', tags: ['nose', 'animal', 'face', 'dog', 'pig'], side: 'front', pair: false,
		description: 'Animal snout with a dark nose tip.',
		parts: [
			{ id: '', shape: { type: 'ellipsoid', radii: [0.06, 0.05, 0.07] }, blend: 0.03, material: { color: '#f1dcc0' } },
			{ id: 'tip', shape: { type: 'sphere', radius: 0.022 }, attach: { to: '', side: 'front', offset: [0, 0.3], embed: 0.4 }, material: { color: '#2a2224', roughness: 0.3 } }
		]
	}),
	P({
		name: 'mouth_open', tags: ['mouth', 'face', 'expression'], side: 'front', pair: false,
		description: 'An open mouth carved into the surface, dark inside.',
		parts: [{ id: '', shape: { type: 'ellipsoid', radii: [0.05, 0.022, 0.04] }, op: 'carve', blend: 0.01, attach: { to: '', side: 'front', embed: 0.7 }, material: { color: '#3b1f2b' } }]
	}),
	P({
		name: 'ear_pointy', tags: ['ear', 'elf', 'goblin', 'cat', 'fox'], side: 'left', pair: true,
		description: 'Tall pointed ear angled outward.',
		parts: [{ id: '', role: 'ear', shape: { type: 'cone', height: 0.15, radius: 0.04 }, rotation: [0, 0, -25], blend: 0.02, attach: { to: '', side: 'left', align: true, embed: 0.2 } }]
	}),
	P({
		name: 'ear_round', tags: ['ear', 'bear', 'mouse', 'monkey'], side: 'top', pair: true, pairOffset: [0.6, 0],
		description: 'Round flat ear, like a bear or a mouse.',
		parts: [{ id: '', role: 'ear', shape: { type: 'cylinder', height: 0.025, radius: 0.05, rounding: 0.01 }, rotation: [90, 0, 0], blend: 0.015 }]
	}),
	P({
		name: 'ear_floppy', tags: ['ear', 'dog', 'rabbit'], side: 'left', pair: true,
		description: 'Long floppy ear hanging down the side of the head.',
		parts: [{ id: '', role: 'ear', shape: { type: 'tube', points: [[0, 0, 0], [0.03, -0.06, 0], [0.04, -0.14, 0.01]], radius: [0.03, 0.035, 0.03] }, blend: 0.02 }]
	}),
	P({
		name: 'horn_curved', tags: ['horn', 'demon', 'ram', 'monster'], side: 'top', pair: true, pairOffset: [0.45, 0],
		description: 'Curved horn that tapers to a point.',
		parts: [{ id: '', shape: { type: 'tube', points: [[0, 0, 0], [0.03, 0.07, -0.02], [0.08, 0.1, -0.06], [0.1, 0.07, -0.1]], radius: [0.035, 0.028, 0.018, 0.006] }, material: { color: '#e8dcc0', roughness: 0.5 } }]
	}),
	P({
		name: 'horn_straight', tags: ['horn', 'unicorn', 'rhino'], side: 'top', pair: false,
		description: 'Straight spiral-free horn along the surface normal.',
		parts: [{ id: '', shape: { type: 'cone', height: 0.18, radius: 0.03, sides: 8 }, attach: { to: '', side: 'top', align: true, embed: 0.15 }, material: { color: '#f2e6c8', roughness: 0.4 } }]
	}),
	P({
		name: 'antenna', tags: ['robot', 'insect', 'sci-fi'], side: 'top', pair: false,
		description: 'Thin antenna with a glowing ball on top.',
		parts: [
			{ id: '', shape: { type: 'cylinder', height: 0.14, radius: 0.012 }, material: { color: '#3a3e46', metalness: 0.6 } },
			{ id: 'tip', shape: { type: 'sphere', radius: 0.026 }, attach: { to: '', side: 'top', embed: 0.3 }, material: { color: '#f0a33a', emissive: '#f0a33a', emissiveStrength: 1.5 } }
		]
	}),
	P({
		name: 'tail_fluffy', tags: ['tail', 'fox', 'squirrel', 'animal'], side: 'back', pair: false,
		description: 'Thick fluffy tail curving up.',
		parts: [{ id: '', role: 'tail', shape: { type: 'tube', points: [[0, 0, 0], [0, 0.08, -0.12], [0, 0.22, -0.18], [0, 0.32, -0.12]], radius: [0.04, 0.07, 0.08, 0.05] }, blend: 0.03 }]
	}),
	P({
		name: 'tail_thin', tags: ['tail', 'cat', 'rat', 'devil'], side: 'back', pair: false,
		description: 'Long thin tail with a gentle S curve.',
		parts: [{ id: '', role: 'tail', shape: { type: 'tube', points: [[0, 0, 0], [0, 0.05, -0.12], [0, 0.18, -0.2], [0, 0.3, -0.18]], radius: [0.025, 0.02, 0.016, 0.012] }, blend: 0.02 }]
	}),
	P({
		name: 'wing_feather', tags: ['wing', 'bird', 'angel'], side: 'left', pair: true,
		description: 'Folded feathered wing lying against the body.',
		parts: [{ id: '', role: 'wing', shape: { type: 'ellipsoid', radii: [0.025, 0.09, 0.13] }, rotation: [-15, 0, -8], pivot: 'attach', blend: 0.02, attach: { to: '', side: 'left', embed: 0.7 } }]
	}),
	P({
		name: 'wing_bat', tags: ['wing', 'bat', 'dragon', 'demon'], side: 'back', pair: true, pairOffset: [0.4, 0.3],
		description: 'Spread membrane wing, a flat triangle angled out and back.',
		parts: [{ id: '', role: 'wing', shape: { type: 'prism', size: [0.34, 0.26, 0.02], rounding: 0.006 }, rotation: [0, -40, -60], pivot: 'attach', attach: { to: '', side: 'back', offset: [0.4, 0.3], embed: 0.4 } }]
	}),
	P({
		name: 'arm_simple', tags: ['arm', 'character', 'limb'], side: 'left', pair: true,
		description: 'Hanging arm with a round hand.',
		parts: [
			{ id: '', role: 'arm', shape: { type: 'capsule', length: 0.34, radius: 0.05 }, position: [0.06, -0.12, 0], rotation: [0, 0, 16], pivot: 'top', blend: 0.03, attach: { to: '', side: 'left', embed: 0.75 } },
			{ id: 'hand', shape: { type: 'sphere', radius: 0.055 }, attach: { to: '', side: 'bottom', embed: 0.55 }, blend: 0.02 }
		]
	}),
	P({
		name: 'leg_simple', tags: ['leg', 'character', 'animal', 'limb'], side: 'bottom', pair: true, pairOffset: [0.5, 0],
		description: 'Leg with a foot pointing forward.',
		parts: [
			{ id: '', role: 'leg', shape: { type: 'capsule', length: 0.32, radius: 0.065 }, blend: 0.03, attach: { to: '', side: 'bottom', embed: 0.6 } },
			{ id: 'foot', shape: { type: 'ellipsoid', radii: [0.065, 0.04, 0.1] }, attach: { to: '', side: 'bottom', embed: 0.55 }, position: [0, 0, 0.03], blend: 0.02 }
		]
	}),
	P({
		name: 'wheel', tags: ['wheel', 'vehicle', 'car', 'cart'], side: 'left', pair: true,
		description: 'Rolling wheel with a hubcap, meshed on its own so it can spin.',
		parts: [
			{ id: '', role: 'wheel', shape: { type: 'cylinder', height: 0.1, radius: 0.13, rounding: 0.035 }, rotation: [0, 0, 90], separate: true, material: { color: '#26272b', roughness: 0.9 } },
			{ id: 'hub', shape: { type: 'cylinder', height: 0.02, radius: 0.06, rounding: 0.006 }, attach: { to: '', side: 'left', embed: 0.5 }, rotation: [0, 0, 90], separate: true, material: { color: '#d9d9de', metalness: 0.9, roughness: 0.3 } }
		]
	}),
	P({
		name: 'window', tags: ['window', 'building', 'house', 'vehicle'], side: 'front', pair: false,
		description: 'A recessed window: glass carved into the wall with a sill below.',
		parts: [
			{ id: '', shape: { type: 'box', size: [0.34, 0.3, 0.2], rounding: 0.02 }, op: 'carve', attach: { to: '', side: 'front', embed: 0.8 }, material: { color: '#8ec6dd', roughness: 0.15 } },
			{ id: 'sill', shape: { type: 'box', size: [0.42, 0.04, 0.08], rounding: 0.01 }, parent: '', position: [0, -0.17, -0.02], material: { color: '#8f8a84' } }
		]
	}),
	P({
		name: 'door', tags: ['door', 'building', 'house'], side: 'front', pair: false,
		description: 'A recessed wooden door with a round handle.',
		parts: [
			{ id: '', shape: { type: 'box', size: [0.44, 0.8, 0.2], rounding: 0.04 }, op: 'carve', attach: { to: '', side: 'front', embed: 0.8 }, material: { color: '#7a4d30' } },
			{ id: 'knob', shape: { type: 'sphere', radius: 0.025 }, parent: '', position: [0.14, -0.02, -0.085], material: { color: '#d9a441', metalness: 1, roughness: 0.3 } }
		]
	}),
	P({
		name: 'handle', tags: ['handle', 'prop', 'door', 'mug', 'bag'], side: 'left', pair: false,
		description: 'A half-ring handle standing off a surface.',
		parts: [{ id: '', shape: { type: 'torus', radius: 0.06, tube: 0.014 }, rotation: [90, 0, 0], attach: { to: '', side: 'left', embed: 0.5 }, material: { color: '#5c5e63', metalness: 0.8, roughness: 0.4 } }]
	}),
	P({
		name: 'hat_cone', tags: ['hat', 'wizard', 'witch', 'party'], side: 'top', pair: false,
		description: 'Tall cone hat with a brim.',
		parts: [
			{ id: '', shape: { type: 'cylinder', height: 0.025, radius: 0.2, rounding: 0.01 }, attach: { to: '', side: 'top', embed: 0.6 }, material: { color: '#3b2f6b' } },
			{ id: 'cone', shape: { type: 'cone', height: 0.32, radius: 0.13, rounding: 0.01 }, attach: { to: '', side: 'top', embed: 0.1 }, blend: 0.01, material: { color: '#3b2f6b' } }
		]
	}),
	P({
		name: 'helmet', tags: ['hat', 'knight', 'armor', 'soldier'], side: 'top', pair: false,
		description: 'Round metal helmet with a visor slit.',
		parts: [
			{ id: '', shape: { type: 'ellipsoid', radii: [0.22, 0.17, 0.22] }, attach: { to: '', side: 'top', embed: 0.95 }, material: { color: '#b8bec8', metalness: 0.9, roughness: 0.3 } },
			{ id: 'slit', shape: { type: 'box', size: [0.2, 0.025, 0.1], rounding: 0.01 }, attach: { to: '', side: 'front', offset: [0, -0.35], embed: 0.8 }, op: 'carve', material: { color: '#1b1a1f' } }
		]
	}),
	P({
		name: 'backpack', tags: ['backpack', 'bag', 'adventurer', 'character'], side: 'back', pair: false,
		description: 'A rounded backpack with a flap.',
		parts: [
			{ id: '', shape: { type: 'box', size: [0.26, 0.3, 0.14], rounding: 0.05 }, attach: { to: '', side: 'back', embed: 0.3 }, material: { color: '#8a5a34', roughness: 0.85 } },
			{ id: 'flap', shape: { type: 'box', size: [0.27, 0.12, 0.15], rounding: 0.05 }, attach: { to: '', side: 'top', embed: 0.7 }, position: [0, 0, 0.005], material: { color: '#6e4527', roughness: 0.85 } }
		]
	}),
	P({
		name: 'spike', tags: ['spike', 'monster', 'dragon', 'armor'], side: 'top', pair: false,
		description: 'A single spike along the surface normal; add several along a back.',
		parts: [{ id: '', shape: { type: 'cone', height: 0.1, radius: 0.03, sides: 6 }, attach: { to: '', side: 'top', align: true, embed: 0.2 }, blend: 0.005, material: { color: '#e8dcc0' } }]
	})
];

export function findLibraryParts(query?: string): LibraryPart[] {
	if (!query) return LIBRARY;
	const q = query.toLowerCase();
	return LIBRARY.filter((p) => p.name.includes(q) || p.tags.some((t) => t.includes(q)) || p.description.toLowerCase().includes(q));
}

/**
 * Expand a library part into scene parts. The root gets `id`, the others
 * `id_<suffix>`; the root is placed with `attach` (its own default attach
 * fields fill the gaps), and `size` scales every part's shape.
 */
export function expandLibraryPart(name: string, id: string, attach: Anchor, opts: { size?: number; mirror?: boolean; color?: string } = {}): Part[] {
	const lp = LIBRARY.find((p) => p.name === name);
	if (!lp) throw new Error(`no library part "${name}" — call list_parts`);
	const k = opts.size ?? 1;
	const pid = (suffix: string) => (suffix ? `${id}_${suffix}` : id);
	return lp.parts.map((raw, i) => {
		const { id: suffix, attach: a, parent: par, ...rest } = raw;
		const part: Part = { ...(JSON.parse(JSON.stringify(rest)) as Omit<Part, 'id'>), id: pid(suffix) } as Part;
		if (k !== 1) {
			const s = part.scale;
			part.scale = typeof s === 'number' ? s * k : Array.isArray(s) ? (s.map((v) => v * k) as [number, number, number]) : k;
			if (part.position) part.position = part.position.map((v) => v * k) as [number, number, number];
		}
		if (i === 0) {
			// the root's own placement hints (align, embed, side) apply unless the caller sets them
			const hint = a && a.to === '' ? a : undefined;
			part.attach = { ...(hint ? { side: hint.side, embed: hint.embed, align: hint.align, offset: hint.offset } : {}), ...stripUndefined(attach) } as Anchor;
			if (!part.attach.side) part.attach.side = lp.side;
			for (const key of ['embed', 'align', 'offset'] as const) if (part.attach[key] === undefined) delete part.attach[key];
			if (opts.mirror !== undefined) part.mirror = opts.mirror;
			else if (lp.pair) part.mirror = true;
			if (opts.color) part.material = { ...(part.material ?? {}), color: opts.color };
			if (!part.attach.offset && part.mirror && lp.pairOffset) part.attach.offset = lp.pairOffset;
		} else if (a) {
			part.attach = { ...a, to: pid(a.to) } as Anchor;
		} else if (par !== undefined) {
			part.parent = pid(par);
		}
		return part;
	});
}

function stripUndefined<T extends object>(o: T): Partial<T> {
	return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
