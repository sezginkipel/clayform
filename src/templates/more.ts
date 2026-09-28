/**
 * The second batch of templates. Some are written with library parts (eyes,
 * ears, wheels …) through the same edit ops an agent uses, so they double as
 * examples of building from the library.
 */

import { applyOps } from '../core/ops.js';
import { FORMAT, type Scene } from '../core/schema.js';

const S = (name: string, rest: Omit<Scene, 'format' | 'name'>): Scene => ({ format: FORMAT, name, ...rest });

/** A scene plus library parts, expanded now so the template is plain JSON. */
function withLibrary(base: Scene, ops: unknown[]): Scene {
	const r = applyOps(base, ops);
	if (!r.ok) throw new Error(`template ${base.name}: ${r.error}`);
	return r.scene;
}

export const knight = S('Knight', {
	notes: 'Small armored knight ~1.1 m holding a sword. Metal via palette; the sword is separate.',
	palette: { steel: '#b8bec8', steel_dark: '#7d8490', cloth: '#b83a33', leather: '#6b3f26', gold: '#d9a441', eye: '#1f1d22' },
	settings: { resolution: 120, symmetry: 'x' },
	parts: [
		{ id: 'body', role: 'body', shape: { type: 'ellipsoid', radii: [0.2, 0.25, 0.16] }, position: [0, 0.62, 0], material: { color: 'steel', metalness: 0.85, roughness: 0.35 } },
		{ id: 'belt', shape: { type: 'torus', radius: 0.17, tube: 0.025 }, attach: { to: 'body', side: 'center', embed: 1 }, position: [0, -0.02, 0], material: { color: 'leather' } },
		{ id: 'tabard', shape: { type: 'box', size: [0.2, 0.3, 0.05], rounding: 0.02 }, attach: { to: 'body', side: 'front', embed: 0.6 }, material: { color: 'cloth' } },
		{ id: 'head', role: 'head', shape: { type: 'sphere', radius: 0.19 }, attach: { to: 'body', side: 'top', embed: 0.18 }, blend: 0.04, material: { color: 'steel', metalness: 0.85, roughness: 0.3 } },
		{ id: 'visor', shape: { type: 'box', size: [0.24, 0.035, 0.1], rounding: 0.012 }, attach: { to: 'head', side: 'front', offset: [0, 0.05], embed: 0.8 }, op: 'carve', material: { color: 'eye' } },
		{ id: 'plume', shape: { type: 'tube', points: [[0, 0, 0], [0, 0.08, -0.05], [0, 0.1, -0.16]], radius: [0.03, 0.035, 0.02] }, attach: { to: 'head', side: 'top', embed: 0.4 }, material: { color: 'cloth' } },
		{ id: 'arm', role: 'arm', shape: { type: 'capsule', length: 0.34, radius: 0.055 }, attach: { to: 'body', side: 'left', offset: [0, 0.42], embed: 0.75 }, position: [0.07, -0.12, 0], rotation: [0, 0, 16], pivot: 'top', blend: 0.03, mirror: true, material: { color: 'steel', metalness: 0.85, roughness: 0.35 } },
		{ id: 'hand', shape: { type: 'sphere', radius: 0.058 }, attach: { to: 'arm', side: 'bottom', embed: 0.55 }, blend: 0.02, material: { color: 'steel_dark', metalness: 0.8, roughness: 0.4 } },
		{ id: 'leg', role: 'leg', shape: { type: 'capsule', length: 0.34, radius: 0.07 }, attach: { to: 'body', side: 'bottom', offset: [0.48, 0], embed: 0.62 }, blend: 0.03, mirror: true, material: { color: 'steel_dark', metalness: 0.8, roughness: 0.4 } },
		{ id: 'boot', shape: { type: 'ellipsoid', radii: [0.07, 0.05, 0.11] }, attach: { to: 'leg', side: 'bottom', embed: 0.55 }, position: [0, 0, 0.035], blend: 0.02, material: { color: 'steel', metalness: 0.85, roughness: 0.35 } },
		{ id: 'blade', shape: { type: 'box', size: [0.05, 0.38, 0.012], rounding: 0.004 }, parent: 'hand', position: [0, -0.09, 0], separate: true, material: { color: 'steel', metalness: 1, roughness: 0.2 } },
		{ id: 'guard', shape: { type: 'box', size: [0.04, 0.03, 0.17], rounding: 0.012 }, attach: { to: 'blade', side: 'top', embed: 0.5 }, separate: true, material: { color: 'gold', metalness: 1, roughness: 0.3 } }
	],
	clips: [{ id: 'walk', type: 'walk' }, { id: 'idle', type: 'idle' }]
});

export const wizard = withLibrary(
	S('Wizard', {
		notes: 'Robed wizard ~1.3 m with a long beard and a tall hat. Recolor the robe via palette.',
		palette: { robe: '#3b4f9e', robe_dark: '#2b3a78', skin: '#f0c4a0', beard: '#e8e6e0', hat: '#3b2f6b', staff: '#6b4a2b', gem: '#7fe3ff' },
		settings: { resolution: 120, symmetry: 'x' },
		parts: [
			{ id: 'robe', role: 'body', shape: { type: 'cone', height: 0.8, radius: 0.32, topRadius: 0.13, rounding: 0.04 }, position: [0, 0.4, 0], material: { color: 'robe', roughness: 0.85 }, pattern: { kind: 'gradient', color: 'robe_dark', scale: 0.8, amount: 0.6 } },
			{ id: 'head', role: 'head', shape: { type: 'sphere', radius: 0.15 }, attach: { to: 'robe', side: 'top', embed: 0.2 }, blend: 0.03, material: { color: 'skin' } },
			{ id: 'beard', shape: { type: 'cone', height: 0.15, radius: 0.09, rounding: 0.03 }, attach: { to: 'head', side: 'front', offset: [0, -0.4], embed: 0.8 }, rotation: [180, 0, 0], position: [0, -0.02, 0], blend: 0.02, material: { color: 'beard', roughness: 0.95 } },
			{ id: 'sleeve', role: 'arm', shape: { type: 'capsule', length: 0.32, radius: 0.06 }, attach: { to: 'robe', side: 'left', offset: [0, 0.75], embed: 0.8 }, rotation: [0, 0, 32], position: [0.09, -0.1, 0], pivot: 'top', blend: 0.03, mirror: true, material: { color: 'robe', roughness: 0.85 } },
			{ id: 'hand', shape: { type: 'sphere', radius: 0.045 }, attach: { to: 'sleeve', side: 'bottom', embed: 0.3 }, blend: 0.01, material: { color: 'skin' } },
			{ id: 'staff', shape: { type: 'cylinder', height: 1.25, radius: 0.02, rounding: 0.01 }, parent: 'hand', position: [0.005, 0.205, 0], separate: true, material: { color: 'staff', roughness: 0.8 } },
			{ id: 'orb', shape: { type: 'sphere', radius: 0.055 }, attach: { to: 'staff', side: 'top', embed: 0.3 }, separate: true, material: { color: 'gem', emissive: 'gem', emissiveStrength: 1.4, roughness: 0.1 } }
		],
		effects: [{ id: 'sparkle', preset: 'magic', count: 50, emitter: { shape: 'sphere', size: 0.08 }, at: { to: 'orb', side: 'center' } }],
		clips: [{ id: 'idle', type: 'idle' }]
	}),
	[
		{ op: 'add_library_part', name: 'eye_dot', id: 'eye', attach: { to: 'head', offset: [0.4, 0.15] } },
		{ op: 'add_library_part', name: 'nose_round', id: 'nose', attach: { to: 'head', offset: [0, -0.1] }, size: 1.2 },
		{ op: 'add_library_part', name: 'hat_cone', id: 'hat', attach: { to: 'head', side: 'top', embed: 0.3 }, size: 1.3, color: 'hat' }
	]
);

