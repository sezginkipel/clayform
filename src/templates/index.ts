/**
 * Hand-tuned starting points. Agents get far better results by picking the
 * closest template and editing it (recolor, swap, stretch, add) than by
 * writing proportions from scratch.
 */

import { FORMAT, type Scene } from '../core/schema.js';
import { MORE } from './more.js';

export interface Template {
	id: string;
	title: string;
	tags: string[];
	description: string;
	scene: Scene;
}

const S = (name: string, rest: Omit<Scene, 'format' | 'name'>): Scene => ({ format: FORMAT, name, ...rest });

const biped = S('Biped character', {
	notes: 'Stylized character ~1.1 m. Roles drive walk/idle/wave. Recolor via palette; swap head/hair shapes for species.',
	palette: { skin: '#f0c4a0', shirt: '#3f7cb3', pants: '#3a3f4b', shoes: '#5b3b2a', hair: '#4a2f22', eye: '#1f1d22' },
	settings: { resolution: 110, symmetry: 'x' },
	parts: [
		{ id: 'body', role: 'body', shape: { type: 'ellipsoid', radii: [0.19, 0.24, 0.15] }, position: [0, 0.62, 0], material: { color: 'shirt' } },
		{ id: 'head', role: 'head', shape: { type: 'sphere', radius: 0.2 }, attach: { to: 'body', side: 'top', embed: 0.18 }, blend: 0.05, material: { color: 'skin' } },
		{ id: 'hair', shape: { type: 'ellipsoid', radii: [0.212, 0.15, 0.214] }, attach: { to: 'head', side: 'top', embed: 1.1 }, position: [0, -0.02, -0.025], blend: 0.01, material: { color: 'hair', roughness: 0.85 } },
		{ id: 'eye', role: 'eye', shape: { type: 'ellipsoid', radii: [0.026, 0.038, 0.02] }, attach: { to: 'head', side: 'front', offset: [0.36, 0.02], embed: 0.55 }, mirror: true, material: { color: 'eye', roughness: 0.2 } },
		{ id: 'nose', shape: { type: 'sphere', radius: 0.028 }, attach: { to: 'head', side: 'front', offset: [0, -0.2], embed: 0.5 }, blend: 0.015, material: { color: 'skin' } },
		{ id: 'arm', role: 'arm', shape: { type: 'capsule', length: 0.36, radius: 0.052 }, attach: { to: 'body', side: 'left', offset: [0, 0.42], embed: 0.75 }, position: [0.07, -0.12, 0], rotation: [0, 0, 16], pivot: 'top', blend: 0.03, mirror: true, material: { color: 'shirt' } },
		{ id: 'hand', shape: { type: 'sphere', radius: 0.058 }, attach: { to: 'arm', side: 'bottom', embed: 0.55 }, blend: 0.02, material: { color: 'skin' } },
		{ id: 'leg', role: 'leg', shape: { type: 'capsule', length: 0.34, radius: 0.068 }, attach: { to: 'body', side: 'bottom', offset: [0.48, 0], embed: 0.62 }, blend: 0.03, mirror: true, material: { color: 'pants' } },
		{ id: 'foot', shape: { type: 'ellipsoid', radii: [0.068, 0.045, 0.105] }, attach: { to: 'leg', side: 'bottom', embed: 0.55 }, position: [0, 0, 0.035], blend: 0.02, material: { color: 'shoes' } }
	],
	clips: [{ id: 'walk', type: 'walk' }, { id: 'idle', type: 'idle' }]
});

const quadruped = S('Quadruped', {
	notes: 'Dog-like quadruped ~0.8 m long. Change ears, snout and tail for cat, fox, cow, dino.',
	palette: { fur: '#c98b52', belly: '#f1dcc0', nose: '#2a2224', eye: '#1c1a1e' },
	settings: { resolution: 110, symmetry: 'x' },
	parts: [
		{ id: 'body', role: 'body', shape: { type: 'capsule', length: 0.62, radius: 0.16 }, rotation: [90, 0, 0], position: [0, 0.42, 0], material: { color: 'fur' }, pattern: { kind: 'gradient', color: 'belly', scale: 0.12, amount: 0 } },
		{ id: 'neck', shape: { type: 'capsule', length: 0.24, radius: 0.09 }, attach: { to: 'body', side: 'front', offset: [0, 0.35], embed: 0.6 }, rotation: [-35, 0, 0], blend: 0.07, material: { color: 'fur' } },
		{ id: 'head', role: 'head', shape: { type: 'sphere', radius: 0.13 }, attach: { to: 'neck', side: 'top', embed: 0.35 }, position: [0, 0, 0.03], blend: 0.05, material: { color: 'fur' } },
		{ id: 'snout', shape: { type: 'ellipsoid', radii: [0.07, 0.06, 0.09] }, attach: { to: 'head', side: 'front', offset: [0, -0.3], embed: 0.6 }, blend: 0.04, material: { color: 'belly' } },
		{ id: 'nose', shape: { type: 'sphere', radius: 0.028 }, attach: { to: 'snout', side: 'front', offset: [0, 0.35], embed: 0.4 }, material: { color: 'nose', roughness: 0.3 } },
		{ id: 'eye', role: 'eye', shape: { type: 'sphere', radius: 0.022 }, attach: { to: 'head', side: 'front', offset: [0.42, 0.25], embed: 0.5 }, mirror: true, material: { color: 'eye', roughness: 0.2 } },
		{ id: 'ear', role: 'ear', shape: { type: 'ellipsoid', radii: [0.045, 0.085, 0.022] }, attach: { to: 'head', side: 'top', offset: [0.55, -0.1], embed: 0.3 }, rotation: [0, 0, -20], blend: 0.02, mirror: true, material: { color: 'fur' } },
		{ id: 'leg_front', role: 'leg', shape: { type: 'capsule', length: 0.34, radius: 0.055 }, attach: { to: 'body', side: 'bottom', offset: [0.55, 0.62], embed: 0.55 }, blend: 0.05, mirror: true, material: { color: 'fur' } },
		{ id: 'leg_back', role: 'leg', shape: { type: 'capsule', length: 0.34, radius: 0.06 }, attach: { to: 'body', side: 'bottom', offset: [0.55, -0.62], embed: 0.55 }, blend: 0.05, mirror: true, material: { color: 'fur' } },
		{ id: 'paw_front', shape: { type: 'ellipsoid', radii: [0.06, 0.035, 0.07] }, attach: { to: 'leg_front', side: 'bottom', embed: 0.5 }, position: [0, 0, 0.02], blend: 0.02, material: { color: 'belly' } },
		{ id: 'paw_back', shape: { type: 'ellipsoid', radii: [0.062, 0.035, 0.072] }, attach: { to: 'leg_back', side: 'bottom', embed: 0.5 }, position: [0, 0, 0.02], blend: 0.02, material: { color: 'belly' } },
		{ id: 'tail', role: 'tail', shape: { type: 'tube', points: [[0, 0, 0], [0, 0.09, -0.1], [0, 0.2, -0.16]], radius: [0.045, 0.035, 0.02] }, attach: { to: 'body', side: 'back', offset: [0, 0.5], embed: 0.2 }, blend: 0.03, material: { color: 'fur' } }
	],
	clips: [{ id: 'walk', type: 'walk' }, { id: 'idle', type: 'idle' }]
});