export const cat = S('Cat', {
	notes: 'Sitting-height cat on four legs ~0.6 m long with pointed ears and a thin tail.',
	palette: { fur: '#9a9a9f', fur_dark: '#5f5f66', belly: '#e8e3db', nose: '#e08a9a', eye: '#2a6b3a' },
	settings: { resolution: 120, symmetry: 'x' },
	parts: [
		{ id: 'body', role: 'body', shape: { type: 'capsule', length: 0.5, radius: 0.12 }, rotation: [90, 0, 0], position: [0, 0.3, 0], material: { color: 'fur' }, pattern: { kind: 'stripes', color: 'fur_dark', scale: 0.05, amount: 0.7, axis: 'z' } },
		{ id: 'head', role: 'head', shape: { type: 'sphere', radius: 0.11 }, attach: { to: 'body', side: 'front', offset: [0, 0.6], embed: 0.4 }, blend: 0.05, material: { color: 'fur' } },
		{ id: 'muzzle', shape: { type: 'ellipsoid', radii: [0.05, 0.035, 0.035] }, attach: { to: 'head', side: 'front', offset: [0, -0.35], embed: 0.6 }, blend: 0.02, material: { color: 'belly' } },
		{ id: 'nose', shape: { type: 'sphere', radius: 0.014 }, attach: { to: 'muzzle', side: 'front', offset: [0, 0.5], embed: 0.4 }, material: { color: 'nose', roughness: 0.3 } },
		{ id: 'eye', role: 'eye', shape: { type: 'ellipsoid', radii: [0.022, 0.026, 0.015] }, attach: { to: 'head', side: 'front', offset: [0.42, 0.2], embed: 0.5 }, mirror: true, material: { color: 'eye', roughness: 0.15 } },
		{ id: 'ear', role: 'ear', shape: { type: 'cone', height: 0.08, radius: 0.04, sides: 3 }, attach: { to: 'head', side: 'top', offset: [0.5, -0.1], embed: 0.2 }, rotation: [0, 0, -12], blend: 0.015, mirror: true, material: { color: 'fur' } },
		{ id: 'leg_front', role: 'leg', shape: { type: 'capsule', length: 0.22, radius: 0.04 }, attach: { to: 'body', side: 'bottom', offset: [0.5, 0.6], embed: 0.5 }, blend: 0.04, mirror: true, material: { color: 'fur' } },
		{ id: 'leg_back', role: 'leg', shape: { type: 'capsule', length: 0.22, radius: 0.045 }, attach: { to: 'body', side: 'bottom', offset: [0.5, -0.6], embed: 0.5 }, blend: 0.04, mirror: true, material: { color: 'fur' } },
		{ id: 'paw_front', shape: { type: 'ellipsoid', radii: [0.045, 0.028, 0.055] }, attach: { to: 'leg_front', side: 'bottom', embed: 0.5 }, position: [0, 0, 0.015], blend: 0.015, material: { color: 'belly' } },
		{ id: 'paw_back', shape: { type: 'ellipsoid', radii: [0.048, 0.028, 0.058] }, attach: { to: 'leg_back', side: 'bottom', embed: 0.5 }, position: [0, 0, 0.015], blend: 0.015, material: { color: 'belly' } },
		{ id: 'tail', role: 'tail', shape: { type: 'tube', points: [[0, 0, 0], [0, 0.05, -0.12], [0, 0.18, -0.2], [0, 0.3, -0.17]], radius: [0.025, 0.022, 0.02, 0.016] }, attach: { to: 'body', side: 'back', offset: [0, 0.5], embed: 0.2 }, blend: 0.02, material: { color: 'fur_dark' } }
	],
	clips: [{ id: 'walk', type: 'walk' }, { id: 'idle', type: 'idle' }]
});

export const frog = S('Frog', {
	notes: 'Squat cartoon frog ~0.35 m with big eyes on top and folded legs; hop clip included.',
	palette: { skin: '#5fae4a', belly: '#d8e8a0', eye: '#1b1a1f', white: '#fbfbf5', mouth: '#3b1f2b' },
	settings: { resolution: 110, symmetry: 'x' },
	parts: [
		{ id: 'body', role: 'body', shape: { type: 'ellipsoid', radii: [0.17, 0.11, 0.15] }, position: [0, 0.11, 0], material: { color: 'skin', roughness: 0.4 }, pattern: { kind: 'gradient', color: 'belly', scale: 0.1, amount: 0 } },
		{ id: 'belly', shape: { type: 'ellipsoid', radii: [0.12, 0.07, 0.06] }, attach: { to: 'body', side: 'front', offset: [0, -0.3], embed: 0.9 }, blend: 0.03, material: { color: 'belly', roughness: 0.5 } },
		{ id: 'eye', role: 'eye', shape: { type: 'sphere', radius: 0.05 }, attach: { to: 'body', side: 'top', offset: [0.45, 0.45], embed: 0.4 }, blend: 0.03, mirror: true, material: { color: 'skin', roughness: 0.4 } },
		{ id: 'eye_white', shape: { type: 'sphere', radius: 0.035 }, attach: { to: 'eye', side: 'front', embed: 0.6 }, material: { color: 'white', roughness: 0.2 } },
		{ id: 'pupil', shape: { type: 'sphere', radius: 0.018 }, attach: { to: 'eye_white', side: 'front', embed: 0.55 }, material: { color: 'eye', roughness: 0.1 } },
		{ id: 'mouth', shape: { type: 'ellipsoid', radii: [0.1, 0.012, 0.04] }, attach: { to: 'body', side: 'front', offset: [0, 0.1], embed: 0.75 }, op: 'carve', blend: 0.005, material: { color: 'mouth' } },
		{ id: 'thigh', role: 'leg', shape: { type: 'ellipsoid', radii: [0.06, 0.05, 0.1] }, attach: { to: 'body', side: 'left', offset: [-0.4, -0.5], embed: 0.5 }, blend: 0.03, mirror: true, material: { color: 'skin', roughness: 0.4 } },
		{ id: 'foot', shape: { type: 'ellipsoid', radii: [0.05, 0.015, 0.08] }, attach: { to: 'thigh', side: 'bottom', embed: 0.4 }, position: [0.02, 0, 0.06], blend: 0.015, material: { color: 'skin', roughness: 0.4 } },
		{ id: 'hand', role: 'arm', shape: { type: 'capsule', length: 0.1, radius: 0.025 }, attach: { to: 'body', side: 'front', offset: [0.55, -0.7], embed: 0.4 }, blend: 0.02, mirror: true, material: { color: 'skin', roughness: 0.4 } }
	],
	clips: [{ id: 'hop', type: 'hop' }]
});

export const penguin = withLibrary(
	S('Penguin', {
		notes: 'Round penguin ~0.5 m with flippers, a beak and orange feet.',
		palette: { black: '#23262d', white: '#f3f3f0', orange: '#f2a33a' },
		settings: { resolution: 110, symmetry: 'x' },
		parts: [
			{ id: 'body', role: 'body', shape: { type: 'ellipsoid', radii: [0.16, 0.23, 0.15] }, position: [0, 0.25, 0], material: { color: 'black', roughness: 0.5 } },
			{ id: 'front', shape: { type: 'ellipsoid', radii: [0.12, 0.18, 0.06] }, attach: { to: 'body', side: 'front', offset: [0, -0.15], embed: 1.1 }, blend: 0.03, material: { color: 'white', roughness: 0.6 } },
			{ id: 'head', role: 'head', shape: { type: 'sphere', radius: 0.11 }, attach: { to: 'body', side: 'top', embed: 0.35 }, blend: 0.06, material: { color: 'black', roughness: 0.5 } },
			{ id: 'face', shape: { type: 'ellipsoid', radii: [0.08, 0.06, 0.04] }, attach: { to: 'head', side: 'front', offset: [0, -0.1], embed: 0.9 }, blend: 0.02, material: { color: 'white', roughness: 0.6 } },
			{ id: 'beak', shape: { type: 'cone', height: 0.06, radius: 0.022 }, attach: { to: 'head', side: 'front', offset: [0, -0.2], align: true, embed: 0.2 }, material: { color: 'orange', roughness: 0.4 } },
			{ id: 'flipper', role: 'wing', shape: { type: 'ellipsoid', radii: [0.02, 0.1, 0.045] }, attach: { to: 'body', side: 'left', offset: [0, 0.2], embed: 0.6 }, rotation: [0, 0, -18], pivot: 'attach', blend: 0.02, mirror: true, material: { color: 'black', roughness: 0.5 } },
			{ id: 'foot', role: 'leg', shape: { type: 'ellipsoid', radii: [0.045, 0.018, 0.07] }, attach: { to: 'body', side: 'bottom', offset: [0.45, 0.2], embed: 0.4 }, position: [0, 0, 0.03], mirror: true, material: { color: 'orange', roughness: 0.4 } }
		],
		clips: [{ id: 'walk', type: 'walk', amplitude: 0.6 }]
	}),
	[{ op: 'add_library_part', name: 'eye_dot', id: 'eye', attach: { to: 'face', offset: [0.4, 0.4] }, size: 0.8 }]
);

export const teddy = withLibrary(
	S('Teddy bear', {
		notes: 'Plush teddy bear ~0.45 m sitting upright, with round ears and a stitched snout.',
		palette: { fur: '#b07a48', light: '#e3c29a', dark: '#2a2224' },
		settings: { resolution: 110, symmetry: 'x' },
		parts: [
			{ id: 'body', role: 'body', shape: { type: 'ellipsoid', radii: [0.14, 0.16, 0.12] }, position: [0, 0.16, 0], material: { color: 'fur', roughness: 0.95 } },
			{ id: 'tummy', shape: { type: 'ellipsoid', radii: [0.09, 0.1, 0.04] }, attach: { to: 'body', side: 'front', embed: 1.1 }, blend: 0.03, material: { color: 'light', roughness: 0.95 } },
			{ id: 'head', role: 'head', shape: { type: 'sphere', radius: 0.12 }, attach: { to: 'body', side: 'top', embed: 0.25 }, blend: 0.04, material: { color: 'fur', roughness: 0.95 } },
			{ id: 'arm', role: 'arm', shape: { type: 'capsule', length: 0.16, radius: 0.045 }, attach: { to: 'body', side: 'left', offset: [0.3, 0.3], embed: 0.6 }, rotation: [0, 0, 55], pivot: 'attach', blend: 0.03, mirror: true, material: { color: 'fur', roughness: 0.95 } },
			{ id: 'leg', role: 'leg', shape: { type: 'capsule', length: 0.15, radius: 0.05 }, attach: { to: 'body', side: 'front', offset: [0.5, -0.75], embed: 0.6 }, rotation: [80, 0, 0], blend: 0.03, mirror: true, material: { color: 'fur', roughness: 0.95 } },
			{ id: 'sole', shape: { type: 'cylinder', height: 0.02, radius: 0.04 }, attach: { to: 'leg', side: 'front', embed: 0.6 }, rotation: [90, 0, 0], material: { color: 'light', roughness: 0.95 } }
		]
	}),
	[
		{ op: 'add_library_part', name: 'ear_round', id: 'ear', attach: { to: 'head', offset: [0.65, 0] }, size: 1.1 },
		{ op: 'add_library_part', name: 'snout', id: 'snout', attach: { to: 'head', offset: [0, -0.25] }, size: 0.9, color: 'light' },
		{ op: 'add_library_part', name: 'eye_dot', id: 'eye', attach: { to: 'head', offset: [0.42, 0.2] }, size: 0.8 }
	]
);

export const ghost = S('Ghost', {
	notes: 'Floating cartoon ghost ~0.6 m with a wavy hem, glowing faintly; hover clip.',
	palette: { sheet: '#eef1f6', glow: '#a9c8ff', eye: '#23262d' },
	settings: { resolution: 110, symmetry: 'x', ground: 'none' },
	parts: [
		{ id: 'body', role: 'body', shape: { type: 'capsule', length: 0.55, radius: 0.2 }, position: [0, 0.5, 0], material: { color: 'sheet', roughness: 0.5, emissive: 'glow', emissiveStrength: 0.25 } },
		{ id: 'hem', shape: { type: 'cylinder', height: 0.12, radius: 0.24, sides: 10, rounding: 0.04 }, attach: { to: 'body', side: 'bottom', embed: 0.8 }, blend: 0.06, material: { color: 'sheet', roughness: 0.5, emissive: 'glow', emissiveStrength: 0.25 } },
		{ id: 'eye', role: 'eye', shape: { type: 'ellipsoid', radii: [0.03, 0.045, 0.02] }, attach: { to: 'body', side: 'front', offset: [0.35, 0.35], embed: 0.8 }, op: 'carve', mirror: true, material: { color: 'eye' } },
		{ id: 'mouth', shape: { type: 'ellipsoid', radii: [0.04, 0.05, 0.02] }, attach: { to: 'body', side: 'front', offset: [0, 0.1], embed: 0.8 }, op: 'carve', material: { color: 'eye' } },
		{ id: 'arm', role: 'arm', shape: { type: 'capsule', length: 0.18, radius: 0.05 }, attach: { to: 'body', side: 'left', offset: [0, 0.1], embed: 0.6 }, rotation: [0, 0, 60], pivot: 'attach', blend: 0.05, mirror: true, material: { color: 'sheet', roughness: 0.5, emissive: 'glow', emissiveStrength: 0.25 } }
	],
	clips: [{ id: 'hover', type: 'hover' }]
});

export const dragon = withLibrary(
	S('Baby dragon', {
		notes: 'Chubby baby dragon ~0.7 m long with bat wings, horns, a spiked tail and a belly.',
		palette: { scale: '#4aa36a', belly: '#f1d98a', horn: '#f2e6c8', wing: '#2f7a4b' },
		settings: { resolution: 120, symmetry: 'x' },
		parts: [
			{ id: 'body', role: 'body', shape: { type: 'ellipsoid', radii: [0.16, 0.16, 0.22] }, position: [0, 0.25, 0], material: { color: 'scale', roughness: 0.55 } },
			{ id: 'belly', shape: { type: 'ellipsoid', radii: [0.11, 0.12, 0.05] }, attach: { to: 'body', side: 'front', offset: [0, -0.2], embed: 1.1 }, blend: 0.03, material: { color: 'belly', roughness: 0.6 } },
			{ id: 'neck', shape: { type: 'capsule', length: 0.16, radius: 0.07 }, attach: { to: 'body', side: 'front', offset: [0, 0.45], embed: 0.6 }, rotation: [-40, 0, 0], blend: 0.05, material: { color: 'scale', roughness: 0.55 } },
			{ id: 'head', role: 'head', shape: { type: 'ellipsoid', radii: [0.11, 0.1, 0.13] }, attach: { to: 'neck', side: 'top', embed: 0.35 }, position: [0, 0, 0.03], blend: 0.04, material: { color: 'scale', roughness: 0.55 } },
			{ id: 'snout', shape: { type: 'ellipsoid', radii: [0.07, 0.05, 0.07] }, attach: { to: 'head', side: 'front', offset: [0, -0.3], embed: 0.6 }, blend: 0.03, material: { color: 'scale', roughness: 0.55 } },
			{ id: 'leg_front', role: 'leg', shape: { type: 'capsule', length: 0.2, radius: 0.045 }, attach: { to: 'body', side: 'bottom', offset: [0.5, 0.45], embed: 0.5 }, blend: 0.04, mirror: true, material: { color: 'scale', roughness: 0.55 } },
			{ id: 'leg_back', role: 'leg', shape: { type: 'capsule', length: 0.2, radius: 0.055 }, attach: { to: 'body', side: 'bottom', offset: [0.5, -0.45], embed: 0.5 }, blend: 0.04, mirror: true, material: { color: 'scale', roughness: 0.55 } },
			{ id: 'tail', role: 'tail', shape: { type: 'tube', points: [[0, 0, 0], [0, -0.02, -0.14], [0, 0.04, -0.28], [0, 0.12, -0.36]], radius: [0.07, 0.05, 0.03, 0.015] }, attach: { to: 'body', side: 'back', offset: [0, -0.1], embed: 0.3 }, blend: 0.04, material: { color: 'scale', roughness: 0.55 } }
		],
		clips: [{ id: 'walk', type: 'walk' }, { id: 'fly', type: 'fly' }]
	}),
	[
		{ op: 'add_library_part', name: 'eye_cartoon', id: 'eye', attach: { to: 'head', offset: [0.42, 0.2] }, size: 1 },
		{ op: 'add_library_part', name: 'horn_curved', id: 'horn', attach: { to: 'head', offset: [0.4, -0.3] }, size: 0.8, color: 'horn' },
		{ op: 'add_library_part', name: 'wing_bat', id: 'wing', attach: { to: 'body', side: 'top', offset: [0.9, 0.1], embed: 0.3 }, size: 0.9, color: 'wing' },
		{ op: 'add_library_part', name: 'spike', id: 'spike', attach: { to: 'tail', side: 'top', offset: [0, 0.2] }, size: 0.8, color: 'horn' }
	]
);