const bird = S('Bird', {
	notes: 'Round stylized bird ~0.35 m. fly and hop clips work out of the box.',
	palette: { feather: '#e2574c', wing: '#b83a33', belly: '#f6e2c8', beak: '#f2b233', eye: '#161418' },
	settings: { resolution: 110, symmetry: 'x' },
	parts: [
		{ id: 'body', role: 'body', shape: { type: 'ellipsoid', radii: [0.12, 0.13, 0.14] }, position: [0, 0.2, 0], material: { color: 'feather' } },
		{ id: 'chest', shape: { type: 'ellipsoid', radii: [0.085, 0.095, 0.05] }, attach: { to: 'body', side: 'front', offset: [0, -0.2], embed: 1.15 }, blend: 0.04, material: { color: 'belly' } },
		{ id: 'head', role: 'head', shape: { type: 'sphere', radius: 0.085 }, attach: { to: 'body', side: 'top', offset: [0, 0.35], embed: 0.4 }, blend: 0.05, material: { color: 'feather' } },
		{ id: 'beak', shape: { type: 'cone', height: 0.07, radius: 0.028 }, attach: { to: 'head', side: 'front', offset: [0, -0.1], align: true, embed: 0.3 }, material: { color: 'beak', roughness: 0.4 } },
		{ id: 'eye', role: 'eye', shape: { type: 'sphere', radius: 0.014 }, attach: { to: 'head', side: 'front', offset: [0.5, 0.25], embed: 0.4 }, mirror: true, material: { color: 'eye', roughness: 0.2 } },
		{ id: 'wing', role: 'wing', shape: { type: 'ellipsoid', radii: [0.022, 0.065, 0.095] }, attach: { to: 'body', side: 'left', offset: [-0.15, 0.1], embed: 0.75 }, rotation: [-15, 0, -6], pivot: 'attach', blend: 0.02, mirror: true, material: { color: 'wing' } },
		{ id: 'tail', role: 'tail', shape: { type: 'ellipsoid', radii: [0.06, 0.018, 0.08] }, attach: { to: 'body', side: 'back', offset: [0, 0.15], embed: 0.45 }, rotation: [-30, 0, 0], blend: 0.02, material: { color: 'wing' } },
		{ id: 'leg', role: 'leg', shape: { type: 'capsule', length: 0.08, radius: 0.012 }, attach: { to: 'body', side: 'bottom', offset: [0.35, 0], embed: 0.3 }, mirror: true, material: { color: 'beak' } },
		{ id: 'toes', shape: { type: 'ellipsoid', radii: [0.02, 0.01, 0.035] }, attach: { to: 'leg', side: 'bottom', embed: 0.5 }, position: [0, 0, 0.012], material: { color: 'beak' } }
	],
	clips: [{ id: 'fly', type: 'fly' }, { id: 'hop', type: 'hop' }]
});

const fish = S('Fish', {
	notes: 'Stylized fish ~0.5 m, faces +Z. swim clip sways the tail.',
	palette: { scale: '#f08a2c', fin: '#f4c55a', eye: '#141214', white: '#fbf6ee' },
	settings: { resolution: 110, symmetry: 'x', ground: 'none' },
	parts: [
		{ id: 'body', role: 'body', shape: { type: 'ellipsoid', radii: [0.08, 0.13, 0.22] }, position: [0, 0.3, 0], material: { color: 'scale' }, pattern: { kind: 'stripes', color: 'white', scale: 0.06, amount: 0.9 } },
		{ id: 'tail', role: 'tail', shape: { type: 'prism', size: [0.18, 0.12, 0.02], rounding: 0.006 }, attach: { to: 'body', side: 'back', embed: 0.3 }, rotation: [0, 90, 90], pivot: 'attach', blend: 0.03, material: { color: 'fin' } },
		{ id: 'fin_top', shape: { type: 'prism', size: [0.16, 0.08, 0.015], rounding: 0.005 }, attach: { to: 'body', side: 'top', offset: [0, -0.1], embed: 0.3 }, rotation: [0, 90, 0], blend: 0.02, material: { color: 'fin' } },
		{ id: 'fin', role: 'wing', shape: { type: 'ellipsoid', radii: [0.012, 0.035, 0.06] }, attach: { to: 'body', side: 'left', offset: [0.3, -0.3], embed: 0.4 }, rotation: [-30, 0, -20], blend: 0.015, mirror: true, material: { color: 'fin' } },
		{ id: 'eye', role: 'eye', shape: { type: 'sphere', radius: 0.022 }, attach: { to: 'body', side: 'left', offset: [0.62, 0.25], embed: 0.4 }, mirror: true, material: { color: 'eye', roughness: 0.15 } },
		{ id: 'mouth', shape: { type: 'ellipsoid', radii: [0.03, 0.012, 0.03] }, attach: { to: 'body', side: 'front', offset: [0, -0.15], embed: 0.6 }, op: 'carve', blend: 0.01, material: { color: '#6a2d1c' } }
	],
	clips: [{ id: 'swim', type: 'swim' }]
});