export const chicken = S('Chicken', {
	notes: 'Plump chicken ~0.4 m with a comb, wattle, tail feathers and thin legs.',
	palette: { feather: '#f4efe4', red: '#d64533', beak: '#f2b233', eye: '#1b1a1f' },
	settings: { resolution: 120, symmetry: 'x' },
	parts: [
		{ id: 'body', role: 'body', shape: { type: 'ellipsoid', radii: [0.12, 0.12, 0.15] }, position: [0, 0.22, 0], material: { color: 'feather', roughness: 0.8 } },
		{ id: 'head', role: 'head', shape: { type: 'sphere', radius: 0.07 }, attach: { to: 'body', side: 'front', offset: [0, 0.75], embed: 0.4 }, position: [0, 0.03, 0], blend: 0.05, material: { color: 'feather', roughness: 0.8 } },
		{ id: 'comb', shape: { type: 'ellipsoid', radii: [0.012, 0.035, 0.045] }, attach: { to: 'head', side: 'top', embed: 0.45 }, material: { color: 'red', roughness: 0.5 } },
		{ id: 'beak', shape: { type: 'cone', height: 0.045, radius: 0.018 }, attach: { to: 'head', side: 'front', offset: [0, -0.05], align: true, embed: 0.2 }, material: { color: 'beak', roughness: 0.4 } },
		{ id: 'wattle', shape: { type: 'ellipsoid', radii: [0.012, 0.022, 0.012] }, attach: { to: 'head', side: 'front', offset: [0, -0.5], embed: 0.5 }, material: { color: 'red', roughness: 0.5 } },
		{ id: 'eye', role: 'eye', shape: { type: 'sphere', radius: 0.011 }, attach: { to: 'head', side: 'front', offset: [0.55, 0.2], embed: 0.4 }, mirror: true, material: { color: 'eye', roughness: 0.15 } },
		{ id: 'wing', role: 'wing', shape: { type: 'ellipsoid', radii: [0.025, 0.07, 0.1] }, attach: { to: 'body', side: 'left', embed: 0.7 }, rotation: [-10, 0, -6], pivot: 'attach', blend: 0.02, mirror: true, material: { color: 'feather', roughness: 0.8 } },
		{ id: 'tail', role: 'tail', shape: { type: 'cone', height: 0.12, radius: 0.06, sides: 5 }, attach: { to: 'body', side: 'back', offset: [0, 0.5], embed: 0.4 }, rotation: [-50, 0, 0], blend: 0.02, material: { color: 'feather', roughness: 0.8 } },
		{ id: 'leg', role: 'leg', shape: { type: 'capsule', length: 0.12, radius: 0.012 }, attach: { to: 'body', side: 'bottom', offset: [0.35, 0], embed: 0.3 }, mirror: true, material: { color: 'beak', roughness: 0.5 } },
		{ id: 'toes', shape: { type: 'ellipsoid', radii: [0.025, 0.01, 0.035] }, attach: { to: 'leg', side: 'bottom', embed: 0.5 }, position: [0, 0, 0.012], material: { color: 'beak', roughness: 0.5 } }
	],
	clips: [{ id: 'walk', type: 'walk' }, { id: 'idle', type: 'idle' }]
});

export const truck = withLibrary(
	S('Pickup truck', {
		notes: 'Toy pickup truck ~1.4 m with an open bed, headlights and spinning wheels.',
		palette: { paint: '#2f7fb8', trim: '#2b2d33', glass: '#9fd3e6', light: '#fff2b0', bed: '#255f8a' },
		settings: { resolution: 130, symmetry: 'x' },
		parts: [
			{ id: 'chassis', role: 'body', shape: { type: 'box', size: [0.64, 0.24, 1.4], rounding: 0.08 }, position: [0, 0.32, 0], material: { color: 'paint', roughness: 0.35 } },
			{ id: 'cab', shape: { type: 'box', size: [0.58, 0.3, 0.46], rounding: 0.09 }, attach: { to: 'chassis', side: 'top', offset: [0, 0.2], embed: 0.35 }, blend: 0.03, material: { color: 'paint', roughness: 0.35 } },
			{ id: 'windshield', shape: { type: 'box', size: [0.46, 0.16, 0.1], rounding: 0.025 }, attach: { to: 'cab', side: 'front', offset: [0, 0.2], embed: 0.8 }, op: 'carve', material: { color: 'glass', roughness: 0.1, metalness: 0.2 } },
			{ id: 'side_window', shape: { type: 'box', size: [0.1, 0.15, 0.3], rounding: 0.025 }, attach: { to: 'cab', side: 'left', offset: [0, 0.2], embed: 0.8 }, op: 'carve', mirror: true, material: { color: 'glass', roughness: 0.1, metalness: 0.2 } },
			{ id: 'bed', shape: { type: 'box', size: [0.56, 0.16, 0.56], rounding: 0.02 }, attach: { to: 'chassis', side: 'top', offset: [0, -0.58], embed: 0.8 }, op: 'carve', material: { color: 'bed', roughness: 0.6 } },
			{ id: 'bumper', shape: { type: 'box', size: [0.66, 0.08, 0.08], rounding: 0.035 }, attach: { to: 'chassis', side: 'front', offset: [0, -0.4], embed: 0.5 }, material: { color: 'trim', roughness: 0.5 } },
			{ id: 'headlight', shape: { type: 'cylinder', height: 0.03, radius: 0.045 }, attach: { to: 'chassis', side: 'front', offset: [0.6, 0.2], embed: 0.4 }, rotation: [90, 0, 0], mirror: true, material: { color: 'light', emissive: 'light', emissiveStrength: 1.1 } }
		],
		clips: [{ id: 'drive', type: 'drive' }]
	}),
	[
		{ op: 'add_library_part', name: 'wheel', id: 'wheel_front', attach: { to: 'chassis', side: 'left', offset: [0.65, -0.5], embed: 0.55 }, size: 1.15 },
		{ op: 'add_library_part', name: 'wheel', id: 'wheel_back', attach: { to: 'chassis', side: 'left', offset: [-0.65, -0.5], embed: 0.55 }, size: 1.15 }
	]
);