const car = S('Toy car', {
	notes: 'Chunky toy car ~1.2 m. Wheels are separate so they spin in the drive clip.',
	palette: { paint: '#d64533', trim: '#2b2d33', glass: '#9fd3e6', tire: '#26272b', rim: '#d9d9de', light: '#fff2b0' },
	settings: { resolution: 120, symmetry: 'x' },
	parts: [
		{ id: 'chassis', role: 'body', shape: { type: 'box', size: [0.62, 0.26, 1.2], rounding: 0.1 }, position: [0, 0.32, 0], material: { color: 'paint', roughness: 0.35 } },
		{ id: 'cabin', shape: { type: 'box', size: [0.52, 0.26, 0.6], rounding: 0.1 }, attach: { to: 'chassis', side: 'top', offset: [0, -0.12], embed: 0.35 }, blend: 0.04, material: { color: 'paint', roughness: 0.35 } },
		{ id: 'windshield', shape: { type: 'box', size: [0.42, 0.15, 0.1], rounding: 0.025 }, attach: { to: 'cabin', side: 'front', offset: [0, 0.12], embed: 0.8 }, op: 'carve', material: { color: 'glass', roughness: 0.1, metalness: 0.2 } },
		{ id: 'window', shape: { type: 'box', size: [0.1, 0.14, 0.42], rounding: 0.025 }, attach: { to: 'cabin', side: 'left', offset: [0, 0.12], embed: 0.8 }, op: 'carve', mirror: true, material: { color: 'glass', roughness: 0.1, metalness: 0.2 } },
		{ id: 'bumper', shape: { type: 'box', size: [0.64, 0.08, 0.08], rounding: 0.035 }, attach: { to: 'chassis', side: 'front', offset: [0, -0.45], embed: 0.5 }, material: { color: 'trim', roughness: 0.5 } },
		{ id: 'bumper_back', shape: { type: 'box', size: [0.64, 0.08, 0.08], rounding: 0.035 }, attach: { to: 'chassis', side: 'back', offset: [0, -0.45], embed: 0.5 }, material: { color: 'trim', roughness: 0.5 } },
		{ id: 'headlight', shape: { type: 'cylinder', height: 0.03, radius: 0.045 }, attach: { to: 'chassis', side: 'front', offset: [0.62, 0.15], embed: 0.4 }, rotation: [90, 0, 0], mirror: true, material: { color: 'light', emissive: 'light', emissiveStrength: 1.1 } },
		{ id: 'wheel_front', role: 'wheel', shape: { type: 'cylinder', height: 0.12, radius: 0.15, rounding: 0.04 }, attach: { to: 'chassis', side: 'left', offset: [0.62, -0.55], embed: 0.55 }, rotation: [0, 0, 90], separate: true, mirror: true, material: { color: 'tire', roughness: 0.9 } },
		{ id: 'wheel_back', role: 'wheel', shape: { type: 'cylinder', height: 0.12, radius: 0.15, rounding: 0.04 }, attach: { to: 'chassis', side: 'left', offset: [-0.62, -0.55], embed: 0.55 }, rotation: [0, 0, 90], separate: true, mirror: true, material: { color: 'tire', roughness: 0.9 } },
		{ id: 'hubcap_front', shape: { type: 'cylinder', height: 0.02, radius: 0.07, rounding: 0.008 }, attach: { to: 'wheel_front', side: 'left', embed: 0.5 }, rotation: [0, 0, 90], separate: true, material: { color: 'rim', metalness: 0.9, roughness: 0.3 } },
		{ id: 'hubcap_back', shape: { type: 'cylinder', height: 0.02, radius: 0.07, rounding: 0.008 }, attach: { to: 'wheel_back', side: 'left', embed: 0.5 }, rotation: [0, 0, 90], separate: true, material: { color: 'rim', metalness: 0.9, roughness: 0.3 } }
	],
	clips: [{ id: 'drive', type: 'drive' }]
});

const house = S('Cottage', {
	notes: 'Small cottage ~2.4 m tall. Door and windows are carved; chimney on the roof.',
	palette: { wall: '#efe3cf', roof: '#b4533b', wood: '#7a4d30', glass: '#8ec6dd', stone: '#8f8a84' },
	settings: { resolution: 120, edges: 'sharp' },
	parts: [
		{ id: 'walls', role: 'body', shape: { type: 'box', size: [2, 1.4, 1.6], rounding: 0.04 }, position: [0, 0.7, 0], material: { color: 'wall', roughness: 0.9 }, detail: { amount: 0.006, scale: 0.06 } },
		{ id: 'roof', shape: { type: 'prism', size: [2.35, 0.95, 1.9], rounding: 0.03 }, attach: { to: 'walls', side: 'top', embed: 0.05 }, rotation: [0, 90, 0], scale: [1, 1, 1.22], material: { color: 'roof', roughness: 0.8 } },
		{ id: 'door', shape: { type: 'box', size: [0.46, 0.82, 0.3], rounding: 0.05 }, attach: { to: 'walls', side: 'front', offset: [-0.35, -0.42], embed: 0.8 }, op: 'carve', material: { color: 'wood' } },
		{ id: 'window', shape: { type: 'box', size: [0.4, 0.36, 0.3], rounding: 0.03 }, attach: { to: 'walls', side: 'front', offset: [0.45, 0.12], embed: 0.8 }, op: 'carve', material: { color: 'glass', roughness: 0.15 } },
		{ id: 'window_side', shape: { type: 'box', size: [0.3, 0.36, 0.4], rounding: 0.03 }, attach: { to: 'walls', side: 'left', offset: [0, 0.12], embed: 0.8 }, op: 'carve', material: { color: 'glass', roughness: 0.15 } },
		{ id: 'chimney', shape: { type: 'box', size: [0.26, 0.6, 0.26], rounding: 0.02 }, attach: { to: 'roof', side: 'top', offset: [0.55, 0.35], embed: 0.75 }, material: { color: 'stone' }, detail: { amount: 0.008, scale: 0.05 } },
		{ id: 'step', shape: { type: 'box', size: [0.7, 0.1, 0.3], rounding: 0.03 }, attach: { to: 'walls', side: 'front', offset: [-0.35, -0.93], embed: 0.4 }, material: { color: 'stone' } }
	]
});