export const plane = S('Propeller plane', {
	notes: 'Chunky propeller plane ~1.5 m long, modeled in flight; the propeller spins in the spin clip.',
	palette: { paint: '#e8e2d2', stripe: '#d64533', dark: '#2b2d33', glass: '#27354d' },
	settings: { resolution: 130, symmetry: 'x', ground: 'none' },
	parts: [
		{ id: 'fuselage', role: 'body', shape: { type: 'capsule', length: 1.4, radius: 0.16 }, rotation: [90, 0, 0], position: [0, 0.45, 0], material: { color: 'paint', roughness: 0.4 }, pattern: { kind: 'stripes', color: 'stripe', scale: 0.25, amount: 0.8, axis: 'y' } },
		{ id: 'cockpit', shape: { type: 'ellipsoid', radii: [0.11, 0.09, 0.2] }, attach: { to: 'fuselage', side: 'top', offset: [0, 0.1], embed: 0.55 }, blend: 0.02, material: { color: 'glass', roughness: 0.05, metalness: 0.5 } },
		{ id: 'wing', shape: { type: 'box', size: [1.5, 0.05, 0.36], rounding: 0.02 }, attach: { to: 'fuselage', side: 'center', embed: 1 }, position: [0, -0.04, 0.12], blend: 0.04, material: { color: 'paint', roughness: 0.4 } },
		{ id: 'tailplane', shape: { type: 'box', size: [0.6, 0.04, 0.2], rounding: 0.015 }, attach: { to: 'fuselage', side: 'back', embed: 0.9 }, position: [0, 0.04, 0.12], blend: 0.03, material: { color: 'paint', roughness: 0.4 } },
		{ id: 'fin', shape: { type: 'prism', size: [0.26, 0.26, 0.04], rounding: 0.01 }, attach: { to: 'fuselage', side: 'back', embed: 0.9 }, rotation: [0, 90, 0], position: [0, 0.14, 0.1], blend: 0.03, material: { color: 'stripe', roughness: 0.4 } },
		{ id: 'nose', shape: { type: 'cylinder', height: 0.06, radius: 0.1, rounding: 0.02 }, attach: { to: 'fuselage', side: 'front', embed: 0.5 }, rotation: [90, 0, 0], material: { color: 'dark', metalness: 0.6, roughness: 0.4 } },
		{ id: 'propeller', role: 'rotor', shape: { type: 'box', size: [0.6, 0.05, 0.015], rounding: 0.01 }, attach: { to: 'nose', side: 'front', embed: 0.3 }, separate: true, pivot: 'center', material: { color: 'dark', roughness: 0.6 } },
		{ id: 'wheel', role: 'wheel', shape: { type: 'cylinder', height: 0.05, radius: 0.07, rounding: 0.02 }, attach: { to: 'wing', side: 'bottom', offset: [0.2, 0.3], embed: 0.2 }, rotation: [0, 0, 90], separate: true, mirror: true, material: { color: 'dark', roughness: 0.9 } }
	],
	clips: [{ id: 'spin', type: 'spin', target: 'propeller', speed: 8 }]
});

export const boat = S('Sailboat', {
	notes: 'Small sailboat ~1.4 m long: hull, deck, mast and a triangle sail.',
	palette: { hull: '#c8403a', deck: '#b8865a', sail: '#f3efe6', wood: '#7a5032' },
	settings: { resolution: 130, symmetry: 'x', ground: 'none' },
	parts: [
		{ id: 'hull', role: 'body', shape: { type: 'ellipsoid', radii: [0.3, 0.22, 0.7] }, position: [0, 0.22, 0], material: { color: 'hull', roughness: 0.45 } },
		{ id: 'deck_cut', shape: { type: 'box', size: [1, 0.4, 2] }, position: [0, 0.42, 0], op: 'carve' },
		{ id: 'deck', shape: { type: 'ellipsoid', radii: [0.28, 0.02, 0.66] }, position: [0, 0.22, 0], material: { color: 'deck', roughness: 0.8 }, pattern: { kind: 'stripes', color: '#9a6a42', scale: 0.04, amount: 0.5, axis: 'x' } },
		{ id: 'mast', shape: { type: 'cylinder', height: 1.2, radius: 0.025 }, attach: { to: 'deck', side: 'top', offset: [0, 0.2], embed: 0.2 }, material: { color: 'wood', roughness: 0.8 } },
		{ id: 'sail', shape: { type: 'prism', size: [0.6, 1.0, 0.03], rounding: 0.008 }, attach: { to: 'mast', side: 'center', embed: 1 }, rotation: [0, 90, 0], position: [0, 0.05, -0.28], material: { color: 'sail', roughness: 0.9 } },
		{ id: 'boom', shape: { type: 'cylinder', height: 0.6, radius: 0.02 }, attach: { to: 'mast', side: 'center', embed: 1 }, rotation: [90, 0, 0], position: [0, -0.46, -0.28], material: { color: 'wood', roughness: 0.8 } }
	]
});

export const rocket = S('Cartoon rocket', {
	notes: 'Retro rocket ~1.3 m with fins, a porthole and an engine glow; smoke trail effect.',
	palette: { body: '#e8e6e0', red: '#d64533', glass: '#7fc6e8', dark: '#2b2d33', glow: '#ffb13b' },
	settings: { resolution: 130 },
	parts: [
		{ id: 'body', role: 'body', shape: { type: 'capsule', length: 0.9, radius: 0.2 }, position: [0, 0.75, 0], material: { color: 'body', roughness: 0.35, metalness: 0.2 } },
		{ id: 'nose', shape: { type: 'cone', height: 0.35, radius: 0.19, rounding: 0.02 }, attach: { to: 'body', side: 'top', embed: 0.55 }, blend: 0.05, material: { color: 'red', roughness: 0.35 } },
		{ id: 'window', shape: { type: 'cylinder', height: 0.04, radius: 0.07, rounding: 0.01 }, attach: { to: 'body', side: 'front', offset: [0, 0.3], embed: 0.4 }, rotation: [90, 0, 0], material: { color: 'glass', roughness: 0.05, metalness: 0.4 } },
		{ id: 'rim', shape: { type: 'torus', radius: 0.075, tube: 0.014 }, attach: { to: 'window', side: 'front', embed: 0.9 }, rotation: [90, 0, 0], material: { color: 'dark', metalness: 0.7, roughness: 0.4 } },
		{ id: 'fin', shape: { type: 'prism', size: [0.3, 0.32, 0.04], rounding: 0.01 }, attach: { to: 'body', side: 'left', offset: [0, -0.7], embed: 0.5 }, blend: 0.02, mirror: true, material: { color: 'red', roughness: 0.35 } },
		{ id: 'fin_back', shape: { type: 'prism', size: [0.3, 0.32, 0.04], rounding: 0.01 }, attach: { to: 'body', side: 'back', offset: [0, -0.7], embed: 0.5 }, rotation: [0, 90, 0], blend: 0.02, material: { color: 'red', roughness: 0.35 } },
		{ id: 'fin_front', shape: { type: 'prism', size: [0.3, 0.32, 0.04], rounding: 0.01 }, attach: { to: 'body', side: 'front', offset: [0, -0.7], embed: 0.5 }, rotation: [0, 90, 0], blend: 0.02, material: { color: 'red', roughness: 0.35 } },
		{ id: 'nozzle', shape: { type: 'cone', height: 0.16, radius: 0.15, topRadius: 0.1, rounding: 0.01 }, attach: { to: 'body', side: 'bottom', embed: 0.4 }, material: { color: 'dark', metalness: 0.7, roughness: 0.4 } },
		{ id: 'flame', shape: { type: 'cylinder', height: 0.05, radius: 0.12 }, attach: { to: 'nozzle', side: 'bottom', embed: 0.6 }, material: { color: 'glow', emissive: 'glow', emissiveStrength: 2.5 } }
	],
	effects: [{ id: 'trail', preset: 'smoke', direction: [0, -1, 0], gravity: 0.2, at: { to: 'flame', side: 'bottom' } }]
});

export const tower = S('Castle tower', {
	notes: 'Round stone tower ~3.8 m with battlements, arrow slits, a door and a flag.',
	palette: { stone: '#9a948c', roof: '#7a3a2a', wood: '#6b4526', flag: '#d64533', dark: '#2b2d33' },
	settings: { resolution: 120, edges: 'sharp' },
	parts: [
		{ id: 'wall', role: 'body', shape: { type: 'cylinder', height: 2.4, radius: 0.6, sides: 12 }, position: [0, 1.2, 0], material: { color: 'stone', roughness: 0.95 }, detail: { amount: 0.008, scale: 0.08 } },
		{ id: 'ring', shape: { type: 'cylinder', height: 0.3, radius: 0.7, sides: 12 }, attach: { to: 'wall', side: 'top', embed: 0.9 }, material: { color: 'stone', roughness: 0.95 } },
		{ id: 'crenel', shape: { type: 'box', size: [0.2, 0.25, 1.6] }, attach: { to: 'ring', side: 'top', embed: 1 }, op: 'carve' },
		{ id: 'crenel_2', shape: { type: 'box', size: [1.6, 0.25, 0.2] }, attach: { to: 'ring', side: 'top', embed: 1 }, op: 'carve' },
		{ id: 'roof', shape: { type: 'cone', height: 0.9, radius: 0.55, sides: 12 }, attach: { to: 'ring', side: 'top', embed: 0.6 }, material: { color: 'roof', roughness: 0.8 } },
		{ id: 'door', shape: { type: 'box', size: [0.4, 0.7, 0.4], rounding: 0.05 }, attach: { to: 'wall', side: 'front', offset: [0, -0.7], embed: 0.8 }, op: 'carve', material: { color: 'wood' } },
		{ id: 'slit', shape: { type: 'box', size: [0.06, 0.28, 0.4] }, attach: { to: 'wall', side: 'front', offset: [0, 0.3], embed: 0.8 }, op: 'carve', material: { color: 'dark' } },
		{ id: 'slit_side', shape: { type: 'box', size: [0.4, 0.28, 0.06] }, attach: { to: 'wall', side: 'left', offset: [0, 0.1], embed: 0.8 }, op: 'carve', mirror: true, material: { color: 'dark' } },
		{ id: 'pole', shape: { type: 'cylinder', height: 0.6, radius: 0.03 }, attach: { to: 'roof', side: 'top', embed: 0.2 }, separate: true, material: { color: 'dark', metalness: 0.6, roughness: 0.5 } },
		{ id: 'flag', shape: { type: 'prism', size: [0.25, 0.3, 0.035] }, attach: { to: 'pole', side: 'top', embed: 0.9 }, rotation: [0, 0, -90], position: [0.14, -0.08, 0], separate: true, material: { color: 'flag', roughness: 0.9 } }
	]
});

export const well = S('Well', {
	notes: 'Stone well ~1.6 m with a wooden roof frame and a bucket.',
	palette: { stone: '#8f8a84', wood: '#7a5032', roof: '#a4553a', water: '#3a6f9a', rope: '#c8b38a' },
	settings: { resolution: 120 },
	parts: [
		{ id: 'ring', role: 'body', shape: { type: 'cylinder', height: 0.6, radius: 0.5, rounding: 0.04 }, position: [0, 0.3, 0], material: { color: 'stone', roughness: 0.95 }, detail: { amount: 0.01, scale: 0.06 } },
		{ id: 'hole', shape: { type: 'cylinder', height: 0.7, radius: 0.38 }, attach: { to: 'ring', side: 'top', embed: 1 }, position: [0, 0.05, 0], op: 'carve', material: { color: 'water', roughness: 0.1 } },
		{ id: 'post', shape: { type: 'box', size: [0.08, 1.0, 0.08], rounding: 0.01 }, attach: { to: 'ring', side: 'left', embed: 0.7 }, position: [0, 0.5, 0], mirror: true, material: { color: 'wood', roughness: 0.85 } },
		{ id: 'roof', shape: { type: 'prism', size: [1.3, 0.35, 0.8], rounding: 0.02 }, attach: { to: 'ring', side: 'top', embed: 0 }, position: [0, 0.62, 0], material: { color: 'roof', roughness: 0.85 } },
		{ id: 'axle', shape: { type: 'cylinder', height: 1.05, radius: 0.035 }, attach: { to: 'ring', side: 'top', embed: 0 }, position: [0, 0.5, 0], rotation: [0, 0, 90], material: { color: 'wood', roughness: 0.85 } },
		{ id: 'rope', shape: { type: 'cylinder', height: 0.35, radius: 0.017 }, attach: { to: 'axle', side: 'bottom', embed: 0.2 }, material: { color: 'rope', roughness: 0.9 } },
		{ id: 'bucket', shape: { type: 'cone', height: 0.14, radius: 0.08, topRadius: 0.1, rounding: 0.01 }, attach: { to: 'rope', side: 'bottom', embed: 0.3 }, material: { color: 'wood', roughness: 0.85 } }
	]
});

export const lamppost = S('Lamp post', {
	notes: 'Victorian street lamp ~2.4 m with a glowing lantern head.',
	palette: { iron: '#2f3238', glass: '#fff0b8' },
	settings: { resolution: 130, edges: 'sharp' },
	parts: [
		{ id: 'base', role: 'body', shape: { type: 'cylinder', height: 0.2, radius: 0.18, sides: 8, rounding: 0.02 }, position: [0, 0.1, 0], material: { color: 'iron', metalness: 0.7, roughness: 0.45 } },
		{ id: 'pole', shape: { type: 'cylinder', height: 1.9, radius: 0.045, sides: 8 }, attach: { to: 'base', side: 'top', embed: 0.2 }, material: { color: 'iron', metalness: 0.7, roughness: 0.45 } },
		{ id: 'collar', shape: { type: 'cylinder', height: 0.08, radius: 0.08, sides: 8 }, attach: { to: 'pole', side: 'top', embed: 0.4 }, material: { color: 'iron', metalness: 0.7, roughness: 0.45 } },
		{ id: 'lantern', shape: { type: 'cone', height: 0.3, radius: 0.1, topRadius: 0.16, sides: 6 }, attach: { to: 'collar', side: 'top', embed: 0.2 }, material: { color: 'glass', emissive: 'glass', emissiveStrength: 1.6, roughness: 0.2 } },
		{ id: 'cap', shape: { type: 'cone', height: 0.16, radius: 0.2, sides: 6 }, attach: { to: 'lantern', side: 'top', embed: 0.3 }, material: { color: 'iron', metalness: 0.7, roughness: 0.45 } },
		{ id: 'finial', shape: { type: 'sphere', radius: 0.03 }, attach: { to: 'cap', side: 'top', embed: 0.4 }, material: { color: 'iron', metalness: 0.7, roughness: 0.45 } }
	]
});

export const tent = S('Tent', {
	notes: 'Camping tent ~1.3 m: a triangular canvas with an open flap and guy ropes.',
	palette: { canvas: '#d9a441', canvas_dark: '#b8862f', inside: '#3a2a1a', rope: '#c8b38a', peg: '#6b4a2b' },
	settings: { resolution: 120 },
	parts: [
		{ id: 'canvas', role: 'body', shape: { type: 'prism', size: [1.4, 1.1, 1.6], rounding: 0.03 }, position: [0, 0.55, 0], material: { color: 'canvas', roughness: 0.9 }, pattern: { kind: 'gradient', color: 'canvas_dark', scale: 1.1, amount: 0.5 } },
		{ id: 'door', shape: { type: 'prism', size: [0.6, 0.7, 0.3], rounding: 0.02 }, attach: { to: 'canvas', side: 'front', offset: [0, -0.35], embed: 0.8 }, op: 'carve', material: { color: 'inside' } },
		{ id: 'ridge', shape: { type: 'cylinder', height: 1.7, radius: 0.02 }, attach: { to: 'canvas', side: 'top', embed: 0.5 }, rotation: [90, 0, 0], material: { color: 'peg', roughness: 0.8 } },
		{ id: 'rope', shape: { type: 'tube', points: [[0, 0, 0], [0.35, -0.5, 0]], radius: 0.01 }, attach: { to: 'canvas', side: 'left', offset: [0.6, 0.3], embed: 0.2 }, mirror: true, separate: true, material: { color: 'rope' } },
		{ id: 'peg', shape: { type: 'cone', height: 0.1, radius: 0.02, sides: 4 }, attach: { to: 'rope', side: 'bottom', embed: 0.5 }, rotation: [180, 0, 0], separate: true, material: { color: 'peg' } }
	]
});