const tree = S('Tree', {
	notes: 'Stylized tree ~2.6 m: tapered trunk + three canopy blobs with surface noise.',
	palette: { bark: '#6f4a2e', leaf: '#4f9a45', leaf_dark: '#3b7a37' },
	settings: { resolution: 110 },
	parts: [
		{ id: 'trunk', role: 'body', shape: { type: 'tube', points: [[0, 0, 0], [0.03, 0.6, 0], [-0.02, 1.2, 0.02]], radius: [0.16, 0.11, 0.09] }, material: { color: 'bark', roughness: 0.95 }, detail: { amount: 0.01, scale: 0.05 } },
		{ id: 'root', shape: { type: 'ellipsoid', radii: [0.2, 0.07, 0.2] }, position: [0, 0.07, 0], blend: 0.12, material: { color: 'bark', roughness: 0.95 } },
		{ id: 'canopy', shape: { type: 'sphere', radius: 0.62 }, position: [0, 1.62, 0], blend: 0.1, material: { color: 'leaf', roughness: 0.9 }, pattern: { kind: 'noise', color: 'leaf_dark', scale: 0.25, amount: 0.7 }, detail: { amount: 0.05, scale: 0.18 } },
		{ id: 'canopy_left', shape: { type: 'sphere', radius: 0.42 }, attach: { to: 'canopy', side: 'left', offset: [0.2, -0.3], embed: 0.8 }, blend: 0.14, material: { color: 'leaf', roughness: 0.9 }, pattern: { kind: 'noise', color: 'leaf_dark', scale: 0.25, amount: 0.7 }, detail: { amount: 0.05, scale: 0.18 } },
		{ id: 'canopy_right', shape: { type: 'sphere', radius: 0.46 }, attach: { to: 'canopy', side: 'right', offset: [-0.25, -0.2], embed: 0.8 }, blend: 0.14, material: { color: 'leaf', roughness: 0.9 }, pattern: { kind: 'noise', color: 'leaf_dark', scale: 0.25, amount: 0.7 }, detail: { amount: 0.05, scale: 0.18 } }
	],
	clips: [{ id: 'sway', type: 'idle' }]
});

const rock = S('Rock', {
	notes: 'Boulder with a smaller stone, noise displacement, moss and a flattened base.',
	palette: { stone: '#8d8a85', moss: '#6e8a4b' },
	settings: { resolution: 96 },
	parts: [
		{ id: 'boulder', role: 'body', shape: { type: 'ellipsoid', radii: [0.5, 0.34, 0.42] }, rotation: [0, 20, 6], material: { color: 'stone', roughness: 0.95 }, pattern: { kind: 'noise', color: 'moss', scale: 0.3, amount: 0.35 }, detail: { amount: 0.045, scale: 0.16 } },
		{ id: 'stone', shape: { type: 'ellipsoid', radii: [0.22, 0.16, 0.2] }, attach: { to: 'boulder', side: 'left', offset: [0.35, 0.15], embed: 0.5 }, rotation: [10, -15, 0], blend: 0.03, material: { color: 'stone', roughness: 0.95 }, detail: { amount: 0.03, scale: 0.12 } }
	],
	sculpts: [{ id: 'base', kind: 'flatten', at: { point: [0, -0.34, 0] }, normal: [0, -1, 0], radius: 1.3, amount: 0.1 }]
});

const mushroom = S('Mushroom', {
	notes: 'Toadstool ~0.5 m with spotted cap.',
	palette: { cap: '#d63d34', spot: '#fbf4e6', stem: '#f1e6d2', gill: '#d8c6a9' },
	settings: { resolution: 100 },
	parts: [
		{ id: 'cap', role: 'head', shape: { type: 'ellipsoid', radii: [0.26, 0.15, 0.26] }, attach: { to: 'stem', side: 'top', embed: 0.55 }, material: { color: 'cap', roughness: 0.45 }, pattern: { kind: 'spots', color: 'spot', scale: 0.08, amount: 1 } },
		{ id: 'underside', shape: { type: 'ellipsoid', radii: [0.23, 0.06, 0.23] }, attach: { to: 'cap', side: 'bottom', embed: 0.7 }, op: 'carve', blend: 0.03, material: { color: 'gill' } },
		{ id: 'stem', role: 'body', shape: { type: 'tube', points: [[0, 0, 0], [0.01, 0.16, 0], [0, 0.3, 0.01]], radius: [0.085, 0.065, 0.06] }, blend: 0.03, material: { color: 'stem' } }
	]
});