export const pine = S('Pine tree', {
	notes: 'Stylized pine ~1.8 m with three stacked faceted tiers.',
	palette: { bark: '#6f4a2e', needle: '#2f7a4b', needle_dark: '#225c38' },
	settings: { resolution: 110, edges: 'sharp' },
	parts: [
		{ id: 'trunk', role: 'body', shape: { type: 'cylinder', height: 0.6, radius: 0.1, sides: 7 }, position: [0, 0.3, 0], material: { color: 'bark', roughness: 0.95 } },
		{ id: 'tier_low', shape: { type: 'cone', height: 0.9, radius: 0.75, sides: 9 }, attach: { to: 'trunk', side: 'top', embed: 0.5 }, material: { color: 'needle', roughness: 0.9 }, pattern: { kind: 'gradient', color: 'needle_dark', scale: 0.9, amount: 0.4, axis: 'y' } },
		{ id: 'tier_mid', shape: { type: 'cone', height: 0.8, radius: 0.58, sides: 9 }, attach: { to: 'tier_low', side: 'top', embed: 1.25 }, rotation: [0, 20, 0], material: { color: 'needle', roughness: 0.9 } },
		{ id: 'tier_top', shape: { type: 'cone', height: 0.7, radius: 0.4, sides: 9 }, attach: { to: 'tier_mid', side: 'top', embed: 1.25 }, rotation: [0, 40, 0], material: { color: 'needle', roughness: 0.9 } }
	],
	clips: [{ id: 'sway', type: 'idle' }]
});

export const cactus = S('Potted cactus', {
	notes: 'Saguaro-style cactus with two arms in a terracotta pot, ~0.7 m.',
	palette: { cactus: '#4f9a5a', spine: '#e8e2c8', pot: '#c26a3f', soil: '#4a3222', flower: '#e8649a' },
	settings: { resolution: 120 },
	parts: [
		{ id: 'pot', role: 'body', shape: { type: 'cone', height: 0.22, radius: 0.14, topRadius: 0.18, rounding: 0.02 }, position: [0, 0.11, 0], material: { color: 'pot', roughness: 0.8 } },
		{ id: 'rim', shape: { type: 'torus', radius: 0.18, tube: 0.025 }, attach: { to: 'pot', side: 'top', embed: 0.6 }, material: { color: 'pot', roughness: 0.8 } },
		{ id: 'soil', shape: { type: 'cylinder', height: 0.04, radius: 0.16 }, attach: { to: 'pot', side: 'top', embed: 0.8 }, op: 'carve', material: { color: 'soil', roughness: 1 } },
		{ id: 'stem', shape: { type: 'capsule', length: 0.5, radius: 0.065 }, attach: { to: 'pot', side: 'top', embed: 0.25 }, material: { color: 'cactus', roughness: 0.7 }, pattern: { kind: 'stripes', color: '#3f7a48', scale: 0.03, amount: 0.6, axis: 'around' } },
		{ id: 'arm', shape: { type: 'tube', points: [[0, 0, 0], [0.1, 0, 0], [0.12, 0.16, 0]], radius: [0.045, 0.045, 0.04] }, attach: { to: 'stem', side: 'left', offset: [0, 0.1], embed: 0.6 }, blend: 0.02, material: { color: 'cactus', roughness: 0.7 } },
		{ id: 'arm_2', shape: { type: 'tube', points: [[0, 0, 0], [-0.09, 0, 0], [-0.1, 0.12, 0]], radius: [0.04, 0.04, 0.035] }, attach: { to: 'stem', side: 'right', offset: [0, -0.2], embed: 0.6 }, blend: 0.02, material: { color: 'cactus', roughness: 0.7 } },
		{ id: 'flower', shape: { type: 'cylinder', height: 0.02, radius: 0.035, sides: 5, rounding: 0.008 }, attach: { to: 'stem', side: 'top', embed: 0.3 }, material: { color: 'flower', roughness: 0.6 } }
	]
});

export const campfire = S('Campfire', {
	notes: 'Crossed logs in a ring of stones with fire and a little smoke, ~0.8 m across.',
	palette: { wood: '#6f4a2e', ash: '#3a3432', stone: '#8f8a84', ember: '#ff8a3a' },
	settings: { resolution: 110 },
	parts: [
		{ id: 'ash', role: 'body', shape: { type: 'cylinder', height: 0.03, radius: 0.26, rounding: 0.01 }, position: [0, 0.015, 0], material: { color: 'ash', roughness: 1 } },
		{ id: 'log', shape: { type: 'capsule', length: 0.55, radius: 0.05 }, attach: { to: 'ash', side: 'top', embed: 0.5 }, rotation: [90, 0, 0], position: [0, 0, 0], material: { color: 'wood', roughness: 0.9 }, detail: { amount: 0.004, scale: 0.02 } },
		{ id: 'log_2', shape: { type: 'capsule', length: 0.55, radius: 0.05 }, attach: { to: 'ash', side: 'top', embed: 0.5 }, rotation: [90, 60, 0], position: [0, 0.04, 0], material: { color: 'wood', roughness: 0.9 }, detail: { amount: 0.004, scale: 0.02 } },
		{ id: 'log_3', shape: { type: 'capsule', length: 0.55, radius: 0.05 }, attach: { to: 'ash', side: 'top', embed: 0.5 }, rotation: [90, 120, 0], position: [0, 0.08, 0], material: { color: 'wood', roughness: 0.9 }, detail: { amount: 0.004, scale: 0.02 } },
		{ id: 'embers', shape: { type: 'sphere', radius: 0.07 }, attach: { to: 'ash', side: 'top', embed: 0.5 }, material: { color: 'ember', emissive: 'ember', emissiveStrength: 2 }, detail: { amount: 0.01, scale: 0.02 } },
		...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({
			id: `stone_${k}`,
			shape: { type: 'ellipsoid' as const, radii: [0.07, 0.05, 0.06] as [number, number, number] },
			position: [Math.sin((k / 8) * Math.PI * 2) * 0.36, 0.035, Math.cos((k / 8) * Math.PI * 2) * 0.36] as [number, number, number],
			rotation: [0, k * 45, 0] as [number, number, number],
			separate: true,
			material: { color: 'stone', roughness: 0.95 },
			detail: { amount: 0.006, scale: 0.03 }
		}))
	],
	effects: [{ id: 'fire', preset: 'fire', at: { to: 'embers', side: 'top' } }, { id: 'smoke', preset: 'smoke', count: 25, at: { to: 'embers', side: 'top' } }]
});

export const table = S('Wooden table', {
	notes: 'Tavern table ~1.2 m long on four legs.',
	palette: { wood: '#b07c46', wood_dark: '#5e3c20' },
	settings: { resolution: 120, edges: 'sharp' },
	parts: [
		{ id: 'top', role: 'body', shape: { type: 'box', size: [1.2, 0.07, 0.7], rounding: 0.015 }, position: [0, 0.75, 0], material: { color: 'wood', roughness: 0.8 }, pattern: { kind: 'stripes', color: 'wood_dark', scale: 0.08, amount: 0.4, axis: 'z' } },
		{ id: 'leg', shape: { type: 'box', size: [0.07, 0.72, 0.07], rounding: 0.01 }, attach: { to: 'top', side: 'bottom', offset: [0.85, 0.75], embed: 0.05 }, mirror: true, material: { color: 'wood_dark', roughness: 0.8 } },
		{ id: 'leg_back', shape: { type: 'box', size: [0.07, 0.72, 0.07], rounding: 0.01 }, attach: { to: 'top', side: 'bottom', offset: [0.85, -0.75], embed: 0.05 }, mirror: true, material: { color: 'wood_dark', roughness: 0.8 } },
		{ id: 'rail', shape: { type: 'box', size: [1.0, 0.06, 0.03] }, attach: { to: 'top', side: 'bottom', offset: [0, 0.75], embed: 0.4 }, material: { color: 'wood_dark', roughness: 0.8 } },
		{ id: 'rail_back', shape: { type: 'box', size: [1.0, 0.06, 0.03] }, attach: { to: 'top', side: 'bottom', offset: [0, -0.75], embed: 0.4 }, material: { color: 'wood_dark', roughness: 0.8 } }
	]
});