const sword = S('Sword', {
	notes: 'Hero sword ~1 m, lying along Y. Blade metal, gold guard, leather grip.',
	palette: { steel: '#c9ced6', gold: '#d9a441', leather: '#6b3f26', gem: '#4bb0e0' },
	settings: { resolution: 200, ground: 'auto', symmetry: 'x', edges: 'sharp' },
	parts: [
		{ id: 'grip', role: 'body', shape: { type: 'cylinder', height: 0.2, radius: 0.022, rounding: 0.01 }, position: [0, 0.14, 0], material: { color: 'leather', roughness: 0.85 }, pattern: { kind: 'stripes', color: '#4e2c1a', scale: 0.02, amount: 0.8 } },
		{ id: 'pommel', shape: { type: 'sphere', radius: 0.035 }, attach: { to: 'grip', side: 'bottom', embed: 0.35 }, material: { color: 'gold', metalness: 1, roughness: 0.3 } },
		{ id: 'guard', shape: { type: 'box', size: [0.26, 0.035, 0.05], rounding: 0.016 }, attach: { to: 'grip', side: 'top', embed: 0.2 }, material: { color: 'gold', metalness: 1, roughness: 0.3 } },
		{ id: 'gem', shape: { type: 'sphere', radius: 0.018 }, attach: { to: 'guard', side: 'front', embed: 0.5 }, material: { color: 'gem', roughness: 0.1, emissive: 'gem', emissiveStrength: 0.6 } },
		{ id: 'blade', shape: { type: 'box', size: [0.07, 0.62, 0.014], rounding: 0.006 }, attach: { to: 'guard', side: 'top', embed: 0.1 }, material: { color: 'steel', metalness: 1, roughness: 0.22 } },
		{ id: 'tip', shape: { type: 'prism', size: [0.07, 0.12, 0.014], rounding: 0.003 }, attach: { to: 'blade', side: 'top', embed: 0.35 }, blend: 0.004, material: { color: 'steel', metalness: 1, roughness: 0.22 } }
	],
	sculpts: [{ id: 'fuller', kind: 'crease', at: { to: 'blade', side: 'front', offset: [0, -0.8] }, to: { to: 'blade', side: 'front', offset: [0, 0.8] }, radius: 0.008, amount: 0.004 }]
});

const chest = S('Treasure chest', {
	notes: 'Wooden chest ~0.9 m: half-round lid, metal bands, gold lock. Carve order matters — lid_cut only trims the lid parts listed before it.',
	palette: { wood: '#8a5a34', wood_dark: '#6e4527', band: '#6d6f75', gold: '#e0b04a' },
	settings: { resolution: 120, symmetry: 'x', edges: 'sharp' },
	parts: [
		{ id: 'lid', shape: { type: 'cylinder', height: 0.9, radius: 0.28, rounding: 0.03 }, attach: { to: 'box', side: 'top', embed: 1 }, rotation: [0, 0, 90], scale: [0.6, 1, 1], material: { color: 'wood', roughness: 0.85 }, pattern: { kind: 'stripes', color: 'wood_dark', scale: 0.05, amount: 0.45, axis: 'y' } },
		{ id: 'lid_band', shape: { type: 'cylinder', height: 0.07, radius: 0.3, rounding: 0.008 }, attach: { to: 'box', side: 'top', offset: [0.66, 0], embed: 1 }, rotation: [0, 0, 90], scale: [0.6, 1, 1], mirror: true, material: { color: 'band', metalness: 0.9, roughness: 0.4 } },
		{ id: 'lid_cut', shape: { type: 'box', size: [1.2, 0.4, 0.8] }, attach: { to: 'box', side: 'top', embed: 1 }, position: [0, -0.2, 0], op: 'carve' },
		{ id: 'box', role: 'body', shape: { type: 'box', size: [0.9, 0.46, 0.56], rounding: 0.03 }, position: [0, 0.23, 0], material: { color: 'wood', roughness: 0.85 }, pattern: { kind: 'stripes', color: 'wood_dark', scale: 0.05, amount: 0.45 } },
		{ id: 'band', shape: { type: 'box', size: [0.07, 0.5, 0.6], rounding: 0.008 }, attach: { to: 'box', side: 'center', embed: 1 }, position: [0.3, 0.004, 0], mirror: true, material: { color: 'band', metalness: 0.9, roughness: 0.4 } },
		{ id: 'lock', shape: { type: 'box', size: [0.1, 0.12, 0.04], rounding: 0.015 }, attach: { to: 'box', side: 'front', offset: [0, 0.82], embed: 0.4 }, material: { color: 'gold', metalness: 1, roughness: 0.3 } }
	]
});

const barrel = S('Barrel', {
	notes: 'Wooden barrel ~0.8 m: an ellipsoid trimmed flat by intersect, vertical staves, iron hoops.',
	palette: { wood: '#9a6a3f', wood_dark: '#7a5230', lid: '#4a2e18', iron: '#5c5e63' },
	settings: { resolution: 110 },
	parts: [
		{ id: 'belly', role: 'body', shape: { type: 'ellipsoid', radii: [0.33, 0.52, 0.33] }, position: [0, 0.4, 0], material: { color: 'wood', roughness: 0.85 }, pattern: { kind: 'stripes', color: 'wood_dark', scale: 0.07, amount: 0.55, axis: 'around' } },
		{ id: 'trim', shape: { type: 'cylinder', height: 0.8, radius: 0.5 }, position: [0, 0.4, 0], op: 'intersect', blend: 0.015 },
		{ id: 'head', shape: { type: 'cylinder', height: 0.06, radius: 0.19, rounding: 0.01 }, position: [0, 0.8, 0], op: 'carve', material: { color: 'lid' } },
		{ id: 'hoop_top', shape: { type: 'torus', radius: 0.279, tube: 0.017 }, position: [0, 0.68, 0], material: { color: 'iron', metalness: 0.9, roughness: 0.45 } },
		{ id: 'hoop_mid', shape: { type: 'torus', radius: 0.33, tube: 0.017 }, position: [0, 0.4, 0], material: { color: 'iron', metalness: 0.9, roughness: 0.45 } },
		{ id: 'hoop_bottom', shape: { type: 'torus', radius: 0.279, tube: 0.017 }, position: [0, 0.12, 0], material: { color: 'iron', metalness: 0.9, roughness: 0.45 } }
	]
});

const potion = S('Potion', {
	notes: 'Glowing potion bottle ~0.3 m.',
	palette: { glass: '#cfe7ef', liquid: '#9b5cff', cork: '#a8784c' },
	settings: { resolution: 120 },
	parts: [
		{ id: 'bottle', role: 'body', shape: { type: 'sphere', radius: 0.11 }, position: [0, 0.11, 0], material: { color: 'liquid', roughness: 0.1, emissive: 'liquid', emissiveStrength: 0.9 } },
		{ id: 'neck', shape: { type: 'cylinder', height: 0.1, radius: 0.035, rounding: 0.01 }, attach: { to: 'bottle', side: 'top', embed: 0.35 }, blend: 0.03, material: { color: 'glass', roughness: 0.05 } },
		{ id: 'rim', shape: { type: 'torus', radius: 0.036, tube: 0.01 }, attach: { to: 'neck', side: 'top', embed: 0.5 }, material: { color: 'glass', roughness: 0.05 } },
		{ id: 'cork', shape: { type: 'cylinder', height: 0.05, radius: 0.03, rounding: 0.008 }, attach: { to: 'neck', side: 'top', embed: 0.5 }, material: { color: 'cork', roughness: 0.9 } }
	],
	effects: [{ id: 'sparkle', preset: 'magic', count: 60, emitter: { shape: 'sphere', size: 0.12 } }]
});

const spaceship = S('Spaceship', {
	notes: 'Arcade fighter ~1.6 m long, faces +Z. Glowing engines.',
	palette: { hull: '#e9ecef', accent: '#2f6fdb', glass: '#27354d', glow: '#58c8ff' },
	settings: { resolution: 130, symmetry: 'x' },
	parts: [
		{ id: 'hull', role: 'body', shape: { type: 'capsule', length: 1.5, radius: 0.2 }, rotation: [90, 0, 0], position: [0, 0.5, 0], scale: [1, 1, 0.8], material: { color: 'hull', roughness: 0.3, metalness: 0.3 } },
		{ id: 'nose', shape: { type: 'cone', height: 0.4, radius: 0.16 }, attach: { to: 'hull', side: 'front', embed: 0.55, align: true }, blend: 0.1, material: { color: 'hull', roughness: 0.3, metalness: 0.3 } },
		{ id: 'cockpit', shape: { type: 'ellipsoid', radii: [0.13, 0.1, 0.26] }, attach: { to: 'hull', side: 'top', offset: [0, 0.25], embed: 0.55 }, blend: 0.02, material: { color: 'glass', roughness: 0.05, metalness: 0.5 } },
		{ id: 'wing', shape: { type: 'prism', size: [0.9, 0.62, 0.05], rounding: 0.012 }, attach: { to: 'hull', side: 'left', offset: [-0.35, -0.1], embed: 0.9 }, rotation: [90, 0, 0], position: [0.1, 0, 0], blend: 0.05, mirror: true, material: { color: 'accent', roughness: 0.35, metalness: 0.3 } },
		{ id: 'fin', shape: { type: 'prism', size: [0.34, 0.26, 0.045], rounding: 0.01 }, attach: { to: 'hull', side: 'top', offset: [0, -0.65], embed: 0.4 }, rotation: [0, 90, 0], blend: 0.03, material: { color: 'accent', roughness: 0.35 } },
		{ id: 'engine', shape: { type: 'cylinder', height: 0.3, radius: 0.08, rounding: 0.02 }, attach: { to: 'hull', side: 'back', offset: [0.5, -0.1], embed: 0.8 }, rotation: [90, 0, 0], mirror: true, blend: 0.03, material: { color: 'hull', metalness: 0.6, roughness: 0.35 } },
		{ id: 'flame', shape: { type: 'cylinder', height: 0.04, radius: 0.06 }, attach: { to: 'engine', side: 'back', embed: 0.6 }, rotation: [90, 0, 0], material: { color: 'glow', emissive: 'glow', emissiveStrength: 3 } }
	],
	clips: [{ id: 'hover', type: 'hover' }]
});

const robot = S('Robot', {
	notes: 'Boxy robot ~1.2 m with glowing eyes and antenna.',
	palette: { metal: '#c7ccd4', dark: '#3a3e46', glow: '#5ff0c8', accent: '#f0a33a' },
	settings: { resolution: 120, symmetry: 'x', edges: 'sharp' },
	parts: [
		{ id: 'torso', role: 'body', shape: { type: 'box', size: [0.46, 0.44, 0.3], rounding: 0.07 }, position: [0, 0.64, 0], material: { color: 'metal', metalness: 0.7, roughness: 0.35 } },
		{ id: 'chest_light', shape: { type: 'cylinder', height: 0.03, radius: 0.05 }, attach: { to: 'torso', side: 'front', offset: [0, 0.3], embed: 0.5 }, rotation: [90, 0, 0], material: { color: 'accent', emissive: 'accent', emissiveStrength: 1.5 } },
		{ id: 'head', role: 'head', shape: { type: 'box', size: [0.34, 0.26, 0.28], rounding: 0.06 }, attach: { to: 'torso', side: 'top', embed: -0.05 }, material: { color: 'metal', metalness: 0.7, roughness: 0.35 } },
		{ id: 'neck', shape: { type: 'cylinder', height: 0.08, radius: 0.06 }, attach: { to: 'torso', side: 'top', embed: 0.5 }, material: { color: 'dark', metalness: 0.6, roughness: 0.5 } },
		{ id: 'visor', shape: { type: 'box', size: [0.26, 0.08, 0.04], rounding: 0.03 }, attach: { to: 'head', side: 'front', offset: [0, 0.1], embed: 0.6 }, material: { color: 'dark', roughness: 0.2 } },
		{ id: 'eye', role: 'eye', shape: { type: 'sphere', radius: 0.025 }, attach: { to: 'visor', side: 'front', offset: [0.45, 0], embed: 0.6 }, mirror: true, material: { color: 'glow', emissive: 'glow', emissiveStrength: 2.5 } },
		{ id: 'antenna', shape: { type: 'cylinder', height: 0.14, radius: 0.015 }, attach: { to: 'head', side: 'top', embed: 0.2 }, material: { color: 'dark', metalness: 0.6 } },
		{ id: 'antenna_tip', shape: { type: 'sphere', radius: 0.028 }, attach: { to: 'antenna', side: 'top', embed: 0.3 }, material: { color: 'accent', emissive: 'accent', emissiveStrength: 1.5 } },
		{ id: 'arm', role: 'arm', shape: { type: 'capsule', length: 0.38, radius: 0.05 }, attach: { to: 'torso', side: 'left', offset: [0, 0.55], embed: 0.4 }, position: [0.035, -0.14, 0], rotation: [0, 0, 6], pivot: 'top', mirror: true, material: { color: 'dark', metalness: 0.6, roughness: 0.45 } },
		{ id: 'claw', shape: { type: 'box', size: [0.1, 0.09, 0.1], rounding: 0.035 }, attach: { to: 'arm', side: 'bottom', embed: 0.4 }, material: { color: 'metal', metalness: 0.7, roughness: 0.35 } },
		{ id: 'leg', role: 'leg', shape: { type: 'box', size: [0.12, 0.34, 0.14], rounding: 0.04 }, attach: { to: 'torso', side: 'bottom', offset: [0.5, 0], embed: 0.15 }, mirror: true, material: { color: 'dark', metalness: 0.6, roughness: 0.45 } },
		{ id: 'foot', shape: { type: 'box', size: [0.15, 0.07, 0.22], rounding: 0.03 }, attach: { to: 'leg', side: 'bottom', embed: 0.4 }, position: [0, 0, 0.03], material: { color: 'metal', metalness: 0.7, roughness: 0.35 } }
	],
	clips: [{ id: 'walk', type: 'walk' }, { id: 'wave', type: 'wave' }]
});