export const chair = S('Wooden chair', {
	notes: 'Simple chair ~0.9 m with a slatted back.',
	palette: { wood: '#b07c46', wood_dark: '#5e3c20' },
	settings: { resolution: 120, edges: 'sharp' },
	parts: [
		{ id: 'seat', role: 'body', shape: { type: 'box', size: [0.44, 0.05, 0.42], rounding: 0.012 }, position: [0, 0.45, 0], material: { color: 'wood', roughness: 0.8 } },
		{ id: 'leg', shape: { type: 'box', size: [0.045, 0.43, 0.045], rounding: 0.008 }, attach: { to: 'seat', side: 'bottom', offset: [0.82, 0.82], embed: 0.05 }, mirror: true, material: { color: 'wood_dark', roughness: 0.8 } },
		{ id: 'leg_back', shape: { type: 'box', size: [0.045, 0.43, 0.045], rounding: 0.008 }, attach: { to: 'seat', side: 'bottom', offset: [0.82, -0.82], embed: 0.05 }, mirror: true, material: { color: 'wood_dark', roughness: 0.8 } },
		{ id: 'post', shape: { type: 'box', size: [0.045, 0.46, 0.045], rounding: 0.008 }, attach: { to: 'seat', side: 'top', offset: [0.82, -0.82], embed: 0.1 }, mirror: true, material: { color: 'wood_dark', roughness: 0.8 } },
		{ id: 'slat', shape: { type: 'box', size: [0.38, 0.05, 0.025], rounding: 0.006 }, attach: { to: 'seat', side: 'top', offset: [0, -0.82], embed: 0 }, position: [0, 0.22, 0], material: { color: 'wood', roughness: 0.8 } },
		{ id: 'slat_2', shape: { type: 'box', size: [0.38, 0.05, 0.025], rounding: 0.006 }, attach: { to: 'seat', side: 'top', offset: [0, -0.82], embed: 0 }, position: [0, 0.36, 0], material: { color: 'wood', roughness: 0.8 } }
	]
});

export const shield = S('Round shield', {
	notes: 'Viking-style round shield ~0.7 m with a metal rim and a boss.',
	palette: { wood: '#9a6a3f', paint: '#2f5f9a', metal: '#8f949c' },
	settings: { resolution: 130 },
	parts: [
		{ id: 'board', role: 'body', shape: { type: 'cylinder', height: 0.035, radius: 0.35, rounding: 0.008 }, rotation: [90, 0, 0], position: [0, 0.35, 0], material: { color: 'paint', roughness: 0.7 }, pattern: { kind: 'stripes', color: 'wood', scale: 0.12, amount: 1, axis: 'x' } },
		{ id: 'rim', shape: { type: 'torus', radius: 0.35, tube: 0.02 }, rotation: [90, 0, 0], position: [0, 0.35, 0], material: { color: 'metal', metalness: 0.9, roughness: 0.4 } },
		{ id: 'boss', shape: { type: 'sphere', radius: 0.08 }, attach: { to: 'board', side: 'front', embed: 0.6 }, scale: [1, 1, 0.6], material: { color: 'metal', metalness: 0.9, roughness: 0.35 } }
	]
});

export const lantern = S('Lantern', {
	notes: 'Hand lantern ~0.4 m with a glowing glass core, metal frame and ring handle.',
	palette: { metal: '#3a3e46', glass: '#ffd98a' },
	settings: { resolution: 130, edges: 'sharp' },
	parts: [
		{ id: 'base', role: 'body', shape: { type: 'cylinder', height: 0.05, radius: 0.1, sides: 6, rounding: 0.008 }, position: [0, 0.025, 0], material: { color: 'metal', metalness: 0.7, roughness: 0.45 } },
		{ id: 'frame', shape: { type: 'cylinder', height: 0.21, radius: 0.085, sides: 6 }, attach: { to: 'base', side: 'top', embed: 0.2 }, material: { color: 'metal', metalness: 0.7, roughness: 0.45 } },
		{ id: 'pane', shape: { type: 'cylinder', height: 0.17, radius: 0.09, sides: 6 }, attach: { to: 'frame', side: 'center', embed: 1 }, rotation: [0, 30, 0], op: 'carve', material: { color: 'glass', emissive: 'glass', emissiveStrength: 1.8 } },
		{ id: 'glass', shape: { type: 'cylinder', height: 0.2, radius: 0.07, sides: 6 }, attach: { to: 'base', side: 'top', embed: 0.2 }, material: { color: 'glass', emissive: 'glass', emissiveStrength: 1.8, roughness: 0.2 } },
		{ id: 'cap', shape: { type: 'cone', height: 0.08, radius: 0.1, sides: 6 }, attach: { to: 'frame', side: 'top', embed: 0.2 }, material: { color: 'metal', metalness: 0.7, roughness: 0.45 } },
		{ id: 'handle', shape: { type: 'torus', radius: 0.045, tube: 0.008 }, attach: { to: 'cap', side: 'top', embed: 0.4 }, rotation: [90, 0, 0], material: { color: 'metal', metalness: 0.7, roughness: 0.45 } }
	]
});

export const MORE = [
	{ id: 'knight', title: 'Knight', tags: ['character', 'armor', 'medieval'], scene: knight },
	{ id: 'wizard', title: 'Wizard', tags: ['character', 'magic', 'fantasy'], scene: wizard },
	{ id: 'cat', title: 'Cat', tags: ['animal', 'pet', 'creature'], scene: cat },
	{ id: 'frog', title: 'Frog', tags: ['animal', 'creature', 'cute'], scene: frog },
	{ id: 'penguin', title: 'Penguin', tags: ['animal', 'bird', 'creature'], scene: penguin },
	{ id: 'teddy', title: 'Teddy bear', tags: ['toy', 'prop', 'cute'], scene: teddy },
	{ id: 'ghost', title: 'Ghost', tags: ['monster', 'spooky', 'creature'], scene: ghost },
	{ id: 'dragon', title: 'Baby dragon', tags: ['monster', 'fantasy', 'creature', 'flying'], scene: dragon },
	{ id: 'chicken', title: 'Chicken', tags: ['animal', 'bird', 'farm'], scene: chicken },
	{ id: 'truck', title: 'Pickup truck', tags: ['vehicle', 'car'], scene: truck },
	{ id: 'plane', title: 'Propeller plane', tags: ['vehicle', 'flying'], scene: plane },
	{ id: 'boat', title: 'Sailboat', tags: ['vehicle', 'water'], scene: boat },
	{ id: 'rocket', title: 'Cartoon rocket', tags: ['vehicle', 'sci-fi', 'effect'], scene: rocket },
	{ id: 'tower', title: 'Castle tower', tags: ['building', 'medieval', 'environment'], scene: tower },
	{ id: 'well', title: 'Well', tags: ['building', 'prop', 'village'], scene: well },
	{ id: 'lamppost', title: 'Lamp post', tags: ['prop', 'street', 'light'], scene: lamppost },
	{ id: 'tent', title: 'Tent', tags: ['prop', 'camp', 'environment'], scene: tent },
	{ id: 'pine', title: 'Pine tree', tags: ['nature', 'environment', 'plant'], scene: pine },
	{ id: 'cactus', title: 'Potted cactus', tags: ['nature', 'plant', 'prop'], scene: cactus },
	{ id: 'campfire', title: 'Campfire', tags: ['prop', 'fire', 'camp', 'effect'], scene: campfire },
	{ id: 'table', title: 'Wooden table', tags: ['furniture', 'prop', 'tavern'], scene: table },
	{ id: 'chair', title: 'Wooden chair', tags: ['furniture', 'prop', 'tavern'], scene: chair },
	{ id: 'shield', title: 'Round shield', tags: ['weapon', 'prop', 'item'], scene: shield },
	{ id: 'lantern', title: 'Lantern', tags: ['prop', 'light', 'item'], scene: lantern }
];