const crystal = S('Crystal cluster', {
	notes: 'Glowing crystal cluster ~0.7 m on a rock base.',
	palette: { crystal: '#7fd8ff', core: '#3a8fe0', rock: '#6f6a66' },
	settings: { resolution: 130, edges: 'sharp' },
	parts: [
		{ id: 'base', role: 'body', shape: { type: 'ellipsoid', radii: [0.34, 0.12, 0.3] }, material: { color: 'rock', roughness: 0.95 }, detail: { amount: 0.025, scale: 0.08 } },
		{ id: 'spire', shape: { type: 'cone', height: 0.62, radius: 0.1, topRadius: 0.0, rounding: 0.01, sides: 6 }, attach: { to: 'base', side: 'top', embed: 0.25 }, material: { color: 'crystal', roughness: 0.1, emissive: 'core', emissiveStrength: 1.2 } },
		{ id: 'shard_a', shape: { type: 'cone', height: 0.4, radius: 0.07, rounding: 0.008, sides: 6 }, attach: { to: 'base', side: 'top', offset: [0.5, 0.3], embed: 0.3 }, rotation: [10, 0, -24], material: { color: 'crystal', roughness: 0.1, emissive: 'core', emissiveStrength: 1.2 } },
		{ id: 'shard_b', shape: { type: 'cone', height: 0.34, radius: 0.06, rounding: 0.008, sides: 5 }, attach: { to: 'base', side: 'top', offset: [-0.5, -0.2], embed: 0.3 }, rotation: [-14, 0, 26], material: { color: 'crystal', roughness: 0.1, emissive: 'core', emissiveStrength: 1.2 } },
		{ id: 'shard_c', shape: { type: 'cone', height: 0.26, radius: 0.05, rounding: 0.006, sides: 6 }, attach: { to: 'base', side: 'top', offset: [0.1, -0.6], embed: 0.3 }, rotation: [-30, 0, 5], material: { color: 'crystal', roughness: 0.1, emissive: 'core', emissiveStrength: 1.2 } }
	]
});

const torch = S('Torch', {
	notes: 'Wall-less standing torch ~0.7 m with a fire effect on top.',
	palette: { wood: '#7a5032', iron: '#4d4f55', ember: '#ff8a3a' },
	settings: { resolution: 110 },
	parts: [
		{ id: 'handle', role: 'body', shape: { type: 'cone', height: 0.55, radius: 0.028, topRadius: 0.045, rounding: 0.01 }, position: [0, 0.275, 0], material: { color: 'wood', roughness: 0.9 } },
		{ id: 'bowl', shape: { type: 'cylinder', height: 0.1, radius: 0.08, rounding: 0.015 }, attach: { to: 'handle', side: 'top', embed: 0.5 }, material: { color: 'iron', metalness: 0.8, roughness: 0.5 } },
		{ id: 'coals', shape: { type: 'sphere', radius: 0.06 }, attach: { to: 'bowl', side: 'top', embed: 0.6 }, material: { color: 'ember', emissive: 'ember', emissiveStrength: 2 }, detail: { amount: 0.01, scale: 0.02 } }
	],
	effects: [{ id: 'flame', preset: 'fire', at: { to: 'coals', side: 'top' } }]
});

const slime = S('Slime', {
	notes: 'Blob creature ~0.5 m sculpted with inflate/dent — a sculpting example.',
	palette: { goo: '#6fd06a', eye: '#1a1a1e', white: '#ffffff' },
	settings: { resolution: 120, symmetry: 'x' },
	parts: [
		{ id: 'blob', role: 'body', shape: { type: 'ellipsoid', radii: [0.28, 0.22, 0.26] }, position: [0, 0.2, 0], material: { color: 'goo', roughness: 0.25 } },
		{ id: 'puddle', shape: { type: 'ellipsoid', radii: [0.34, 0.06, 0.32] }, position: [0, 0.04, 0], blend: 0.1, material: { color: 'goo', roughness: 0.25 } },
		{ id: 'eye_white', role: 'eye', shape: { type: 'sphere', radius: 0.055 }, attach: { to: 'blob', side: 'front', offset: [0.36, 0.3], embed: 0.5 }, mirror: true, material: { color: 'white', roughness: 0.2 } },
		{ id: 'pupil', shape: { type: 'sphere', radius: 0.028 }, attach: { to: 'eye_white', side: 'front', embed: 0.55 }, material: { color: 'eye', roughness: 0.1 } }
	],
	sculpts: [
		{ id: 'top_bump', kind: 'inflate', at: { to: 'blob', side: 'top', offset: [0.2, -0.1] }, radius: 0.16, amount: 0.05 },
		{ id: 'mouth', kind: 'crease', at: { to: 'blob', side: 'front', offset: [-0.25, -0.15] }, to: { to: 'blob', side: 'front', offset: [0.25, -0.15] }, radius: 0.02, amount: 0.015 }
	],
	clips: [{ id: 'hop', type: 'hop' }]
});

const snowman = S('Snowman', {
	notes: 'Classic three-ball snowman ~1.6 m.',
	palette: { snow: '#f3f5f8', carrot: '#ea7a2e', coal: '#232326', stick: '#6b4a2b', scarf: '#c8403a' },
	settings: { resolution: 100, symmetry: 'x' },
	parts: [
		{ id: 'base', role: 'body', shape: { type: 'sphere', radius: 0.4 }, material: { color: 'snow', roughness: 0.9 } },
		{ id: 'torso', shape: { type: 'sphere', radius: 0.3 }, attach: { to: 'base', side: 'top', embed: 0.4 }, blend: 0.06, material: { color: 'snow', roughness: 0.9 } },
		{ id: 'head', role: 'head', shape: { type: 'sphere', radius: 0.2 }, attach: { to: 'torso', side: 'top', embed: 0.3 }, blend: 0.04, material: { color: 'snow', roughness: 0.9 } },
		{ id: 'scarf', shape: { type: 'torus', radius: 0.15, tube: 0.045 }, attach: { to: 'torso', side: 'top', embed: 1 }, position: [0, 0.02, 0], material: { color: 'scarf', roughness: 0.9 } },
		{ id: 'nose', shape: { type: 'cone', height: 0.18, radius: 0.035 }, attach: { to: 'head', side: 'front', align: true, embed: 0.1 }, material: { color: 'carrot' } },
		{ id: 'eye', shape: { type: 'sphere', radius: 0.025 }, attach: { to: 'head', side: 'front', offset: [0.4, 0.3], embed: 0.4 }, mirror: true, material: { color: 'coal' } },
		{ id: 'button', shape: { type: 'sphere', radius: 0.03 }, attach: { to: 'torso', side: 'front', offset: [0, -0.1], embed: 0.4 }, material: { color: 'coal' } },
		{ id: 'arm', role: 'arm', shape: { type: 'capsule', length: 0.45, radius: 0.026 }, attach: { to: 'torso', side: 'left', align: true, embed: 0.9 }, mirror: true, material: { color: 'stick' } }
	],
	clips: [{ id: 'wave', type: 'wave' }]
});

export const TEMPLATES: Template[] = [
	{ id: 'biped', title: 'Biped character', tags: ['character', 'human', 'hero', 'npc'], description: biped.notes!, scene: biped },
	{ id: 'quadruped', title: 'Quadruped', tags: ['animal', 'dog', 'cat', 'creature'], description: quadruped.notes!, scene: quadruped },
	{ id: 'bird', title: 'Bird', tags: ['animal', 'flying', 'creature'], description: bird.notes!, scene: bird },
	{ id: 'fish', title: 'Fish', tags: ['animal', 'water', 'creature'], description: fish.notes!, scene: fish },
	{ id: 'slime', title: 'Slime', tags: ['creature', 'monster', 'blob', 'sculpt'], description: slime.notes!, scene: slime },
	{ id: 'robot', title: 'Robot', tags: ['character', 'mech', 'sci-fi'], description: robot.notes!, scene: robot },
	{ id: 'snowman', title: 'Snowman', tags: ['character', 'winter', 'prop'], description: snowman.notes!, scene: snowman },
	{ id: 'car', title: 'Toy car', tags: ['vehicle', 'car'], description: car.notes!, scene: car },
	{ id: 'spaceship', title: 'Spaceship', tags: ['vehicle', 'sci-fi', 'flying'], description: spaceship.notes!, scene: spaceship },
	{ id: 'house', title: 'Cottage', tags: ['building', 'house', 'environment'], description: house.notes!, scene: house },
	{ id: 'tree', title: 'Tree', tags: ['nature', 'environment', 'plant'], description: tree.notes!, scene: tree },
	{ id: 'rock', title: 'Rock', tags: ['nature', 'environment'], description: rock.notes!, scene: rock },
	{ id: 'mushroom', title: 'Mushroom', tags: ['nature', 'prop'], description: mushroom.notes!, scene: mushroom },
	{ id: 'crystal', title: 'Crystal cluster', tags: ['nature', 'magic', 'prop'], description: crystal.notes!, scene: crystal },
	{ id: 'sword', title: 'Sword', tags: ['weapon', 'prop', 'item'], description: sword.notes!, scene: sword },
	{ id: 'chest', title: 'Treasure chest', tags: ['prop', 'container', 'item'], description: chest.notes!, scene: chest },
	{ id: 'barrel', title: 'Barrel', tags: ['prop', 'container'], description: barrel.notes!, scene: barrel },
	{ id: 'potion', title: 'Potion', tags: ['item', 'magic', 'prop', 'effect'], description: potion.notes!, scene: potion },
	{ id: 'torch', title: 'Torch', tags: ['prop', 'fire', 'effect'], description: torch.notes!, scene: torch },
	...MORE.map((t) => ({ ...t, description: t.scene.notes! }))
];

export function getTemplate(id: string): Template | undefined {
	return TEMPLATES.find((t) => t.id === id);
}
